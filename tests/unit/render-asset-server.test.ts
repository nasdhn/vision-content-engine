import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, it } from 'vitest';

import { RenderPayloadSchema } from '../../packages/contracts/src/index.js';
import { startLocalAssetServer } from '../../apps/worker-render/src/asset-server.js';

it('serves only pinned local assets and supports byte ranges for media seeking', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'vce-render-server-'));
  const path = join(dir, 'fixture.mp4');
  await writeFile(path, Buffer.from('0123456789'));

  const assetId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const payload = RenderPayloadSchema.parse({
    renderAttemptId: '11111111-1111-4111-8111-111111111111',
    template: {
      templateVersionId: '22222222-2222-4222-8222-222222222222',
      compositionKey: 'product-demo-v1',
      rendererApiVersion: 'v1',
      supportedCanvas: { width: 1080, height: 1920, allowedFps: [30] },
      supportedLayers: ['PRODUCT'],
      requiredSlots: [],
      optionalSlots: [],
      supportedMotionPresetKeys: ['CUT'],
      supportedTransitionPresetKeys: ['CUT'],
      supportedChromaKeyProfileKeys: ['GREENSCREEN_STANDARD_V1'],
      supportedColorProfileKeys: ['SDR_BT709_SOCIAL_V1'],
      supportedCodecProfileKeys: ['SOCIAL_H264_AAC_V1'],
      supportedAudioProfileKeys: ['SOCIAL_VOICE_MASTER_V1'],
      assetDependencies: [],
    },
    editingPlan: {
      masterDurationMs: 1_000,
      selectedAssets: [{ assetId, role: 'PRODUCT_CAPTURE', reason: 'fixture' }],
      timeline: [
        {
          id: 'asset',
          startMs: 0,
          endMs: 1_000,
          layer: 'PRODUCT',
          zIndex: 1,
          source: { type: 'ASSET', assetId },
          composition: {
            opacity: 1,
            region: { x: 0, y: 0, width: 1, height: 1 },
            scaleMode: 'FILL',
          },
          purpose: 'fixture',
        },
      ],
      productFocus: [],
      captions: [],
      onScreenText: [],
      presenter: [],
      audio: { sfx: [] },
      transitions: [],
      renderSettings: {
        width: 1080,
        height: 1920,
        fps: 30,
        codecProfileKey: 'SOCIAL_H264_AAC_V1',
        audioProfileKey: 'SOCIAL_VOICE_MASTER_V1',
      },
      rationale: {
        hookStrategy: 'fixture',
        pacingStrategy: 'fixture',
        attentionStrategy: 'fixture',
        proofStrategy: 'fixture',
        endingStrategy: 'fixture',
      },
    },
    resolvedAssets: [
      {
        assetId,
        localUri: path,
        kind: 'VIDEO',
        probe: {
          assetId,
          container: 'mov,mp4',
          durationMs: 1_000,
          video: { codec: 'h264', width: 1080, height: 1920, fps: 30 },
          probeVersion: 'fixture',
        },
      },
    ],
    renderSettings: {
      width: 1080,
      height: 1920,
      fps: 30,
      codecProfileKey: 'SOCIAL_H264_AAC_V1',
      audioProfileKey: 'SOCIAL_VOICE_MASTER_V1',
    },
    provenance: {
      editingPlanVersionId: '33333333-3333-4333-8333-333333333333',
      templateVersionId: '22222222-2222-4222-8222-222222222222',
      editingProfileVersionId: '44444444-4444-4444-8444-444444444444',
      rendererVersion: 'v1',
      colorProfileKey: 'SDR_BT709_SOCIAL_V1',
      codecProfileKey: 'SOCIAL_H264_AAC_V1',
      audioProfileKey: 'SOCIAL_VOICE_MASTER_V1',
    },
  });

  const server = await startLocalAssetServer({ payload });
  try {
    const url = server.payload.resolvedAssets[0]!.localUri;
    const range = await fetch(url, { headers: { Range: 'bytes=2-5' } });
    expect(range.status).toBe(206);
    expect(range.headers.get('content-range')).toBe('bytes 2-5/10');
    expect(await range.text()).toBe('2345');

    const missing = await fetch(url.replace(assetId, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'));
    expect(missing.status).toBe(404);
  } finally {
    await server.close();
    await rm(dir, { recursive: true, force: true });
  }
});
