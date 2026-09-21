import { expect, it } from 'vitest';

import { evaluateTechnicalQa } from '../../packages/application/src/index.js';

const payload = () => ({
  renderAttemptId: '11111111-1111-4111-8111-111111111111',
  template: {
    templateVersionId: '22222222-2222-4222-8222-222222222222',
    compositionKey: 'product-demo-v1',
    rendererApiVersion: 'v1',
    supportedCanvas: { width: 1080, height: 1920, allowedFps: [30] },
    supportedLayers: ['BACKGROUND', 'TEXT'],
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
    selectedAssets: [],
    timeline: [
      {
        id: 'shape',
        startMs: 0,
        endMs: 1_000,
        layer: 'BACKGROUND',
        zIndex: 0,
        source: { type: 'GENERATED_SHAPE', shapeKey: 'surface' },
        composition: {
          opacity: 1,
          region: { x: 0, y: 0, width: 1, height: 1 },
          scaleMode: 'FILL',
        },
        purpose: 'Visible deterministic background.',
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

const probe = () => ({
  assetId: '55555555-5555-4555-8555-555555555555',
  container: 'mov,mp4,m4a,3gp,3g2,mj2',
  durationMs: 1_000,
  video: {
    codec: 'h264',
    width: 1080,
    height: 1920,
    fps: 30,
    pixelFormat: 'yuv420p',
    rotationDeg: 0,
    color: {
      primaries: 'bt709',
      transfer: 'bt709',
      matrix: 'bt709',
      range: 'tv',
      hdrKind: 'SDR',
    },
  },
  probeVersion: 'ffprobe-v1',
});

it('passes a canonical silent SDR social master', () => {
  const qa = evaluateTechnicalQa({
    payload: payload(),
    probe: probe(),
    measurements: {
      fileSizeBytes: 10_000,
      blackDurationMs: 0,
      silenceDurationMs: 0,
    },
  });

  expect(qa.result).toBe('PASS');
  expect(qa.checks.filter((check) => check.status === 'FAIL')).toEqual([]);
  expect(qa.checks.find((check) => check.key === 'AUDIO_STREAM')?.status).toBe('NOT_APPLICABLE');
});

it('fails HDR signaling, frame-rate drift and catastrophic black output descriptively', () => {
  const badProbe = probe();
  badProbe.video.fps = 24;
  badProbe.video.color.hdrKind = 'HDR10';
  badProbe.video.color.primaries = 'bt2020';

  const qa = evaluateTechnicalQa({
    payload: payload(),
    probe: badProbe,
    measurements: {
      fileSizeBytes: 10_000,
      blackDurationMs: 900,
      silenceDurationMs: 0,
    },
  });

  expect(qa.result).toBe('FAIL');
  expect(qa.checks.filter((check) => check.status === 'FAIL').map((check) => check.key)).toEqual(
    expect.arrayContaining(['FPS', 'SDR_BT709', 'NO_HDR_SIGNALING', 'CATASTROPHIC_BLACK']),
  );
});
