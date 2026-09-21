import { z } from 'zod';

import {
  EditingIntelligenceInputSchema,
  EditingProfileVersionSpecSchema,
  JsonRecordSchema,
  ScriptSegmentSchema,
  TemplateRuntimeContractSchema,
} from '@vision/contracts';
import type { PrismaClient } from '@vision/database';
import { invariant } from '@vision/domain';

const requiredAssetIdsSchema = z.array(z.string().uuid());

const scenePlanSchema = z.array(JsonRecordSchema);

const greenScreenEnvelopeSchema = z
  .object({
    presenter: z.unknown(),

    constraints: z.unknown(),
  })
  .strict();

type RecordingRole = 'VOICE' | 'PRESENTER' | 'SCREEN_VIDEO' | 'BROLL' | 'OTHER_RECORDING';

function recordingRole(
  type: 'VOICE' | 'GREEN_SCREEN_VIDEO' | 'SCREEN_VIDEO' | 'BROLL' | 'OTHER',
): RecordingRole {
  switch (type) {
    case 'VOICE':
      return 'VOICE';

    case 'GREEN_SCREEN_VIDEO':
      return 'PRESENTER';

    case 'SCREEN_VIDEO':
      return 'SCREEN_VIDEO';

    case 'BROLL':
      return 'BROLL';

    case 'OTHER':
      return 'OTHER_RECORDING';
  }
}

type EditingCaptureRole = 'SCREENSHOT' | 'VIDEO' | 'FRAME';

function isEditingCaptureRole(
  role: 'SCREENSHOT' | 'VIDEO' | 'FRAME' | 'TRACE' | 'LOG' | 'OTHER',
): role is EditingCaptureRole {
  return role === 'SCREENSHOT' || role === 'VIDEO' || role === 'FRAME';
}

function captureRole(role: 'SCREENSHOT' | 'VIDEO' | 'FRAME') {
  switch (role) {
    case 'SCREENSHOT':
      return 'SCREENSHOT';

    case 'VIDEO':
      return 'PRODUCT_CAPTURE';

    case 'FRAME':
      return 'PRODUCT_FRAME';
  }
}

export type EditingIntelligenceContextOptions = {
  creativePlanVersionId: string;
};

export class EditingIntelligenceContextBuilder {
  constructor(private readonly db: PrismaClient) {}

  async build(options: EditingIntelligenceContextOptions) {
    const version = await this.db.creativePlanVersion.findUniqueOrThrow({
      where: {
        id: options.creativePlanVersionId,
      },

      include: {
        creativePlan: true,

        scriptVersion: {
          include: {
            conceptVersion: true,
          },
        },

        templateVersion: {
          include: {
            template: true,
          },
        },

        editingProfileVersion: {
          include: {
            editingProfile: true,
          },
        },
      },
    });

    invariant(
      version.creativePlan.status === 'READY_FOR_EDITING',
      'CREATIVE_PLAN_NOT_READY_FOR_EDITING',
    );

    const concept = version.scriptVersion.conceptVersion;

    const approval = await this.db.approval.findFirst({
      where: {
        conceptVersionId: concept.id,

        subjectType: 'CONCEPT',

        actorType: 'USER',
      },

      orderBy: [
        {
          createdAt: 'desc',
        },
        {
          id: 'desc',
        },
      ],
    });

    invariant(approval?.decision === 'APPROVED' && approval.actorId, 'CONCEPT_APPROVAL_REQUIRED');

    const profileVersion = version.editingProfileVersion;

    invariant(profileVersion.editingProfile.status === 'ACTIVE', 'EDITING_PROFILE_NOT_ACTIVE');

    const greenScreen = greenScreenEnvelopeSchema.parse(profileVersion.greenScreenRulesJson);

    const profile = EditingProfileVersionSpecSchema.parse({
      identity: {
        editingProfileVersionId: profileVersion.id,

        key: profileVersion.editingProfile.key,

        version: profileVersion.version,

        name: profileVersion.editingProfile.name,
      },

      pacing: profileVersion.pacingRulesJson,

      cuts: profileVersion.cutRulesJson,

      captions: profileVersion.captionRulesJson,

      focus: profileVersion.focusRulesJson,

      motion: profileVersion.motionRulesJson,

      presenter: greenScreen.presenter,

      audio: profileVersion.soundRulesJson,

      hook: profileVersion.hookRulesJson,

      ending: profileVersion.endingRulesJson,

      constraints: greenScreen.constraints,
    });

    invariant(
      profile.constraints.suitablePrimaryFormats.includes(version.primaryFormat),
      'EDITING_PROFILE_FORMAT_INCOMPATIBLE',
    );

    const templateVersion = version.templateVersion;

    invariant(templateVersion.template.status === 'ACTIVE', 'TEMPLATE_NOT_ACTIVE');

    const template = TemplateRuntimeContractSchema.parse(templateVersion.capabilitiesJson);

    invariant(template.templateVersionId === templateVersion.id, 'TEMPLATE_VERSION_ID_MISMATCH');

    invariant(
      templateVersion.template.key === version.primaryFormat,
      'EDITING_TEMPLATE_FORMAT_MISMATCH',
    );

    const minDurationMs = Math.max(
      profile.constraints.minDurationMs,

      templateVersion.minDurationMs ?? 0,
    );

    const maxDurationMs = Math.min(
      profile.constraints.maxDurationMs,

      templateVersion.maxDurationMs ?? Number.MAX_SAFE_INTEGER,
    );

    invariant(maxDurationMs >= minDurationMs, 'EDITING_DURATION_CONSTRAINT_CONFLICT');

    if (version.targetDurationMs !== null)
      invariant(
        version.targetDurationMs >= minDurationMs && version.targetDurationMs <= maxDurationMs,
        'EDITING_TARGET_DURATION_INCOMPATIBLE',
      );

    const allowedMotionPresets = template.supportedMotionPresetKeys.filter((key) =>
      profile.motion.allowedPresetKeys.includes(key),
    );

    const allowedTransitionPresets = template.supportedTransitionPresetKeys.filter((key) =>
      profile.motion.allowedPresetKeys.includes(key),
    );

    invariant(allowedMotionPresets.length > 0, 'EDITING_MOTION_CAPABILITIES_EMPTY');

    invariant(allowedTransitionPresets.length > 0, 'EDITING_TRANSITION_CAPABILITIES_EMPTY');

    const requiredAssetIds = requiredAssetIdsSchema.parse(version.requiredAssetsJson ?? []);

    invariant(
      new Set(requiredAssetIds).size === requiredAssetIds.length,
      'DUPLICATE_REQUIRED_ASSET_ID',
    );

    const requiredAssets = await this.db.asset.findMany({
      where: {
        id: {
          in: requiredAssetIds,
        },

        status: 'READY',

        deletedAt: null,
      },
    });

    invariant(
      requiredAssets.length === requiredAssetIds.length,
      'EDITING_REQUIRED_ASSET_UNAVAILABLE',
    );

    const recordings = await this.db.recording.findMany({
      where: {
        status: 'SELECTED',

        recordingRequest: {
          creativePlanVersionId: version.id,
        },

        asset: {
          status: 'READY',

          deletedAt: null,
        },
      },

      include: {
        asset: true,

        recordingRequest: true,
      },
    });

    const captureAssets = await this.db.captureRunAsset.findMany({
      where: {
        role: {
          in: ['SCREENSHOT', 'VIDEO', 'FRAME'],
        },

        captureRun: {
          creativePlanVersionId: version.id,

          status: 'SUCCEEDED',
        },

        asset: {
          status: 'READY',

          deletedAt: null,
        },
      },

      include: {
        asset: true,
      },
    });

    const assets = new Map<
      string,
      {
        asset: (typeof requiredAssets)[number];

        roles: Set<string>;
      }
    >();

    const addAsset = (
      asset: (typeof requiredAssets)[number],

      role: string,
    ) => {
      const existing = assets.get(asset.id);

      if (existing) {
        existing.roles.add(role);

        return;
      }

      assets.set(asset.id, {
        asset,
        roles: new Set([role]),
      });
    };

    for (const asset of requiredAssets) addAsset(asset, 'REQUIRED_EXISTING');

    for (const recording of recordings)
      addAsset(recording.asset, recordingRole(recording.recordingRequest.type));

    for (const capture of captureAssets) {
      invariant(isEditingCaptureRole(capture.role), 'EDITING_CAPTURE_ROLE_UNSUPPORTED');

      addAsset(capture.asset, captureRole(capture.role));
    }

    const profilePolicy = {
      pacing: profile.pacing,

      cuts: profile.cuts,

      captions: profile.captions,

      focus: profile.focus,

      motion: profile.motion,

      presenter: profile.presenter,

      audio: profile.audio,

      hook: profile.hook,

      ending: profile.ending,

      constraints: profile.constraints,
    };

    const input = EditingIntelligenceInputSchema.parse({
      concept: {
        id: concept.id,

        conceptId: concept.conceptId,

        version: concept.version,

        title: concept.title,

        angle: concept.angle,

        hook: concept.hook,

        audience: concept.audience,

        objective: concept.objective,

        hypothesis: concept.hypothesis,

        selectedPatternVersionId: concept.selectedPatternVersionId,
      },

      scriptVersion: {
        id: version.scriptVersion.id,

        scriptId: version.scriptVersion.scriptId,

        conceptVersionId: version.scriptVersion.conceptVersionId,

        version: version.scriptVersion.version,

        language: version.scriptVersion.language,

        fullText: version.scriptVersion.fullText,

        segments: z.array(ScriptSegmentSchema).parse(version.scriptVersion.segmentsJson ?? []),

        estimatedDurationMs: version.scriptVersion.estimatedDurationMs,

        voiceMode: version.scriptVersion.voiceMode,
      },

      creativePlanVersion: {
        id: version.id,

        creativePlanId: version.creativePlanId,

        version: version.version,

        scriptVersionId: version.scriptVersionId,

        templateVersionId: version.templateVersionId,

        editingProfileVersionId: version.editingProfileVersionId,

        primaryFormat: version.primaryFormat,

        targetDurationMs: version.targetDurationMs,

        scenePlan: scenePlanSchema.parse(version.scenePlanJson),

        ...(version.ctaJson !== null
          ? {
              cta: JsonRecordSchema.parse(version.ctaJson),
            }
          : {}),
      },

      editingProfile: {
        id: profileVersion.id,

        key: profileVersion.editingProfile.key,

        version: profileVersion.version,

        policy: profilePolicy,
      },

      template: {
        id: templateVersion.id,

        key: templateVersion.template.key,

        version: templateVersion.version,

        capabilities: template,

        inputSchemaSummary: JsonRecordSchema.parse(templateVersion.inputSchemaJson),
      },

      assets: [...assets.values()]
        .sort((a, b) => a.asset.id.localeCompare(b.asset.id))
        .map(({ asset, roles }) => ({
          assetId: asset.id,

          kind: asset.kind,

          source: asset.sourceType,

          ...(asset.durationMs !== null
            ? {
                durationMs: asset.durationMs,
              }
            : {}),

          ...(asset.width !== null
            ? {
                width: asset.width,
              }
            : {}),

          ...(asset.height !== null
            ? {
                height: asset.height,
              }
            : {}),

          semanticRole: [...roles].sort().join('+'),
        })),

      allowedMotionPresets,

      allowedTransitionPresets,

      allowedChromaKeyProfiles: template.supportedChromaKeyProfileKeys,

      durationConstraints: {
        minMs: minDurationMs,

        maxMs: maxDurationMs,
      },

      renderConstraints: {
        width: template.supportedCanvas.width,

        height: template.supportedCanvas.height,

        allowedFps: template.supportedCanvas.allowedFps,
      },
    });

    return {
      input,
      profile,
      template,
    };
  }
}
