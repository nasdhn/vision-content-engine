import { z } from 'zod';

import { EditingIntelligenceInputSchema, EditingIntelligenceOutputSchema } from '@vision/contracts';
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

export type EditingIntelligenceOptions = {
  requestId: string;
  knowledgeSnapshotId: string;
  creativePlanVersionId: string;
};

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

          version: '1.0.0',
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

        output: EditingIntelligenceOutputSchema,

        validate: (input, output) => {
          invariant(
            output.masterDurationMs >= input.durationConstraints.minMs &&
              output.masterDurationMs <= input.durationConstraints.maxMs,
            'EDITING_DURATION_OUT_OF_BOUNDS',
          );

          const segmentIds = new Set(input.scriptVersion.segments.map((segment) => segment.id));

          for (const caption of output.captions)
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

          validateEditingPlan(output, {
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

        planSpecJson: result.output as Prisma.InputJsonValue,

        timelineJson: result.output.timeline as Prisma.InputJsonValue,

        captionPlanJson: result.output.captions as Prisma.InputJsonValue,

        audioPlanJson: result.output.audio as Prisma.InputJsonValue,

        visualFocusJson: result.output.productFocus as Prisma.InputJsonValue,

        transitionPlanJson: result.output.transitions as Prisma.InputJsonValue,

        greenScreenPlanJson: result.output.presenter as Prisma.InputJsonValue,

        renderSettingsJson: result.output.renderSettings as Prisma.InputJsonValue,

        modelInvocationId: result.modelInvocationId,
      });

      await unit.markEditingPlanReady(version.id);

      return version;
    });

    return {
      ...result,
      context: context.input,
      editingPlanVersion,
    };
  }
}
