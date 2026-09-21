import { z } from 'zod';

import {
  EditingPlanSpecSchema,
  EditingProfileVersionSpecSchema,
  NormalizedRectSchema,
  TemplateRuntimeContractSchema,
} from '@vision/contracts';

export type EditingPlanValidationCode =
  | 'EDITING_PLAN_SCHEMA_INVALID'
  | 'EDITING_PROFILE_CONTRACT_FAILED'
  | 'INPUT_ASSET_MISSING'
  | 'ASSET_SELECTION_INVALID'
  | 'ASSET_TRIM_INVALID'
  | 'PRESET_UNKNOWN'
  | 'TEMPLATE_CONTRACT_FAILED'
  | 'CAPTION_POLICY_FAILED'
  | 'AUDIO_POLICY_FAILED'
  | 'SAFE_ZONE_INVALID'
  | 'COLLISION_VALIDATION_FAILED';

export class EditingPlanValidationError extends Error {
  constructor(readonly code: EditingPlanValidationCode) {
    super(code);
    this.name = 'EditingPlanValidationError';
  }
}

const AvailableAssetSchema = z
  .object({
    assetId: z.string().uuid(),
    kind: z.enum(['VIDEO', 'AUDIO', 'IMAGE', 'FONT', 'OTHER']),
    durationMs: z.number().int().nonnegative().optional(),
  })
  .strict();

type Rect = z.infer<typeof NormalizedRectSchema>;
type EditingProfile = z.infer<typeof EditingProfileVersionSpecSchema>;
type Template = z.infer<typeof TemplateRuntimeContractSchema>;

export type EditingAvailableAsset = z.infer<typeof AvailableAssetSchema>;

export type EditingSafeZones = {
  caption?: Rect;
  cta?: Rect;
  presenter?: Rect;
  product?: Rect;
};

export type EditingPlanValidationContext = {
  availableAssets: readonly EditingAvailableAsset[];
  profile: EditingProfile;
  template: Template;
  primaryFormat: string;

  motionPresetKeys: Iterable<string>;
  transitionPresetKeys: Iterable<string>;
  chromaKeyProfileKeys: Iterable<string>;
  codecProfileKeys: Iterable<string>;
  audioProfileKeys: Iterable<string>;

  safeZones?: EditingSafeZones;
};

function check(condition: unknown, code: EditingPlanValidationCode): asserts condition {
  if (!condition) throw new EditingPlanValidationError(code);
}

function intersects(a: Rect, b: Rect) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function contains(outer: Rect, inner: Rect) {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

function overlapsTime(
  a: { startMs: number; endMs: number },
  b: { startMs: number; endMs: number },
) {
  return a.startMs < b.endMs && b.startMs < a.endMs;
}

function parsePlan(input: unknown) {
  const result = EditingPlanSpecSchema.safeParse(input);
  if (!result.success) throw new EditingPlanValidationError('EDITING_PLAN_SCHEMA_INVALID');
  return result.data;
}

function parseProfile(input: unknown) {
  const result = EditingProfileVersionSpecSchema.safeParse(input);
  if (!result.success) throw new EditingPlanValidationError('EDITING_PROFILE_CONTRACT_FAILED');
  return result.data;
}

function parseTemplate(input: unknown) {
  const result = TemplateRuntimeContractSchema.safeParse(input);
  if (!result.success) throw new EditingPlanValidationError('TEMPLATE_CONTRACT_FAILED');
  return result.data;
}

function slotTypeForAsset(
  role:
    'VOICE' | 'PRESENTER' | 'PRODUCT_CAPTURE' | 'SCREENSHOT' | 'BROLL' | 'MUSIC' | 'SFX' | 'IMAGE',
  kind: EditingAvailableAsset['kind'],
) {
  switch (role) {
    case 'PRESENTER':
      return 'PRESENTER' as const;

    case 'PRODUCT_CAPTURE':
    case 'SCREENSHOT':
      return 'PRODUCT' as const;

    case 'BROLL':
      return kind === 'IMAGE' ? ('IMAGE' as const) : ('VIDEO' as const);

    case 'VOICE':
    case 'MUSIC':
    case 'SFX':
      return 'AUDIO' as const;

    case 'IMAGE':
      return 'IMAGE' as const;
  }
}

export function validateEditingPlan(input: unknown, rawContext: EditingPlanValidationContext) {
  const plan = parsePlan(input);
  const profile = parseProfile(rawContext.profile);
  const template = parseTemplate(rawContext.template);

  check(
    profile.constraints.suitablePrimaryFormats.includes(rawContext.primaryFormat),
    'EDITING_PROFILE_CONTRACT_FAILED',
  );

  check(
    plan.masterDurationMs >= profile.constraints.minDurationMs &&
      plan.masterDurationMs <= profile.constraints.maxDurationMs,
    'EDITING_PROFILE_CONTRACT_FAILED',
  );

  const motionPresetKeys = new Set(rawContext.motionPresetKeys);
  const transitionPresetKeys = new Set(rawContext.transitionPresetKeys);
  const chromaKeyProfileKeys = new Set(rawContext.chromaKeyProfileKeys);
  const codecProfileKeys = new Set(rawContext.codecProfileKeys);
  const audioProfileKeys = new Set(rawContext.audioProfileKeys);

  const availableAssets = rawContext.availableAssets.map((asset) =>
    AvailableAssetSchema.parse(asset),
  );

  check(
    new Set(availableAssets.map((asset) => asset.assetId)).size === availableAssets.length,
    'ASSET_SELECTION_INVALID',
  );

  const availableById = new Map(availableAssets.map((asset) => [asset.assetId, asset] as const));

  check(
    new Set(plan.selectedAssets.map((asset) => asset.assetId)).size === plan.selectedAssets.length,
    'ASSET_SELECTION_INVALID',
  );

  const selectedById = new Map(plan.selectedAssets.map((asset) => [asset.assetId, asset] as const));

  for (const selected of plan.selectedAssets) {
    const available = availableById.get(selected.assetId);

    check(available, 'INPUT_ASSET_MISSING');

    const hasIn = selected.sourceInMs !== undefined;
    const hasOut = selected.sourceOutMs !== undefined;

    check(hasIn === hasOut, 'ASSET_TRIM_INVALID');

    if (hasIn && hasOut) {
      check(available.kind === 'VIDEO' || available.kind === 'AUDIO', 'ASSET_TRIM_INVALID');
      check(available.durationMs !== undefined, 'ASSET_TRIM_INVALID');
      check(
        selected.sourceInMs! >= 0 &&
          selected.sourceOutMs! > selected.sourceInMs! &&
          selected.sourceOutMs! <= available.durationMs,
        'ASSET_TRIM_INVALID',
      );
    }

    switch (selected.role) {
      case 'VOICE':
        check(available.kind === 'AUDIO' || available.kind === 'VIDEO', 'ASSET_SELECTION_INVALID');
        break;

      case 'PRESENTER':
      case 'PRODUCT_CAPTURE':
        check(available.kind === 'VIDEO' || available.kind === 'IMAGE', 'ASSET_SELECTION_INVALID');
        break;

      case 'SCREENSHOT':
      case 'IMAGE':
        check(available.kind === 'IMAGE', 'ASSET_SELECTION_INVALID');
        break;

      case 'BROLL':
        check(available.kind === 'VIDEO' || available.kind === 'IMAGE', 'ASSET_SELECTION_INVALID');
        break;

      case 'MUSIC':
      case 'SFX':
        check(available.kind === 'AUDIO', 'ASSET_SELECTION_INVALID');
        break;
    }
  }

  const selected = (assetId: string) => {
    const result = selectedById.get(assetId);
    check(result, 'ASSET_SELECTION_INVALID');
    check(availableById.has(assetId), 'INPUT_ASSET_MISSING');
    return result;
  };

  check(
    new Set(plan.timeline.map((block) => block.id)).size === plan.timeline.length,
    'EDITING_PLAN_SCHEMA_INVALID',
  );

  const validateMotion = (key: string) => {
    check(motionPresetKeys.has(key), 'PRESET_UNKNOWN');
    check(template.supportedMotionPresetKeys.includes(key), 'TEMPLATE_CONTRACT_FAILED');
    check(profile.motion.allowedPresetKeys.includes(key), 'EDITING_PROFILE_CONTRACT_FAILED');
  };

  for (const block of plan.timeline) {
    check(template.supportedLayers.includes(block.layer), 'TEMPLATE_CONTRACT_FAILED');

    if (block.source.type === 'ASSET') selected(block.source.assetId);

    if (block.composition.motionPresetKey) validateMotion(block.composition.motionPresetKey);
  }

  for (const focus of plan.productFocus) {
    const asset = selected(focus.assetId);
    check(
      asset.role === 'PRODUCT_CAPTURE' || asset.role === 'SCREENSHOT',
      'ASSET_SELECTION_INVALID',
    );

    if (focus.behavior === 'FOLLOW_TARGET')
      check(profile.focus.allowFollowTarget, 'EDITING_PROFILE_CONTRACT_FAILED');
  }

  check(
    new Set(plan.captions.map((cue) => cue.id)).size === plan.captions.length,
    'CAPTION_POLICY_FAILED',
  );

  for (const cue of plan.captions) {
    const duration = cue.endMs - cue.startMs;

    check(
      duration >= profile.captions.minimumCueMs && duration <= profile.captions.maximumCueMs,
      'CAPTION_POLICY_FAILED',
    );

    const lines = cue.text.split('\n');

    check(lines.length <= profile.captions.maxLines, 'CAPTION_POLICY_FAILED');
    check(
      lines.every((line) => [...line].length <= profile.captions.maxCharactersPerLine),
      'CAPTION_POLICY_FAILED',
    );

    if (!profile.captions.emphasis.enabled)
      check(cue.emphasisRanges.length === 0, 'CAPTION_POLICY_FAILED');

    check(
      cue.emphasisRanges.length <= profile.captions.emphasis.maxHighlightedWordsPerCue,
      'CAPTION_POLICY_FAILED',
    );

    for (const emphasis of cue.emphasisRanges)
      check(
        emphasis.end > emphasis.start && emphasis.end <= cue.text.length,
        'CAPTION_POLICY_FAILED',
      );
  }

  check(
    new Set(plan.onScreenText.map((cue) => cue.id)).size === plan.onScreenText.length,
    'EDITING_PLAN_SCHEMA_INVALID',
  );

  for (const cue of plan.onScreenText) if (cue.motionPresetKey) validateMotion(cue.motionPresetKey);

  for (const presenter of plan.presenter) {
    const asset = selected(presenter.assetId);

    check(asset.role === 'PRESENTER', 'ASSET_SELECTION_INVALID');
    check(
      profile.presenter.allowedSides.includes(presenter.side),
      'EDITING_PROFILE_CONTRACT_FAILED',
    );

    const widthPercent = presenter.region.width * 100;

    check(
      widthPercent >= profile.presenter.preferredWidthPercent.min &&
        widthPercent <= profile.presenter.preferredWidthPercent.max,
      'EDITING_PROFILE_CONTRACT_FAILED',
    );

    if (profile.presenter.maximumContinuousPresenterMs !== undefined)
      check(
        presenter.endMs - presenter.startMs <= profile.presenter.maximumContinuousPresenterMs,
        'EDITING_PROFILE_CONTRACT_FAILED',
      );

    check(chromaKeyProfileKeys.has(presenter.chromaKeyProfileKey), 'PRESET_UNKNOWN');
    check(
      template.supportedChromaKeyProfileKeys.includes(presenter.chromaKeyProfileKey),
      'TEMPLATE_CONTRACT_FAILED',
    );
  }

  if (profile.constraints.requiresHumanPresenter)
    check(
      plan.selectedAssets.some((asset) => asset.role === 'PRESENTER') && plan.presenter.length > 0,
      'EDITING_PROFILE_CONTRACT_FAILED',
    );

  if (plan.audio.voice) {
    const voice = selected(plan.audio.voice.assetId);
    const source = availableById.get(voice.assetId)!;

    check(voice.role === 'VOICE' || voice.role === 'PRESENTER', 'AUDIO_POLICY_FAILED');
    check(source.kind === 'AUDIO' || source.kind === 'VIDEO', 'AUDIO_POLICY_FAILED');
  }

  if (plan.audio.music) {
    const music = selected(plan.audio.music.assetId);
    const source = availableById.get(music.assetId)!;

    check(profile.audio.music.enabled, 'AUDIO_POLICY_FAILED');
    check(music.role === 'MUSIC', 'AUDIO_POLICY_FAILED');
    check(source.kind === 'AUDIO', 'AUDIO_POLICY_FAILED');
    check(plan.audio.music.startMs <= plan.masterDurationMs, 'AUDIO_POLICY_FAILED');

    if (plan.audio.music.endMs !== undefined)
      check(
        plan.audio.music.endMs > plan.audio.music.startMs &&
          plan.audio.music.endMs <= plan.masterDurationMs,
        'AUDIO_POLICY_FAILED',
      );
  }

  if (plan.audio.ducking) check(plan.audio.music !== undefined, 'AUDIO_POLICY_FAILED');

  if (!profile.audio.sfx.enabled) check(plan.audio.sfx.length === 0, 'AUDIO_POLICY_FAILED');

  for (const sfx of plan.audio.sfx) {
    const asset = selected(sfx.assetId);
    const source = availableById.get(asset.assetId)!;

    check(asset.role === 'SFX', 'AUDIO_POLICY_FAILED');
    check(source.kind === 'AUDIO', 'AUDIO_POLICY_FAILED');
    check(sfx.atMs <= plan.masterDurationMs, 'AUDIO_POLICY_FAILED');
  }

  for (const event of plan.audio.sfx) {
    const eventsInWindow = plan.audio.sfx.filter(
      (candidate) => candidate.atMs >= event.atMs && candidate.atMs < event.atMs + 10_000,
    ).length;

    check(eventsInWindow <= profile.audio.sfx.maxEventsPer10Sec, 'AUDIO_POLICY_FAILED');
  }

  for (const transition of plan.transitions) {
    check(transitionPresetKeys.has(transition.presetKey), 'PRESET_UNKNOWN');
    check(
      template.supportedTransitionPresetKeys.includes(transition.presetKey),
      'TEMPLATE_CONTRACT_FAILED',
    );
    check(
      profile.motion.allowedPresetKeys.includes(transition.presetKey),
      'EDITING_PROFILE_CONTRACT_FAILED',
    );
    check(transition.atMs <= plan.masterDurationMs, 'EDITING_PLAN_SCHEMA_INVALID');
    check(
      transition.atMs + transition.durationMs <= plan.masterDurationMs,
      'EDITING_PLAN_SCHEMA_INVALID',
    );
  }

  check(
    plan.renderSettings.width === template.supportedCanvas.width &&
      plan.renderSettings.height === template.supportedCanvas.height &&
      template.supportedCanvas.allowedFps.includes(plan.renderSettings.fps),
    'TEMPLATE_CONTRACT_FAILED',
  );

  check(codecProfileKeys.has(plan.renderSettings.codecProfileKey), 'PRESET_UNKNOWN');
  check(
    template.supportedCodecProfileKeys.includes(plan.renderSettings.codecProfileKey),
    'TEMPLATE_CONTRACT_FAILED',
  );

  check(audioProfileKeys.has(plan.renderSettings.audioProfileKey), 'PRESET_UNKNOWN');
  check(
    template.supportedAudioProfileKeys.includes(plan.renderSettings.audioProfileKey),
    'TEMPLATE_CONTRACT_FAILED',
  );

  for (const dependencyId of template.assetDependencies)
    check(availableById.has(dependencyId), 'INPUT_ASSET_MISSING');

  const counts = new Map<string, number>();

  for (const item of plan.selectedAssets) {
    const source = availableById.get(item.assetId)!;
    const type = slotTypeForAsset(item.role, source.kind);
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }

  if (plan.onScreenText.length > 0 || plan.timeline.some((b) => b.layer === 'TEXT'))
    counts.set('TEXT', Math.max(counts.get('TEXT') ?? 0, 1));

  for (const slot of template.requiredSlots)
    check((counts.get(slot.accepts) ?? 0) > 0, 'TEMPLATE_CONTRACT_FAILED');

  const captionBlocks = plan.timeline.filter((block) => block.layer === 'CAPTION');

  for (const presenter of plan.presenter) {
    if (profile.presenter.avoidCoveringProductRegion)
      for (const focus of plan.productFocus)
        if (overlapsTime(presenter, focus) && intersects(presenter.region, focus.region))
          throw new EditingPlanValidationError('COLLISION_VALIDATION_FAILED');

    if (profile.presenter.avoidCoveringCaptionRegion)
      for (const caption of captionBlocks)
        if (
          overlapsTime(presenter, caption) &&
          intersects(presenter.region, caption.composition.region)
        )
          throw new EditingPlanValidationError('COLLISION_VALIDATION_FAILED');
  }

  for (const caption of captionBlocks) {
    for (const focus of plan.productFocus)
      if (overlapsTime(caption, focus) && intersects(caption.composition.region, focus.region))
        throw new EditingPlanValidationError('COLLISION_VALIDATION_FAILED');

    for (const text of plan.onScreenText)
      if (
        text.role === 'CTA' &&
        overlapsTime(caption, text) &&
        intersects(caption.composition.region, text.region)
      )
        throw new EditingPlanValidationError('COLLISION_VALIDATION_FAILED');
  }

  for (let i = 0; i < plan.onScreenText.length; i++)
    for (let j = i + 1; j < plan.onScreenText.length; j++) {
      const a = plan.onScreenText[i]!;
      const b = plan.onScreenText[j]!;

      if (overlapsTime(a, b) && intersects(a.region, b.region))
        throw new EditingPlanValidationError('COLLISION_VALIDATION_FAILED');
    }

  if (rawContext.safeZones) {
    const safeZones = Object.fromEntries(
      Object.entries(rawContext.safeZones).map(([key, value]) => {
        const parsed = NormalizedRectSchema.safeParse(value);
        check(parsed.success, 'SAFE_ZONE_INVALID');
        return [key, parsed.data];
      }),
    ) as EditingSafeZones;

    if (safeZones.caption)
      for (const block of captionBlocks)
        check(contains(safeZones.caption, block.composition.region), 'SAFE_ZONE_INVALID');

    if (safeZones.cta)
      for (const cue of plan.onScreenText.filter((item) => item.role === 'CTA'))
        check(contains(safeZones.cta, cue.region), 'SAFE_ZONE_INVALID');

    if (safeZones.presenter)
      for (const cue of plan.presenter)
        check(contains(safeZones.presenter, cue.region), 'SAFE_ZONE_INVALID');

    if (safeZones.product)
      for (const focus of plan.productFocus)
        check(contains(safeZones.product, focus.region), 'SAFE_ZONE_INVALID');
  }

  return plan;
}
