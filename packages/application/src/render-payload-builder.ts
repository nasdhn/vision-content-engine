import {
  EditingPlanSpecSchema,
  ResolvedRenderAssetSchema,
  TemplateRuntimeContractSchema,
} from '@vision/contracts';
import type { PrismaClient } from '@vision/database';
import { invariant } from '@vision/domain';
import { z } from 'zod';

import { compileRenderPayload } from './render-payload-compiler.js';

const resolvedAssetsSchema = z.array(ResolvedRenderAssetSchema);

function selectedRoleToRenderInputRole(
  role:
    'VOICE' | 'PRESENTER' | 'PRODUCT_CAPTURE' | 'SCREENSHOT' | 'BROLL' | 'MUSIC' | 'SFX' | 'IMAGE',
) {
  return role === 'PRESENTER' ? ('GREEN_SCREEN_VIDEO' as const) : role;
}

function resolvedKindForDatabaseKind(
  kind: 'IMAGE' | 'VIDEO' | 'AUDIO' | 'FONT' | 'SUBTITLE' | 'JSON' | 'OTHER',
) {
  if (kind === 'SUBTITLE' || kind === 'JSON') return 'OTHER' as const;

  return kind;
}

export type RenderPayloadBuildOptions = {
  renderId: string;
  renderAttemptId: string;
  resolvedAssets: unknown[];
};

export class RenderPayloadBuilder {
  constructor(private readonly db: PrismaClient) {}

  async build(options: RenderPayloadBuildOptions) {
    const render = await this.db.render.findUniqueOrThrow({
      where: {
        id: options.renderId,
      },
      include: {
        editingPlanVersion: {
          include: {
            editingPlan: true,
            templateVersion: true,
          },
        },
        inputAssets: {
          include: {
            asset: true,
          },
        },
      },
    });

    const attempt = await this.db.renderAttempt.findUniqueOrThrow({
      where: {
        id: options.renderAttemptId,
      },
    });

    invariant(attempt.renderId === render.id, 'RENDER_ATTEMPT_LINEAGE_MISMATCH');
    invariant(
      attempt.status === 'QUEUED' || attempt.status === 'RUNNING',
      'RENDER_ATTEMPT_NOT_ACTIVE',
    );

    invariant(render.editingPlanVersion.editingPlan.status === 'READY', 'EDITING_PLAN_NOT_READY');
    invariant(
      render.status === 'QUEUED' ||
        render.status === 'RENDERING' ||
        render.status === 'TECHNICAL_QA',
      'RENDER_NOT_ACTIVE',
    );

    const plan = EditingPlanSpecSchema.parse(render.editingPlanVersion.planSpecJson);
    const template = TemplateRuntimeContractSchema.parse(
      render.editingPlanVersion.templateVersion.capabilitiesJson,
    );

    invariant(
      template.templateVersionId === render.editingPlanVersion.templateVersionId,
      'TEMPLATE_CONTRACT_FAILED',
    );

    const templateLinks = await this.db.templateVersionAsset.findMany({
      where: {
        templateVersionId: render.editingPlanVersion.templateVersionId,
        assetId: {
          in: template.assetDependencies,
        },
      },
      orderBy: [{ assetId: 'asc' }, { role: 'asc' }],
    });

    const dependencyLinksByAsset = new Map<string, (typeof templateLinks)[number]>();

    for (const link of templateLinks) {
      invariant(!dependencyLinksByAsset.has(link.assetId), 'TEMPLATE_ASSET_AMBIGUOUS');
      dependencyLinksByAsset.set(link.assetId, link);
    }

    invariant(
      dependencyLinksByAsset.size === template.assetDependencies.length &&
        template.assetDependencies.every((assetId) => dependencyLinksByAsset.has(assetId)),
      'TEMPLATE_ASSET_DEPENDENCY_MISSING',
    );

    const expectedInputs = new Map<string, { sequence: number | null; slotKey: string | null }>();

    plan.selectedAssets.forEach((asset, sequence) => {
      expectedInputs.set(`${asset.assetId}:${selectedRoleToRenderInputRole(asset.role)}`, {
        sequence,
        slotKey: null,
      });
    });

    [...template.assetDependencies].sort().forEach((assetId, sequence) => {
      const link = dependencyLinksByAsset.get(assetId)!;

      expectedInputs.set(`${assetId}:TEMPLATE_ASSET`, {
        sequence,
        slotKey: link.slotKey,
      });
    });

    invariant(render.inputAssets.length === expectedInputs.size, 'RENDER_INPUT_LINEAGE_MISMATCH');

    for (const inputAsset of render.inputAssets) {
      const expected = expectedInputs.get(`${inputAsset.assetId}:${inputAsset.role}`);

      invariant(expected, 'RENDER_INPUT_LINEAGE_MISMATCH');
      invariant(
        inputAsset.sequence === expected.sequence && inputAsset.slotKey === expected.slotKey,
        'RENDER_INPUT_LINEAGE_MISMATCH',
      );
      invariant(
        inputAsset.asset.status === 'READY' && inputAsset.asset.deletedAt === null,
        'RENDER_INPUT_NOT_READY',
      );
    }

    const resolvedAssets = resolvedAssetsSchema.parse(options.resolvedAssets);
    const resolvedById = new Map(resolvedAssets.map((asset) => [asset.assetId, asset] as const));

    for (const inputAsset of render.inputAssets) {
      const resolved = resolvedById.get(inputAsset.assetId);

      invariant(resolved, 'INPUT_ASSET_MISSING');
      invariant(
        resolved.kind === resolvedKindForDatabaseKind(inputAsset.asset.kind),
        'INPUT_UNSUPPORTED',
      );

      if (inputAsset.asset.checksumSha256)
        invariant(
          resolved.checksumSha256 === inputAsset.asset.checksumSha256,
          'INPUT_CHECKSUM_MISMATCH',
        );
    }

    invariant(
      attempt.rendererVersion === render.editingPlanVersion.templateVersion.rendererVersion,
      'RENDERER_VERSION_MISMATCH',
    );

    return compileRenderPayload({
      renderAttemptId: attempt.id,
      editingPlanVersionId: render.editingPlanVersionId,
      editingProfileVersionId: render.editingPlanVersion.editingProfileVersionId,
      rendererVersion: attempt.rendererVersion,
      editingPlan: plan,
      template,
      resolvedAssets,
    });
  }
}
