import type { z } from 'zod';
import { expect, it } from 'vitest';

import fastProfile from '../../packages/application/editing-profile-seeds/FAST_PRODUCT_DEMO.json' with { type: 'json' };
import productTemplateEnvelope from '../../docs/spec-artifacts/templates/PRODUCT_DEMO.json' with { type: 'json' };
import motionRegistry from '../../docs/spec-artifacts/video-engine/motion-registry.json' with { type: 'json' };
import transitionRegistry from '../../docs/spec-artifacts/video-engine/transition-registry.json' with { type: 'json' };
import chromaRegistry from '../../docs/spec-artifacts/video-engine/chroma-key-profiles.json' with { type: 'json' };
import codecRegistry from '../../docs/spec-artifacts/video-engine/codec-profiles.json' with { type: 'json' };
import audioRegistry from '../../docs/spec-artifacts/video-engine/audio-profiles.json' with { type: 'json' };

import {
  EditingPlanValidationError,
  validateEditingPlan,
} from '../../packages/application/src/editing-plan-validator.js';
import {
  type EditingPlanSpecSchema,
  EditingProfileVersionSpecSchema,
  TemplateRuntimeContractSchema,
} from '../../packages/contracts/src/index.js';

type EditingPlan = z.infer<typeof EditingPlanSpecSchema>;

const productId = '018f5000-0000-7000-8000-000000000001';
const voiceId = '018f5000-0000-7000-8000-000000000002';
const presenterId = '018f5000-0000-7000-8000-000000000003';

const runtimeTemplate = Object.fromEntries(
  Object.entries(productTemplateEnvelope).filter(
    ([key]) => !['templateKey', 'name', 'version', 'sourceRevision'].includes(key),
  ),
);

const template = TemplateRuntimeContractSchema.parse(runtimeTemplate);
const profile = EditingProfileVersionSpecSchema.parse(fastProfile);

const availableAssets = [
  {
    assetId: productId,
    kind: 'VIDEO' as const,
    durationMs: 12_000,
  },
  {
    assetId: voiceId,
    kind: 'AUDIO' as const,
    durationMs: 10_000,
  },
  {
    assetId: presenterId,
    kind: 'VIDEO' as const,
    durationMs: 10_000,
  },
];

const context = () => ({
  availableAssets,
  profile,
  template,
  primaryFormat: 'PRODUCT_DEMO',
  motionPresetKeys: Object.keys(motionRegistry.presets),
  transitionPresetKeys: Object.keys(transitionRegistry.presets),
  chromaKeyProfileKeys: Object.keys(chromaRegistry.profiles),
  codecProfileKeys: Object.keys(codecRegistry.profiles),
  audioProfileKeys: Object.keys(audioRegistry.profiles),
});

const plan = (): EditingPlan => ({
  masterDurationMs: 10_000,
  selectedAssets: [
    {
      assetId: productId,
      role: 'PRODUCT_CAPTURE' as const,
      sourceInMs: 0,
      sourceOutMs: 10_000,
      reason: 'Primary product proof.',
    },
    {
      assetId: voiceId,
      role: 'VOICE' as const,
      sourceInMs: 0,
      sourceOutMs: 10_000,
      reason: 'Natural narration.',
    },
  ],
  timeline: [
    {
      id: 'product-main',
      startMs: 0,
      endMs: 10_000,
      layer: 'PRODUCT' as const,
      zIndex: 10,
      source: {
        type: 'ASSET' as const,
        assetId: productId,
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
      purpose: 'Show the actual product proof.',
    },
  ],
  productFocus: [
    {
      startMs: 1_000,
      endMs: 5_000,
      assetId: productId,
      region: {
        x: 0.2,
        y: 0.2,
        width: 0.7,
        height: 0.4,
      },
      behavior: 'STATIC_CROP' as const,
      reason: 'Keep the result readable.',
    },
  ],
  captions: [],
  onScreenText: [],
  presenter: [],
  audio: {
    voice: {
      assetId: voiceId,
      gainDb: 0,
    },
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
    hookStrategy: 'Immediate product proof.',
    pacingStrategy: 'Fast but readable.',
    attentionStrategy: 'Keep one dominant product region.',
    proofStrategy: 'Use the actual Vision capture.',
    endingStrategy: 'End without dead air.',
  },
});

function expectCode(fn: () => unknown, code: string) {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(EditingPlanValidationError);
    expect((error as EditingPlanValidationError).code).toBe(code);
    return;
  }

  throw new Error(`Expected ${code}`);
}

it('accepts a deterministic valid product-demo EditingPlan', () => {
  expect(() => validateEditingPlan(plan(), context())).not.toThrow();
});

it('rejects a selected Asset that is absent from the validated asset set', () => {
  const input = plan();
  input.selectedAssets[0]!.assetId = '018f5000-0000-7000-8000-000000000099';

  expectCode(() => validateEditingPlan(input, context()), 'INPUT_ASSET_MISSING');
});

it('rejects source trims beyond the probed source duration', () => {
  const input = plan();
  input.selectedAssets[0]!.sourceOutMs = 20_000;

  expectCode(() => validateEditingPlan(input, context()), 'ASSET_TRIM_INVALID');
});

it('rejects an unknown deterministic motion preset', () => {
  const input = plan();
  input.timeline[0]!.composition.motionPresetKey = 'UNKNOWN_MOTION';

  expectCode(() => validateEditingPlan(input, context()), 'PRESET_UNKNOWN');
});

it('rejects a layer unsupported by the selected Template', () => {
  const input = plan();
  input.timeline[0]!.layer = 'BROLL';

  expectCode(() => validateEditingPlan(input, context()), 'TEMPLATE_CONTRACT_FAILED');
});

it('requires the Template product slot to be satisfied', () => {
  const input = plan();

  input.selectedAssets = input.selectedAssets.filter((asset) => asset.role !== 'PRODUCT_CAPTURE');
  input.timeline = [];
  input.productFocus = [];

  expectCode(() => validateEditingPlan(input, context()), 'TEMPLATE_CONTRACT_FAILED');
});

it('rejects presenter overlap with an active product proof region', () => {
  const input = plan();

  input.selectedAssets.push({
    assetId: presenterId,
    role: 'PRESENTER',
    sourceInMs: 0,
    sourceOutMs: 10_000,
    reason: 'Presenter points toward product proof.',
  });

  input.presenter.push({
    assetId: presenterId,
    startMs: 1_000,
    endMs: 4_000,
    region: {
      x: 0.1,
      y: 0.1,
      width: 0.3,
      height: 0.8,
    },
    side: 'LEFT',
    gestureDirection: 'RIGHT',
    chromaKeyProfileKey: 'GREENSCREEN_STANDARD_V1',
  });

  expectCode(() => validateEditingPlan(input, context()), 'COLLISION_VALIDATION_FAILED');
});

it('rejects a caption region covering an active CTA', () => {
  const input = plan();

  input.timeline.push({
    id: 'caption-layer',
    startMs: 7_000,
    endMs: 9_000,
    layer: 'CAPTION',
    zIndex: 50,
    source: {
      type: 'GENERATED_TEXT',
      textKey: 'caption-1',
    },
    composition: {
      opacity: 1,
      region: {
        x: 0.1,
        y: 0.75,
        width: 0.8,
        height: 0.15,
      },
      scaleMode: 'FIT',
    },
    purpose: 'Speech caption.',
  });

  input.onScreenText.push({
    id: 'cta',
    startMs: 7_500,
    endMs: 9_500,
    text: 'Essaie Vision',
    role: 'CTA',
    region: {
      x: 0.2,
      y: 0.8,
      width: 0.6,
      height: 0.1,
    },
  });

  expectCode(() => validateEditingPlan(input, context()), 'COLLISION_VALIDATION_FAILED');
});

it('enforces EditingProfile caption readability bounds', () => {
  const input = plan();

  input.captions.push({
    id: 'too-fast',
    startMs: 1_000,
    endMs: 1_300,
    text: 'Trop rapide',
    timingSource: 'SPEECH_ALIGNED',
    emphasisRanges: [],
  });

  expectCode(() => validateEditingPlan(input, context()), 'CAPTION_POLICY_FAILED');
});

it('rejects render FPS unsupported by the selected Template', () => {
  const input = plan();
  input.renderSettings.fps = 24;

  expectCode(() => validateEditingPlan(input, context()), 'TEMPLATE_CONTRACT_FAILED');
});

it('rejects a transition window that overflows the master duration', () => {
  const input = plan();

  input.transitions.push({
    atMs: 9_900,
    presetKey: 'MASK_REVEAL',
    durationMs: 260,
    purpose: 'Reveal the ending result.',
  });

  expectCode(() => validateEditingPlan(input, context()), 'EDITING_PLAN_SCHEMA_INVALID');
});
