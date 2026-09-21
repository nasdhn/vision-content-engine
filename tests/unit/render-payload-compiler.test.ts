import { randomUUID } from 'node:crypto';

import { expect, it } from 'vitest';

import {
  compileRenderPayload,
  frameWindowFromMs,
} from '../../packages/application/src/render-payload-compiler.js';

const assetId = randomUUID();
const editingPlanVersionId = randomUUID();
const editingProfileVersionId = randomUUID();
const templateVersionId = randomUUID();
const renderAttemptId = randomUUID();

const plan = {
  masterDurationMs: 10_000,
  selectedAssets: [
    {
      assetId,
      role: 'PRODUCT_CAPTURE' as const,
      sourceInMs: 0,
      sourceOutMs: 10_000,
      reason: 'Primary product proof.',
    },
  ],
  timeline: [
    {
      id: 'product',
      startMs: 0,
      endMs: 10_000,
      layer: 'PRODUCT' as const,
      zIndex: 10,
      source: {
        type: 'ASSET' as const,
        assetId,
      },
      composition: {
        opacity: 1,
        region: {
          x: 0,
          y: 0,
          width: 1,
          height: 1,
        },
        scaleMode: 'CROP' as const,
      },
      purpose: 'Show product proof.',
    },
  ],
  productFocus: [],
  captions: [],
  onScreenText: [],
  presenter: [],
  audio: {
    sfx: [],
  },
  transitions: [],
  renderSettings: {
    width: 1080 as const,
    height: 1920 as const,
    fps: 30,
    codecProfileKey: 'SOCIAL_H264_AAC_V1',
    audioProfileKey: 'SOCIAL_VOICE_MASTER_V1',
  },
  rationale: {
    hookStrategy: 'Immediate proof.',
    pacingStrategy: 'Readable.',
    attentionStrategy: 'One focal point.',
    proofStrategy: 'Product first.',
    endingStrategy: 'Clean ending.',
  },
};

const template = {
  templateVersionId,
  compositionKey: 'product-demo-v1',
  rendererApiVersion: 'v1',
  supportedCanvas: {
    width: 1080 as const,
    height: 1920 as const,
    allowedFps: [30, 60],
  },
  supportedLayers: ['PRODUCT' as const],
  requiredSlots: [
    {
      key: 'product',
      accepts: 'PRODUCT' as const,
      required: true,
    },
  ],
  optionalSlots: [],
  supportedMotionPresetKeys: ['CUT'],
  supportedTransitionPresetKeys: ['CUT'],
  supportedChromaKeyProfileKeys: ['GREENSCREEN_STANDARD_V1'],
  supportedColorProfileKeys: ['SDR_BT709_SOCIAL_V1'],
  supportedCodecProfileKeys: ['SOCIAL_H264_AAC_V1'],
  supportedAudioProfileKeys: ['SOCIAL_VOICE_MASTER_V1'],
  assetDependencies: [],
};

function resolved(localUri = `/render-work/${renderAttemptId}/product.mp4`) {
  return [
    {
      assetId,
      localUri,
      kind: 'VIDEO' as const,
      probe: {
        assetId,
        container: 'mp4',
        durationMs: 10_000,
        video: {
          codec: 'h264',
          width: 1080,
          height: 1920,
          fps: 30,
          color: {
            hdrKind: 'SDR' as const,
          },
        },
        probeVersion: 'fixture-v1',
      },
    },
  ];
}

it('converts millisecond windows to deterministic frame coverage', () => {
  expect(frameWindowFromMs(33, 67, 30, 1_000)).toEqual({
    startFrame: 0,
    endFrame: 3,
    frameCount: 3,
  });
});

it('compiles a deterministic render payload with pinned provenance', () => {
  const payload = compileRenderPayload({
    renderAttemptId,
    editingPlanVersionId,
    editingProfileVersionId,
    rendererVersion: 'renderer-build-v1',
    editingPlan: plan,
    template,
    resolvedAssets: resolved(),
  });

  expect(payload.provenance).toEqual({
    editingPlanVersionId,
    templateVersionId,
    editingProfileVersionId,
    rendererVersion: 'renderer-build-v1',
    colorProfileKey: 'SDR_BT709_SOCIAL_V1',
    codecProfileKey: 'SOCIAL_H264_AAC_V1',
    audioProfileKey: 'SOCIAL_VOICE_MASTER_V1',
  });

  expect(payload.editingPlan).toEqual(plan);
  expect(payload.resolvedAssets.map((asset) => asset.assetId)).toEqual([assetId]);
});

it('rejects arbitrary remote media URLs', () => {
  expect(() =>
    compileRenderPayload({
      renderAttemptId,
      editingPlanVersionId,
      editingProfileVersionId,
      rendererVersion: 'renderer-build-v1',
      editingPlan: plan,
      template,
      resolvedAssets: resolved('https://example.com/product.mp4'),
    }),
  ).toThrow('RENDER_REMOTE_ASSET_FORBIDDEN');
});

it('requires the exact resolved asset set', () => {
  expect(() =>
    compileRenderPayload({
      renderAttemptId,
      editingPlanVersionId,
      editingProfileVersionId,
      rendererVersion: 'renderer-build-v1',
      editingPlan: plan,
      template,
      resolvedAssets: [],
    }),
  ).toThrow('RENDER_INPUT_ASSET_SET_MISMATCH');
});
