import { isAbsolute } from 'node:path';

import {
  EditingPlanSpecSchema,
  RenderPayloadSchema,
  ResolvedRenderAssetSchema,
  TemplateRuntimeContractSchema,
} from '@vision/contracts';
import { invariant } from '@vision/domain';
import { z } from 'zod';

import {
  VIDEO_ENGINE_REGISTRY_KEYS,
  VIDEO_ENGINE_TEMPLATE_CONTRACT,
} from './video-engine-registry.js';

const resolvedAssetsSchema = z.array(ResolvedRenderAssetSchema);

export type RenderPayloadCompileInput = {
  renderAttemptId: string;
  editingPlanVersionId: string;
  editingProfileVersionId: string;
  rendererVersion: string;
  editingPlan: unknown;
  template: unknown;
  resolvedAssets: unknown[];
};

export function frameWindowFromMs(
  startMs: number,
  endMs: number,
  fps: number,
  masterDurationMs: number,
) {
  invariant(
    Number.isFinite(fps) &&
      fps > 0 &&
      Number.isSafeInteger(startMs) &&
      Number.isSafeInteger(endMs) &&
      Number.isSafeInteger(masterDurationMs) &&
      startMs >= 0 &&
      endMs > startMs &&
      endMs <= masterDurationMs,
    'FRAME_WINDOW_INVALID',
  );

  const startFrame = Math.floor((startMs * fps) / 1_000);
  const endFrame = Math.ceil((endMs * fps) / 1_000);
  const masterEndFrame = Math.ceil((masterDurationMs * fps) / 1_000);

  invariant(
    Number.isSafeInteger(startFrame) &&
      Number.isSafeInteger(endFrame) &&
      endFrame > startFrame &&
      endFrame <= masterEndFrame,
    'FRAME_WINDOW_INVALID',
  );

  return {
    startFrame,
    endFrame,
    frameCount: endFrame - startFrame,
  } as const;
}

function localAssetUri(uri: string) {
  if (isAbsolute(uri)) return true;

  try {
    const parsed = new URL(uri);

    return (
      parsed.protocol === 'file:' && (parsed.hostname === '' || parsed.hostname === 'localhost')
    );
  } catch {
    return false;
  }
}

function requiredResolvedAssetIds(
  plan: z.infer<typeof EditingPlanSpecSchema>,
  template: z.infer<typeof TemplateRuntimeContractSchema>,
) {
  return new Set([
    ...plan.selectedAssets.map((asset) => asset.assetId),
    ...template.assetDependencies,
  ]);
}

export function compileRenderPayload(input: RenderPayloadCompileInput) {
  const plan = EditingPlanSpecSchema.parse(input.editingPlan);
  const template = TemplateRuntimeContractSchema.parse(input.template);
  const resolvedAssets = resolvedAssetsSchema.parse(input.resolvedAssets);

  invariant(
    template.rendererApiVersion === VIDEO_ENGINE_TEMPLATE_CONTRACT.requiredRendererApiVersion,
    'RENDERER_API_VERSION_MISMATCH',
  );

  invariant(
    template.supportedCanvas.width === plan.renderSettings.width &&
      template.supportedCanvas.height === plan.renderSettings.height &&
      template.supportedCanvas.allowedFps.includes(plan.renderSettings.fps),
    'TEMPLATE_CONTRACT_FAILED',
  );

  const colorProfileKey = VIDEO_ENGINE_TEMPLATE_CONTRACT.defaultProfiles.color;

  invariant(
    VIDEO_ENGINE_REGISTRY_KEYS.colorProfileKeys.includes(colorProfileKey),
    'PRESET_UNKNOWN',
  );

  invariant(
    template.supportedColorProfileKeys.includes(colorProfileKey),
    'TEMPLATE_CONTRACT_FAILED',
  );

  invariant(
    VIDEO_ENGINE_REGISTRY_KEYS.codecProfileKeys.includes(plan.renderSettings.codecProfileKey) &&
      template.supportedCodecProfileKeys.includes(plan.renderSettings.codecProfileKey),
    'TEMPLATE_CONTRACT_FAILED',
  );

  invariant(
    VIDEO_ENGINE_REGISTRY_KEYS.audioProfileKeys.includes(plan.renderSettings.audioProfileKey) &&
      template.supportedAudioProfileKeys.includes(plan.renderSettings.audioProfileKey),
    'TEMPLATE_CONTRACT_FAILED',
  );

  const requiredIds = requiredResolvedAssetIds(plan, template);
  const resolvedIds = new Set(resolvedAssets.map((asset) => asset.assetId));

  invariant(resolvedIds.size === resolvedAssets.length, 'RENDER_INPUT_ASSET_SET_MISMATCH');
  invariant(
    resolvedIds.size === requiredIds.size &&
      [...requiredIds].every((assetId) => resolvedIds.has(assetId)),
    'RENDER_INPUT_ASSET_SET_MISMATCH',
  );

  for (const asset of resolvedAssets) {
    invariant(asset.probe.assetId === asset.assetId, 'INPUT_PROBE_FAILED');
    invariant(localAssetUri(asset.localUri), 'RENDER_REMOTE_ASSET_FORBIDDEN');

    if (asset.kind === 'VIDEO') invariant(asset.probe.video, 'INPUT_PROBE_FAILED');
    if (asset.kind === 'AUDIO') invariant(asset.probe.audio, 'INPUT_PROBE_FAILED');

    const selected = plan.selectedAssets.find((candidate) => candidate.assetId === asset.assetId);

    if (selected?.sourceOutMs !== undefined) {
      invariant(asset.probe.durationMs !== undefined, 'INPUT_PROBE_FAILED');
      invariant(selected.sourceOutMs <= asset.probe.durationMs, 'ASSET_TRIM_INVALID');
    }
  }

  const payload = RenderPayloadSchema.parse({
    renderAttemptId: input.renderAttemptId,
    template,
    editingPlan: plan,
    resolvedAssets,
    renderSettings: plan.renderSettings,
    provenance: {
      editingPlanVersionId: input.editingPlanVersionId,
      templateVersionId: template.templateVersionId,
      editingProfileVersionId: input.editingProfileVersionId,
      rendererVersion: input.rendererVersion,
      colorProfileKey,
      codecProfileKey: plan.renderSettings.codecProfileKey,
      audioProfileKey: plan.renderSettings.audioProfileKey,
    },
  });

  return payload;
}
