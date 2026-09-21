import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { RenderPayloadSchema } from '../../packages/contracts/src/index.js';
import { evaluateTechnicalQa } from '../../packages/application/src/index.js';
import { inspectBlackAndSilence, probeRenderFile } from '../../packages/media/src/index.js';
import { RemotionVideoRenderer } from '../../apps/worker-render/src/index.js';

const payload = RenderPayloadSchema.parse({
  renderAttemptId: '11111111-1111-4111-8111-111111111111',
  template: {
    templateVersionId: '22222222-2222-4222-8222-222222222222',
    compositionKey: 'product-demo-v1',
    rendererApiVersion: 'v1',
    supportedCanvas: { width: 1080, height: 1920, allowedFps: [30] },
    supportedLayers: ['BACKGROUND', 'TEXT'],
    requiredSlots: [],
    optionalSlots: [],
    supportedMotionPresetKeys: ['CUT', 'RESULT_POP'],
    supportedTransitionPresetKeys: ['CUT'],
    supportedChromaKeyProfileKeys: ['GREENSCREEN_STANDARD_V1'],
    supportedColorProfileKeys: ['SDR_BT709_SOCIAL_V1'],
    supportedCodecProfileKeys: ['SOCIAL_H264_AAC_V1'],
    supportedAudioProfileKeys: ['SOCIAL_VOICE_MASTER_V1'],
    assetDependencies: [],
  },
  editingPlan: {
    masterDurationMs: 400,
    selectedAssets: [],
    timeline: [
      {
        id: 'surface',
        startMs: 0,
        endMs: 400,
        layer: 'BACKGROUND',
        zIndex: 0,
        source: { type: 'GENERATED_SHAPE', shapeKey: 'surface' },
        composition: {
          opacity: 1,
          region: { x: 0, y: 0, width: 1, height: 1 },
          scaleMode: 'FILL',
        },
        purpose: 'Smoke-test visible surface.',
      },
    ],
    productFocus: [],
    captions: [],
    onScreenText: [
      {
        id: 'result',
        startMs: 0,
        endMs: 400,
        text: 'VISION',
        role: 'RESULT',
        region: { x: 0.15, y: 0.35, width: 0.7, height: 0.3 },
        motionPresetKey: 'RESULT_POP',
      },
    ],
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
      hookStrategy: 'Smoke test.',
      pacingStrategy: 'Smoke test.',
      attentionStrategy: 'Smoke test.',
      proofStrategy: 'Smoke test.',
      endingStrategy: 'Smoke test.',
    },
  },
  resolvedAssets: [],
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

const dir = await mkdtemp(join(tmpdir(), 'vce-remotion-smoke-'));
try {
  const rendered = await new RemotionVideoRenderer().render(payload, { workDir: dir });
  const outputStat = await stat(rendered.outputPath);
  const rawProbe = await probeRenderFile(rendered.outputPath);
  const measurements = await inspectBlackAndSilence(rendered.outputPath);
  const probe = {
    assetId: '55555555-5555-4555-8555-555555555555',
    container: rawProbe.container,
    durationMs: rawProbe.durationMs,
    ...(rawProbe.video ? { video: rawProbe.video } : {}),
    ...(rawProbe.audio ? { audio: rawProbe.audio } : {}),
    probeVersion: rawProbe.probeVersion,
  };
  const qa = evaluateTechnicalQa({
    payload,
    probe,
    measurements: { fileSizeBytes: outputStat.size, ...measurements },
  });

  if (qa.result !== 'PASS') {
    console.error(JSON.stringify(qa, null, 2));
    process.exitCode = 1;
  } else {
    console.log(
      JSON.stringify(
        {
          result: qa.result,
          fileSizeBytes: outputStat.size,
          durationMs: rawProbe.durationMs,
          video: rawProbe.video,
          diagnostics: rendered.diagnostics,
        },
        null,
        2,
      ),
    );
  }
} finally {
  await rm(dir, { recursive: true, force: true });
}
