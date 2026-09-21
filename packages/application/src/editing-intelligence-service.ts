import { z } from 'zod';

import {
  EditingIntelligenceInputSchema,
  EditingIntelligenceOutputV11Schema,
} from '@vision/contracts';
import type { AIProviderGateway, ModelPolicy } from '@vision/ai';
import type { Budget, Prisma, PrismaClient } from '@vision/database';
import { Persistence } from '@vision/database';
import { invariant } from '@vision/domain';

import { EditingIntelligenceContextBuilder } from './editing-intelligence-context.js';
import { validateEditingPlan } from './editing-plan-validator.js';
import { VIDEO_ENGINE_REGISTRY_KEYS } from './video-engine-registry.js';

const aiActor = {
  actorType: 'AI',
  actorId: 'validated-editing-intelligence',
} as const;

const validatorAssetKindSchema = z.enum(['VIDEO', 'AUDIO', 'IMAGE', 'FONT', 'OTHER']);

const revisionConstraintKeys = new Set([
  'CREATIVE_PLAN',
  'TEMPLATE',
  'EDITING_PROFILE',
  'DURATION',
]);

export type EditingIntelligenceOptions = {
  requestId: string;
  knowledgeSnapshotId: string;
  creativePlanVersionId: string;
};

type EditingInput = z.infer<typeof EditingIntelligenceInputSchema>;
type EditingOutput = z.infer<typeof EditingIntelligenceOutputV11Schema>;

function validateStructuredBlocker(input: EditingInput, output: EditingOutput) {
  if (output.kind !== 'BLOCKED') return;

  const { blocker } = output;
  const availableAssetIds = new Set(input.assets.map((asset) => asset.assetId));
  const scriptSegmentIds = new Set(input.scriptVersion.segments.map((segment) => segment.id));

  invariant(
    blocker.evidence.assetIds.every((assetId) => availableAssetIds.has(assetId)),
    'EDITING_BLOCKER_ASSET_EVIDENCE_INVALID',
  );
  invariant(
    blocker.evidence.scriptSegmentIds.every((segmentId) => scriptSegmentIds.has(segmentId)),
    'EDITING_BLOCKER_SEGMENT_EVIDENCE_INVALID',
  );

  switch (blocker.reasonCode) {
    case 'ASSET_QUALITY_INSUFFICIENT':
      invariant(blocker.evidence.assetIds.length > 0, 'EDITING_BLOCKER_EVIDENCE_INSUFFICIENT');
      break;
    case 'PROOF_COVERAGE_INSUFFICIENT':
      invariant(
        blocker.evidence.constraintKeys.includes('PRODUCT_PROOF'),
        'EDITING_BLOCKER_EVIDENCE_INSUFFICIENT',
      );
      break;
    case 'SCRIPT_ASSET_MISMATCH':
      invariant(
        blocker.evidence.assetIds.length > 0 && blocker.evidence.scriptSegmentIds.length > 0,
        'EDITING_BLOCKER_EVIDENCE_INSUFFICIENT',
      );
      break;
    case 'PRESENTER_COVERAGE_INSUFFICIENT':
      invariant(
        blocker.evidence.constraintKeys.includes('PRESENTER'),
        'EDITING_BLOCKER_EVIDENCE_INSUFFICIENT',
      );
      break;
    case 'VOICE_COVERAGE_INSUFFICIENT':
      invariant(
        blocker.evidence.constraintKeys.includes('VOICE_MODE') &&
          blocker.evidence.scriptSegmentIds.length > 0,
        'EDITING_BLOCKER_EVIDENCE_INSUFFICIENT',
      );
      break;
    case 'CREATIVE_PLAN_CONSTRAINT_CONFLICT':
      invariant(
        blocker.evidence.constraintKeys.some((key) => revisionConstraintKeys.has(key)),
        'EDITING_BLOCKER_EVIDENCE_INSUFFICIENT',
      );
      break;
  }
}

export class EditingIntelligenceService {
  private readonly persistence: Persistence;

  private readonly contextBuilder: EditingIntelligenceContextBuilder;

  constructor(
    private readonly db: PrismaClient,

    private readonly gateway: AIProviderGateway,
  ) {
    this.persistence = new Persistence(db);

    this.contextBuilder = new EditingIntelligenceContextBuilder(db);
  }

  async generatePlan(
    options: EditingIntelligenceOptions,

    policy: ModelPolicy,

    budget: Budget,
  ) {
    const context = await this.contextBuilder.build({
      creativePlanVersionId: options.creativePlanVersionId,
    });

    const knowledge = await this.persistence.transaction(aiActor, (unit) =>
      unit.knowledge.snapshot(options.knowledgeSnapshotId),
    );

    const result = await this.gateway.generateStructured(
      {
        requestId: options.requestId,

        capability: 'EDITING_INTELLIGENCE',

        purpose: 'editing-intelligence.plan',

        prompt: {
          key: 'editing-intelligence',

          version: '1.1.0',
        },

        knowledgeSnapshot: {
          id: knowledge.id,

          version: knowledge.version,

          contentHash: knowledge.contentHash,
        },

        knowledgeContext: knowledge,

        input: context.input,
      },

      {
        input: EditingIntelligenceInputSchema,

        output: EditingIntelligenceOutputV11Schema,

        validate: (input, output) => {
          if (output.kind === 'BLOCKED') {
            validateStructuredBlocker(input, output);
            return;
          }

          const plan = output.plan;

          invariant(
            plan.masterDurationMs >= input.durationConstraints.minMs &&
              plan.masterDurationMs <= input.durationConstraints.maxMs,
            'EDITING_DURATION_OUT_OF_BOUNDS',
          );

          const segmentIds = new Set(input.scriptVersion.segments.map((segment) => segment.id));

          for (const caption of plan.captions)
            invariant(
              !caption.segmentRef || segmentIds.has(caption.segmentRef),
              'CAPTION_SEGMENT_NOT_FOUND',
            );

          const availableAssets = input.assets.flatMap((asset) => {
            const kind = validatorAssetKindSchema.safeParse(asset.kind);

            if (!kind.success) return [];

            return [
              {
                assetId: asset.assetId,

                kind: kind.data,

                ...(asset.durationMs !== undefined
                  ? {
                      durationMs: asset.durationMs,
                    }
                  : {}),
              },
            ];
          });

          validateEditingPlan(plan, {
            availableAssets,

            profile: context.profile,

            template: context.template,

            primaryFormat: input.creativePlanVersion.primaryFormat,

            motionPresetKeys: VIDEO_ENGINE_REGISTRY_KEYS.motionPresetKeys,

            transitionPresetKeys: VIDEO_ENGINE_REGISTRY_KEYS.transitionPresetKeys,

            chromaKeyProfileKeys: VIDEO_ENGINE_REGISTRY_KEYS.chromaKeyProfileKeys,

            codecProfileKeys: VIDEO_ENGINE_REGISTRY_KEYS.codecProfileKeys,

            audioProfileKeys: VIDEO_ENGINE_REGISTRY_KEYS.audioProfileKeys,
          });
        },
      },

      policy,
      budget,
    );

    if (result.output.kind === 'BLOCKED') {
      const editingBlocker = await this.persistence.transaction(aiActor, async (unit) => {
        await unit.consumeInvocation(result.modelInvocationId, result.output);

        return unit.recordEditingBlocker(
          context.input.creativePlanVersion.id,
          result.modelInvocationId,
          result.output,
        );
      });

      return {
        ...result,
        context: context.input,
        editingPlanVersion: null,
        editingBlocker,
      };
    }

    const plan = result.output.plan;

    const editingPlanVersion = await this.persistence.transaction(aiActor, async (unit) => {
      await unit.consumeInvocation(result.modelInvocationId, result.output);

      const editingPlan = await unit.ensureEditingPlan(
        context.input.creativePlanVersion.creativePlanId,
      );

      const version = await unit.versions.editingPlanVersion({
        editingPlanId: editingPlan.id,

        creativePlanVersionId: context.input.creativePlanVersion.id,

        editingProfileVersionId: context.input.creativePlanVersion.editingProfileVersionId,

        templateVersionId: context.input.creativePlanVersion.templateVersionId,

        planSpecJson: plan as Prisma.InputJsonValue,

        timelineJson: plan.timeline as Prisma.InputJsonValue,

        captionPlanJson: plan.captions as Prisma.InputJsonValue,

        audioPlanJson: plan.audio as Prisma.InputJsonValue,

        visualFocusJson: plan.productFocus as Prisma.InputJsonValue,

        transitionPlanJson: plan.transitions as Prisma.InputJsonValue,

        greenScreenPlanJson: plan.presenter as Prisma.InputJsonValue,

        renderSettingsJson: plan.renderSettings as Prisma.InputJsonValue,

        modelInvocationId: result.modelInvocationId,
      });

      await unit.markEditingPlanReady(version.id);
      await unit.resolveEditingBlockers(context.input.creativePlanVersion.id, version.id);

      return version;
    });

    return {
      ...result,
      context: context.input,
      editingPlanVersion,
      editingBlocker: null,
    };
  }
}
