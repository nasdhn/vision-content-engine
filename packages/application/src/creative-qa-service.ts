import { z } from 'zod';

import type { AIProviderGateway, ModelPolicy } from '@vision/ai';
import {
  CreativeQAInputSchema,
  CreativeQAOutputSchema,
  EditingPlanSpecSchema,
  JsonRecordSchema,
  ScriptSegmentSchema,
  TechnicalQaReportSchema,
} from '@vision/contracts';
import type { Budget, PrismaClient } from '@vision/database';
import { Persistence } from '@vision/database';
import { invariant } from '@vision/domain';

const aiActor = { actorType: 'AI', actorId: 'validated-creative-qa' } as const;
const visualIssueCodes = new Set([
  'PRODUCT_NOT_VISIBLE_ENOUGH',
  'HOOK_VISUALLY_WEAK',
  'GREEN_SCREEN_BAD_PLACEMENT',
  'SCRIPT_VISUAL_MISMATCH',
]);
const pacingIssueCodes = new Set(['PACING_TOO_SLOW', 'PACING_TOO_FAST', 'CUTS_TOO_MECHANICAL']);
const signalDataSchema = z
  .object({
    blackDurationMs: z.number().int().nonnegative().optional(),
    silenceDurationMs: z.number().int().nonnegative().optional(),
  })
  .passthrough();

export type CreativeQaOptions = {
  requestId: string;
  knowledgeSnapshotId: string;
  renderAttemptId: string;
  renderInspection: unknown;
};

type CreativeQaInput = z.infer<typeof CreativeQAInputSchema>;
type CreativeQaOutput = z.infer<typeof CreativeQAOutputSchema>;

function signalFromCheck(
  checks: z.infer<typeof TechnicalQaReportSchema>['checks'],
  key: 'CATASTROPHIC_BLACK' | 'CATASTROPHIC_SILENCE',
) {
  const check = checks.find((item) => item.key === key);
  if (!check || check.status === 'NOT_APPLICABLE') return undefined;
  const data = signalDataSchema.safeParse(check.data);
  if (!data.success) return undefined;
  const affectedDurationMs =
    key === 'CATASTROPHIC_BLACK' ? data.data.blackDurationMs : data.data.silenceDurationMs;
  if (affectedDurationMs === undefined) return undefined;
  return { catastrophic: check.status === 'FAIL', affectedDurationMs };
}

function validateCreativeQaOutput(input: CreativeQaInput, output: CreativeQaOutput) {
  invariant(
    new Set(output.evaluatedDimensions).size === output.evaluatedDimensions.length,
    'CREATIVE_QA_DUPLICATE_DIMENSION',
  );
  invariant(
    new Set(output.notEvaluatedDimensions).size === output.notEvaluatedDimensions.length,
    'CREATIVE_QA_DUPLICATE_DIMENSION',
  );
  const evaluated = new Set(output.evaluatedDimensions);
  invariant(
    output.notEvaluatedDimensions.every((dimension) => !evaluated.has(dimension)),
    'CREATIVE_QA_DIMENSION_CONFLICT',
  );

  if (output.result === 'PASS')
    invariant(output.issues.length === 0, 'CREATIVE_QA_RESULT_MISMATCH');
  if (output.result === 'PASS_WITH_WARNINGS')
    invariant(
      output.issues.length > 0 && output.issues.every((issue) => issue.severity === 'WARNING'),
      'CREATIVE_QA_RESULT_MISMATCH',
    );
  if (output.result === 'FAIL')
    invariant(
      output.issues.some((issue) => issue.severity === 'ERROR'),
      'CREATIVE_QA_RESULT_MISMATCH',
    );

  const visualEvidence = input.renderInspection.sampledFrames.length > 0;
  const pacingEvidence =
    Boolean(input.renderInspection.cutEvents?.length) ||
    Boolean(input.renderInspection.transcript?.length) ||
    Boolean(input.renderInspection.silenceWindows?.length);
  const captionEvidence = Boolean(input.renderInspection.captionObservations?.length);
  const audioEvidence = input.renderInspection.audioSignals !== undefined;

  for (const issue of output.issues) {
    invariant(
      issue.startMs === undefined || issue.startMs < input.renderInspection.durationMs,
      'CREATIVE_QA_ISSUE_TIME_INVALID',
    );
    invariant(
      issue.endMs === undefined || issue.endMs <= input.renderInspection.durationMs,
      'CREATIVE_QA_ISSUE_TIME_INVALID',
    );
    invariant(
      issue.startMs === undefined || issue.endMs === undefined || issue.endMs > issue.startMs,
      'CREATIVE_QA_ISSUE_TIME_INVALID',
    );
    if (visualIssueCodes.has(issue.code))
      invariant(visualEvidence, 'CREATIVE_QA_VISUAL_EVIDENCE_REQUIRED');
    if (pacingIssueCodes.has(issue.code))
      invariant(pacingEvidence, 'CREATIVE_QA_PACING_EVIDENCE_REQUIRED');
    if (issue.code === 'CAPTIONS_TOO_BUSY')
      invariant(captionEvidence, 'CREATIVE_QA_CAPTION_EVIDENCE_REQUIRED');
    if (issue.code === 'SOUND_TOO_BUSY')
      invariant(audioEvidence, 'CREATIVE_QA_AUDIO_EVIDENCE_REQUIRED');
  }
}

export class CreativeQaService {
  private readonly persistence: Persistence;

  constructor(
    private readonly db: PrismaClient,
    private readonly gateway: AIProviderGateway,
  ) {
    this.persistence = new Persistence(db);
  }

  private async buildInput(options: CreativeQaOptions) {
    const attempt = await this.db.renderAttempt.findUniqueOrThrow({
      where: { id: options.renderAttemptId },
      include: {
        outputAsset: true,
        diagnosticAsset: true,
        render: {
          include: {
            editingPlanVersion: {
              include: {
                creativePlanVersion: {
                  include: {
                    scriptVersion: { include: { conceptVersion: true } },
                  },
                },
              },
            },
          },
        },
      },
    });

    const outputAsset = attempt.outputAsset;
    invariant(attempt.status === 'SUCCEEDED', 'CREATIVE_QA_RENDER_ATTEMPT_NOT_READY');
    invariant(attempt.render.status === 'CREATIVE_QA', 'CREATIVE_QA_RENDER_NOT_READY');
    invariant(
      attempt.outputAssetId && outputAsset?.status === 'READY' && outputAsset.deletedAt === null,
      'CREATIVE_QA_OUTPUT_ASSET_NOT_READY',
    );

    const technicalQa = TechnicalQaReportSchema.parse(attempt.technicalQaJson);
    invariant(technicalQa.result === 'PASS', 'CREATIVE_QA_TECHNICAL_QA_REQUIRED');
    invariant(technicalQa.probe.video, 'CREATIVE_QA_VIDEO_REQUIRED');

    const editingVersion = attempt.render.editingPlanVersion;
    const creativeVersion = editingVersion.creativePlanVersion;
    const scriptVersion = creativeVersion.scriptVersion;
    const conceptVersion = scriptVersion.conceptVersion;
    const editingPlan = EditingPlanSpecSchema.parse(editingVersion.planSpecJson);
    const inspection = CreativeQAInputSchema.shape.renderInspection.parse(options.renderInspection);

    invariant(
      inspection.durationMs === technicalQa.probe.durationMs,
      'CREATIVE_QA_INSPECTION_DURATION_MISMATCH',
    );
    const evidenceAssetIds = new Set(
      [attempt.outputAssetId, attempt.diagnosticAssetId].filter(
        (value): value is string => value !== null,
      ),
    );
    invariant(
      inspection.sampledFrames.every((frame) => evidenceAssetIds.has(frame.assetId)),
      'CREATIVE_QA_EVIDENCE_ASSET_INVALID',
    );

    const video = technicalQa.probe.video;
    const blackFrameSignals = signalFromCheck(technicalQa.checks, 'CATASTROPHIC_BLACK');
    const silenceSignals = signalFromCheck(technicalQa.checks, 'CATASTROPHIC_SILENCE');

    const input = CreativeQAInputSchema.parse({
      concept: {
        id: conceptVersion.id,
        conceptId: conceptVersion.conceptId,
        version: conceptVersion.version,
        title: conceptVersion.title,
        angle: conceptVersion.angle,
        hook: conceptVersion.hook,
        audience: conceptVersion.audience,
        objective: conceptVersion.objective,
        hypothesis: conceptVersion.hypothesis,
        selectedPatternVersionId: conceptVersion.selectedPatternVersionId,
      },
      script: {
        id: scriptVersion.id,
        scriptId: scriptVersion.scriptId,
        conceptVersionId: scriptVersion.conceptVersionId,
        version: scriptVersion.version,
        language: scriptVersion.language,
        fullText: scriptVersion.fullText,
        segments: z.array(ScriptSegmentSchema).parse(scriptVersion.segmentsJson ?? []),
        estimatedDurationMs: scriptVersion.estimatedDurationMs,
        voiceMode: scriptVersion.voiceMode,
      },
      creativePlan: {
        id: creativeVersion.id,
        creativePlanId: creativeVersion.creativePlanId,
        version: creativeVersion.version,
        scriptVersionId: creativeVersion.scriptVersionId,
        templateVersionId: creativeVersion.templateVersionId,
        editingProfileVersionId: creativeVersion.editingProfileVersionId,
        primaryFormat: creativeVersion.primaryFormat,
        targetDurationMs: creativeVersion.targetDurationMs,
        scenePlan: z.array(JsonRecordSchema).parse(creativeVersion.scenePlanJson),
        ...(creativeVersion.ctaJson !== null
          ? { cta: JsonRecordSchema.parse(creativeVersion.ctaJson) }
          : {}),
      },
      editingPlan,
      renderTechnicalReport: {
        durationMs: technicalQa.probe.durationMs,
        width: video.width,
        height: video.height,
        fps: video.fps,
        audioPresent: technicalQa.probe.audio !== undefined,
        ...(blackFrameSignals ? { blackFrameSignals } : {}),
        ...(silenceSignals ? { silenceSignals } : {}),
      },
      renderInspection: inspection,
    });

    return { attempt, input };
  }

  async review(options: CreativeQaOptions, policy: ModelPolicy, budget: Budget) {
    const context = await this.buildInput(options);
    const knowledge = await this.persistence.transaction(aiActor, (unit) =>
      unit.knowledge.snapshot(options.knowledgeSnapshotId),
    );

    const result = await this.gateway.generateStructured(
      {
        requestId: options.requestId,
        capability: 'CREATIVE_QA',
        purpose: 'creative-qa.review',
        prompt: { key: 'creative-qa', version: '1.0.0' },
        knowledgeSnapshot: {
          id: knowledge.id,
          version: knowledge.version,
          contentHash: knowledge.contentHash,
        },
        knowledgeContext: knowledge,
        input: context.input,
      },
      {
        input: CreativeQAInputSchema,
        output: CreativeQAOutputSchema,
        validate: validateCreativeQaOutput,
      },
      policy,
      budget,
    );

    const applied = await this.persistence.transaction(aiActor, async (unit) => {
      await unit.consumeInvocation(result.modelInvocationId, result.output);
      return unit.applyCreativeQa(options.renderAttemptId, result.modelInvocationId, result.output);
    });

    return { ...result, context: context.input, renderAttempt: applied };
  }
}
