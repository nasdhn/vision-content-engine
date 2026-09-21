import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import fixtureSpec from '../fixtures/media/phase5-media-fixtures.json' with { type: 'json' };
import { RenderPayloadSchema } from '../../packages/contracts/src/index.js';
import { evaluateTechnicalQa } from '../../packages/application/src/index.js';
import {
  inspectBlackAndSilence,
  probeFile,
  probeRenderFile,
} from '../../packages/media/src/index.js';
import { RemotionVideoRenderer } from '../../apps/worker-render/src/index.js';

const exec = promisify(execFile);
const ids = {
  attempt: '61111111-1111-4111-8111-111111111111',
  template: '62222222-2222-4222-8222-222222222222',
  editing: '63333333-3333-4333-8333-333333333333',
  profile: '64444444-4444-4444-8444-444444444444',
  product: '65555555-5555-4555-8555-555555555555',
  presenter: '66666666-6666-4666-8666-666666666666',
  voice: '67777777-7777-4777-8777-777777777777',
  output: '68888888-8888-4888-8888-888888888888',
} as const;

async function ffmpeg(args: string[]) {
  await exec('ffmpeg', ['-hide_banner', '-nostdin', '-y', ...args], {
    timeout: 120_000,
    maxBuffer: 4 * 1024 * 1024,
  });
}

const dir = await mkdtemp(join(tmpdir(), 'vce-phase5-media-regression-'));
try {
  const product = join(dir, 'product.mp4');
  const presenter = join(dir, 'presenter.mp4');
  const voice = join(dir, 'voice.wav');
  const blackSilence = join(dir, 'black-silence.mp4');

  await ffmpeg([
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=1080x1920:rate=30:duration=1.2',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-color_primaries',
    'bt709',
    '-color_trc',
    'bt709',
    '-colorspace',
    'bt709',
    '-color_range',
    'tv',
    '-x264-params',
    'colorprim=bt709:transfer=bt709:colormatrix=bt709:fullrange=off',
    '-an',
    product,
  ]);
  await ffmpeg([
    '-f',
    'lavfi',
    '-i',
    'color=c=0x00ff00:size=540x960:rate=30:duration=1.2',
    '-vf',
    'drawbox=x=150:y=180:w=240:h=600:color=red@1:t=fill',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-an',
    presenter,
  ]);
  await ffmpeg([
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:sample_rate=48000:duration=1.2',
    '-ac',
    '2',
    '-c:a',
    'pcm_s16le',
    voice,
  ]);
  await ffmpeg([
    '-f',
    'lavfi',
    '-i',
    'color=c=black:size=1080x1920:rate=30:duration=1.2',
    '-f',
    'lavfi',
    '-i',
    'anullsrc=r=48000:cl=stereo',
    '-t',
    '1.2',
    '-shortest',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    blackSilence,
  ]);

  const [productProbe, presenterProbe, voiceProbe] = await Promise.all([
    probeFile(product),
    probeFile(presenter),
    probeFile(voice),
  ]);
  const catastrophic = await inspectBlackAndSilence(blackSilence);

  assert.equal(fixtureSpec.fixtureVersion, 'phase5-media-v1');
  assert.equal(productProbe.video?.width, 1080);
  assert.equal(productProbe.video?.height, 1920);
  assert.equal(productProbe.video?.color.hdrKind, 'SDR');
  assert.equal(presenterProbe.video?.width, 540);
  assert.equal(presenterProbe.video?.height, 960);
  assert.equal(voiceProbe.audio?.sampleRate, 48000);
  assert.equal(voiceProbe.audio?.channels, 2);
  assert.ok(catastrophic.blackDurationMs >= 900, JSON.stringify(catastrophic));
  assert.ok(catastrophic.silenceDurationMs >= 900, JSON.stringify(catastrophic));

  const payload = RenderPayloadSchema.parse({
    renderAttemptId: ids.attempt,
    template: {
      templateVersionId: ids.template,
      compositionKey: 'green-screen-explainer-v1',
      rendererApiVersion: 'v1',
      supportedCanvas: { width: 1080, height: 1920, allowedFps: [30] },
      supportedLayers: ['BACKGROUND', 'PRODUCT', 'PRESENTER', 'TEXT', 'CAPTION'],
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
      masterDurationMs: 1200,
      selectedAssets: [
        {
          assetId: ids.product,
          role: 'PRODUCT_CAPTURE',
          sourceInMs: 0,
          sourceOutMs: 1200,
          reason: 'Synthetic product proof fixture.',
        },
        {
          assetId: ids.presenter,
          role: 'PRESENTER',
          sourceInMs: 0,
          sourceOutMs: 1200,
          reason: 'Synthetic green-screen presenter fixture.',
        },
        {
          assetId: ids.voice,
          role: 'VOICE',
          sourceInMs: 0,
          sourceOutMs: 1200,
          reason: 'Synthetic voice fixture.',
        },
      ],
      timeline: [
        {
          id: 'product',
          startMs: 0,
          endMs: 1200,
          layer: 'PRODUCT',
          zIndex: 10,
          source: { type: 'ASSET', assetId: ids.product },
          composition: {
            opacity: 1,
            region: { x: 0, y: 0, width: 1, height: 1 },
            scaleMode: 'CROP',
          },
          purpose: 'Exercise real product-video rendering.',
        },
      ],
      productFocus: [],
      captions: [
        {
          id: 'caption',
          startMs: 120,
          endMs: 1080,
          text: 'Vision trouve les bons prospects',
          timingSource: 'SPEECH_ALIGNED',
          emphasisRanges: [{ start: 0, end: 6, kind: 'KEYWORD' }],
        },
      ],
      onScreenText: [
        {
          id: 'result',
          startMs: 100,
          endMs: 1000,
          text: 'PREUVE PRODUIT',
          role: 'RESULT',
          region: { x: 0.12, y: 0.08, width: 0.76, height: 0.12 },
          motionPresetKey: 'RESULT_POP',
        },
      ],
      presenter: [
        {
          assetId: ids.presenter,
          startMs: 0,
          endMs: 1200,
          region: { x: 0.58, y: 0.38, width: 0.38, height: 0.52 },
          side: 'RIGHT',
          gestureDirection: 'LEFT',
          chromaKeyProfileKey: 'GREENSCREEN_STANDARD_V1',
        },
      ],
      audio: { voice: { assetId: ids.voice, gainDb: 0 }, sfx: [] },
      transitions: [],
      renderSettings: {
        width: 1080,
        height: 1920,
        fps: 30,
        codecProfileKey: 'SOCIAL_H264_AAC_V1',
        audioProfileKey: 'SOCIAL_VOICE_MASTER_V1',
      },
      rationale: {
        hookStrategy: 'Regression fixture.',
        pacingStrategy: 'Regression fixture.',
        attentionStrategy: 'Regression fixture.',
        proofStrategy: 'Regression fixture.',
        endingStrategy: 'Regression fixture.',
      },
    },
    resolvedAssets: [
      {
        assetId: ids.product,
        localUri: product,
        kind: 'VIDEO',
        probe: { assetId: ids.product, ...productProbe },
      },
      {
        assetId: ids.presenter,
        localUri: presenter,
        kind: 'VIDEO',
        probe: { assetId: ids.presenter, ...presenterProbe },
      },
      {
        assetId: ids.voice,
        localUri: voice,
        kind: 'AUDIO',
        probe: { assetId: ids.voice, ...voiceProbe },
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
      editingPlanVersionId: ids.editing,
      templateVersionId: ids.template,
      editingProfileVersionId: ids.profile,
      rendererVersion: 'v1',
      colorProfileKey: 'SDR_BT709_SOCIAL_V1',
      codecProfileKey: 'SOCIAL_H264_AAC_V1',
      audioProfileKey: 'SOCIAL_VOICE_MASTER_V1',
    },
  });

  const rendered = await new RemotionVideoRenderer().render(payload, {
    workDir: join(dir, 'render-work'),
  });
  const outputStat = await stat(rendered.outputPath);
  const outputProbe = await probeRenderFile(rendered.outputPath);
  const measurements = await inspectBlackAndSilence(rendered.outputPath);
  const qa = evaluateTechnicalQa({
    payload,
    probe: { assetId: ids.output, ...outputProbe },
    measurements: { fileSizeBytes: outputStat.size, ...measurements },
  });

  assert.equal(qa.result, 'PASS', JSON.stringify(qa, null, 2));
  assert.equal(outputProbe.video?.codec, 'h264');
  assert.equal(outputProbe.video?.width, 1080);
  assert.equal(outputProbe.video?.height, 1920);
  assert.equal(outputProbe.video?.pixelFormat, 'yuv420p');
  assert.equal(outputProbe.video?.color.primaries, 'bt709');
  assert.equal(outputProbe.video?.color.transfer, 'bt709');
  assert.equal(outputProbe.video?.color.matrix, 'bt709');
  assert.equal(outputProbe.audio?.sampleRate, 48000);
  assert.equal(outputProbe.audio?.channels, 2);
  assert.ok(
    rendered.diagnostics.logs.some((line) =>
      line.includes(`chroma:${ids.presenter}:GREENSCREEN_STANDARD_V1`),
    ),
    JSON.stringify(rendered.diagnostics),
  );

  console.log(
    JSON.stringify(
      {
        result: 'PASS',
        fixtureVersion: fixtureSpec.fixtureVersion,
        generatedFixtures: {
          product: productProbe,
          presenter: presenterProbe,
          voice: voiceProbe,
          catastrophic,
        },
        finalMaster: outputProbe,
        technicalQa: qa.result,
        chromaExecuted: true,
      },
      null,
      2,
    ),
  );
} finally {
  await rm(dir, { recursive: true, force: true });
}
