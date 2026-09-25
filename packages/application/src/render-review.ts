import { CapacityGuard } from '@vision/media';
import { createHash } from 'node:crypto';
import { CreativeQAOutputSchema, TechnicalQaReportSchema } from '@vision/contracts';
import { Persistence } from '@vision/database';
import type { Actor, PrismaClient } from '@vision/database';
import { assertHuman, invariant } from '@vision/domain';
import type { PrivateStorage } from '@vision/media';

export const RENDER_REJECTION_REASON_CODES = [
  'PACING_TOO_SLOW',
  'PACING_TOO_FAST',
  'CUTS_TOO_MECHANICAL',
  'CAPTIONS_TOO_BUSY',
  'PRODUCT_NOT_VISIBLE_ENOUGH',
  'HOOK_VISUALLY_WEAK',
  'SOUND_TOO_BUSY',
  'CTA_TOO_LONG',
  'GREEN_SCREEN_BAD_PLACEMENT',
  'SCRIPT_VISUAL_MISMATCH',
  'OTHER',
] as const;

export type RenderRejectionReasonCode = (typeof RENDER_REJECTION_REASON_CODES)[number];

export type RenderReviewListItem = {
  renderId: string;
  status: string;
  title: string;
  hook: string | null;
  creativePlanVersionId: string;
  creativePlanVersion: number;
  primaryFormat: string;
  targetDurationMs: number | null;
  creativeQaResult: 'PASS' | 'PASS_WITH_WARNINGS';
  creativeQaSummary: string;
  issueCount: number;
  createdAt: string;
};

export type RenderReviewDetail = RenderReviewListItem & {
  decisionAllowed: boolean;
  concept: {
    angle: string | null;
    audience: string | null;
    objective: string | null;
    hypothesis: string | null;
    rationale: string | null;
  };
  script: {
    fullText: string;
    estimatedDurationMs: number | null;
    voiceMode: string;
  };
  cta: unknown;
  platformIntent: unknown;
  creativeQa: {
    result: 'PASS' | 'PASS_WITH_WARNINGS';
    summary: string;
    evaluatedDimensions: string[];
    notEvaluatedDimensions: string[];
    issues: {
      code: string;
      severity: 'WARNING' | 'ERROR';
      startMs: number | null;
      endMs: number | null;
      explanation: string;
      suggestedFix: string | null;
    }[];
  };
  technicalQa: {
    result: 'PASS';
    durationMs: number;
    width: number | null;
    height: number | null;
    fps: number | null;
    rendererVersion: string;
    colorProfileKey: string;
    codecProfileKey: string;
    audioProfileKey: string;
    checks: {
      key: string;
      status: string;
      message: string | null;
    }[];
  };
  lineage: {
    editingPlanVersionId: string;
    creativePlanVersionId: string;
    renderAttemptId: string;
    attemptNumber: number;
    outputAssetId: string;
    approvedAssetId: string | null;
  };
  previousDecision: {
    id: string;
    decision: string;
    reasonCode: string | null;
    comment: string | null;
    createdAt: string;
  } | null;
};

export type RenderReviewMedia = {
  bytes: Buffer;
  mimeType: string;
  checksumSha256: string;
  sizeBytes: number;
};

const iso = (value: Date) => value.toISOString();
const reviewableStatuses = new Set(['READY_FOR_REVIEW', 'APPROVED', 'REJECTED']);

export class RenderReviewService {
  private readonly persistence: Persistence;
  private mediaReads = 0;

  constructor(
    private readonly db: PrismaClient,
    private readonly storage: PrivateStorage,
  ) {
    this.persistence = new Persistence(db);
  }

  private async context(renderId: string) {
    const render = await this.db.render.findUnique({
      where: { id: renderId },
      include: {
        approvals: {
          where: { subjectType: 'RENDER', actorType: 'USER' },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 1,
        },
        editingPlanVersion: {
          include: {
            creativePlanVersion: {
              include: {
                scriptVersion: {
                  include: { conceptVersion: true },
                },
              },
            },
          },
        },
      },
    });

    invariant(render, 'RENDER_NOT_FOUND');
    invariant(reviewableStatuses.has(render.status), 'RENDER_NOT_REVIEWABLE');

    const attempt =
      render.status === 'APPROVED'
        ? await this.db.renderAttempt.findFirst({
            where: {
              renderId,
              status: 'SUCCEEDED',
              outputAssetId: render.approvedAssetId ?? '__missing__',
            },
            orderBy: [{ attemptNumber: 'desc' }, { id: 'desc' }],
            include: { outputAsset: true },
          })
        : await this.db.renderAttempt.findFirst({
            where: {
              renderId,
              status: 'SUCCEEDED',
              creativeQaResult: { in: ['PASS', 'PASS_WITH_WARNINGS'] },
              outputAssetId: { not: null },
            },
            orderBy: [{ attemptNumber: 'desc' }, { id: 'desc' }],
            include: { outputAsset: true },
          });

    invariant(attempt?.outputAssetId && attempt.outputAsset, 'RENDER_OUTPUT_MISMATCH');
    const asset = attempt.outputAsset;
    invariant(
      asset.status === 'READY' &&
        asset.deletedAt === null &&
        Boolean(asset.checksumSha256) &&
        asset.sizeBytes !== null &&
        asset.sourceType === 'RENDER' &&
        asset.sourceEntityType === 'RenderAttempt' &&
        asset.sourceEntityId === attempt.id,
      'ASSET_NOT_AVAILABLE',
    );

    if (render.status === 'APPROVED') {
      invariant(render.approvedAssetId === asset.id, 'RENDER_OUTPUT_MISMATCH');
    }

    const creativeQa = CreativeQAOutputSchema.safeParse(attempt.creativeQaJson);
    invariant(creativeQa.success, 'RENDER_REVIEW_EVIDENCE_INVALID');
    const creativeQaResult = creativeQa.data.result;
    invariant(
      (creativeQaResult === 'PASS' || creativeQaResult === 'PASS_WITH_WARNINGS') &&
        creativeQaResult === attempt.creativeQaResult,
      'RENDER_REVIEW_EVIDENCE_INVALID',
    );
    const reviewableCreativeQa = {
      ...creativeQa.data,
      result: creativeQaResult,
    };

    const technicalQa = TechnicalQaReportSchema.safeParse(attempt.technicalQaJson);
    invariant(technicalQa.success, 'RENDER_REVIEW_EVIDENCE_INVALID');
    const technicalQaResult = technicalQa.data.result;
    invariant(technicalQaResult === 'PASS', 'RENDER_REVIEW_EVIDENCE_INVALID');
    const technicalDurationMs = technicalQa.data.probe.durationMs;
    invariant(technicalDurationMs !== undefined, 'RENDER_REVIEW_EVIDENCE_INVALID');
    const passingTechnicalQa = {
      ...technicalQa.data,
      result: technicalQaResult,
      probe: {
        ...technicalQa.data.probe,
        durationMs: technicalDurationMs,
      },
    };

    return {
      render,
      attempt,
      asset,
      creativeQa: reviewableCreativeQa,
      technicalQa: passingTechnicalQa,
    };
  }

  private listItem(
    context: Awaited<ReturnType<RenderReviewService['context']>>,
  ): RenderReviewListItem {
    const { render, creativeQa } = context;
    const version = render.editingPlanVersion.creativePlanVersion;
    const concept = version.scriptVersion.conceptVersion;
    return {
      renderId: render.id,
      status: render.status,
      title: concept.title,
      hook: concept.hook,
      creativePlanVersionId: version.id,
      creativePlanVersion: version.version,
      primaryFormat: version.primaryFormat,
      targetDurationMs: version.targetDurationMs,
      creativeQaResult: creativeQa.result,
      creativeQaSummary: creativeQa.summary,
      issueCount: creativeQa.issues.length,
      createdAt: iso(render.createdAt),
    };
  }

  async queue(): Promise<RenderReviewListItem[]> {
    const renders = await this.db.render.findMany({
      where: { status: 'READY_FOR_REVIEW' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 100,
      select: { id: true },
    });

    return Promise.all(renders.map(async (render) => this.listItem(await this.context(render.id))));
  }

  async detail(renderId: string): Promise<RenderReviewDetail> {
    const context = await this.context(renderId);
    const { render, attempt, asset, creativeQa, technicalQa } = context;
    const version = render.editingPlanVersion.creativePlanVersion;
    const script = version.scriptVersion;
    const concept = script.conceptVersion;
    const video = technicalQa.probe.video;
    const previousDecision = render.approvals[0] ?? null;

    return {
      ...this.listItem(context),
      decisionAllowed: render.status === 'READY_FOR_REVIEW',
      concept: {
        angle: concept.angle,
        audience: concept.audience,
        objective: concept.objective,
        hypothesis: concept.hypothesis,
        rationale: concept.rationale,
      },
      script: {
        fullText: script.fullText,
        estimatedDurationMs: script.estimatedDurationMs,
        voiceMode: script.voiceMode,
      },
      cta: version.ctaJson,
      platformIntent: version.platformConsiderationsJson,
      creativeQa: {
        result: creativeQa.result,
        summary: creativeQa.summary,
        evaluatedDimensions: creativeQa.evaluatedDimensions,
        notEvaluatedDimensions: creativeQa.notEvaluatedDimensions,
        issues: creativeQa.issues.map((issue) => ({
          code: issue.code,
          severity: issue.severity,
          startMs: issue.startMs ?? null,
          endMs: issue.endMs ?? null,
          explanation: issue.explanation,
          suggestedFix: issue.suggestedFix ?? null,
        })),
      },
      technicalQa: {
        result: technicalQa.result,
        durationMs: technicalQa.probe.durationMs,
        width: video?.width ?? null,
        height: video?.height ?? null,
        fps: video?.fps ?? null,
        rendererVersion: technicalQa.rendererVersion,
        colorProfileKey: technicalQa.colorProfileKey,
        codecProfileKey: technicalQa.codecProfileKey,
        audioProfileKey: technicalQa.audioProfileKey,
        checks: technicalQa.checks.map((check) => ({
          key: check.key,
          status: check.status,
          message: check.message ?? null,
        })),
      },
      lineage: {
        editingPlanVersionId: render.editingPlanVersionId,
        creativePlanVersionId: version.id,
        renderAttemptId: attempt.id,
        attemptNumber: attempt.attemptNumber,
        outputAssetId: asset.id,
        approvedAssetId: render.approvedAssetId,
      },
      previousDecision: previousDecision
        ? {
            id: previousDecision.id,
            decision: previousDecision.decision,
            reasonCode: previousDecision.reasonCode,
            comment: previousDecision.comment,
            createdAt: iso(previousDecision.createdAt),
          }
        : null,
    };
  }

  async media(actor: Actor, renderId: string): Promise<RenderReviewMedia> {
    assertHuman(actor);
    invariant(this.mediaReads < 2, 'PREVIEW_CAPACITY_REACHED');
    this.mediaReads++;
    try {
      const { asset } = await this.context(renderId);
      invariant(
        asset.storageProvider === 'S3' && asset.bucket === this.storage.bucket,
        'ASSET_NOT_AVAILABLE',
      );
      invariant(
        asset.sizeBytes !== null && asset.sizeBytes <= BigInt(Number.MAX_SAFE_INTEGER),
        'ASSET_NOT_AVAILABLE',
      );
      const expectedSize = new CapacityGuard().artifactSize(Number(asset.sizeBytes));
      const hash = createHash('sha256');
      const chunks: Uint8Array[] = [];
      let size = 0;

      try {
        for await (const chunk of await this.storage.get(asset.objectKey)) {
          size += chunk.byteLength;
          invariant(size <= expectedSize, 'STORED_OBJECT_SIZE_MISMATCH');
          hash.update(chunk);
          chunks.push(chunk);
        }
      } catch {
        throw new Error('PRIVATE_RENDER_READ_FAILED');
      }

      invariant(
        size === expectedSize && hash.digest('hex') === asset.checksumSha256,
        'ASSET_NOT_AVAILABLE',
      );

      return {
        bytes: Buffer.concat(chunks),
        mimeType: asset.mimeType ?? 'video/mp4',
        checksumSha256: asset.checksumSha256!,
        sizeBytes: expectedSize,
      };
    } finally {
      this.mediaReads--;
    }
  }

  async decide(
    actor: Actor,
    renderId: string,
    input: {
      decision: 'APPROVED' | 'REJECTED';
      reasonCode?: RenderRejectionReasonCode;
      comment?: string;
    },
  ) {
    assertHuman(actor);
    const comment = input.comment?.trim() || undefined;

    if (input.decision === 'APPROVED') {
      invariant(!input.reasonCode, 'INVALID_RENDER_REASON');
    } else {
      invariant(Boolean(input.reasonCode), 'RENDER_REJECTION_REASON_REQUIRED');
    }
    if (input.reasonCode) {
      invariant(RENDER_REJECTION_REASON_CODES.includes(input.reasonCode), 'INVALID_RENDER_REASON');
    }

    const context = await this.context(renderId);
    invariant(context.render.status === 'READY_FOR_REVIEW', 'INVALID_TRANSITION');

    const approval = await this.persistence.transaction(actor, (unit) =>
      unit.decideRender(
        renderId,
        input.decision,
        input.decision === 'APPROVED' ? context.asset.id : undefined,
        comment,
        input.reasonCode,
      ),
    );

    return {
      approvalId: approval.id,
      renderId: approval.renderId,
      decision: approval.decision,
      reasonCode: approval.reasonCode,
      comment: approval.comment,
      createdAt: approval.createdAt.toISOString(),
    };
  }
}
