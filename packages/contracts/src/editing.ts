import { z } from 'zod';

export const UuidSchema = z.string().uuid();

export const NormalizedRectSchema = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().positive().max(1),
    height: z.number().positive().max(1),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.x + value.width > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'x + width must be <= 1',
        path: ['width'],
      });
    }
    if (value.y + value.height > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'y + height must be <= 1',
        path: ['height'],
      });
    }
  });

export const SelectedAssetSchema = z
  .object({
    assetId: UuidSchema,
    role: z.enum([
      'VOICE',
      'PRESENTER',
      'PRODUCT_CAPTURE',
      'SCREENSHOT',
      'BROLL',
      'MUSIC',
      'SFX',
      'IMAGE',
    ]),
    sourceInMs: z.number().int().nonnegative().optional(),
    sourceOutMs: z.number().int().positive().optional(),
    reason: z.string().min(1),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      value.sourceInMs !== undefined &&
      value.sourceOutMs !== undefined &&
      value.sourceOutMs <= value.sourceInMs
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'sourceOutMs must be greater than sourceInMs',
        path: ['sourceOutMs'],
      });
    }
  });

export const TimelineSourceSchema = z.union([
  z
    .object({
      type: z.literal('ASSET'),
      assetId: UuidSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('GENERATED_TEXT'),
      textKey: z.string().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal('GENERATED_SHAPE'),
      shapeKey: z.string().min(1),
    })
    .strict(),
]);

export const TimelineBlockSchema = z
  .object({
    id: z.string().min(1),
    startMs: z.number().int().nonnegative(),
    endMs: z.number().int().positive(),
    layer: z.enum(['BACKGROUND', 'PRODUCT', 'BROLL', 'PRESENTER', 'TEXT', 'CAPTION', 'OVERLAY']),
    zIndex: z.number().int(),
    source: TimelineSourceSchema,
    composition: z
      .object({
        opacity: z.number().min(0).max(1),
        region: NormalizedRectSchema,
        scaleMode: z.enum(['FIT', 'FILL', 'CROP']),
        motionPresetKey: z.string().optional(),
      })
      .strict(),
    purpose: z.string().min(1),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.endMs <= value.startMs) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'endMs must be greater than startMs',
        path: ['endMs'],
      });
    }
  });

export const ProductFocusWindowSchema = z
  .object({
    startMs: z.number().int().nonnegative(),
    endMs: z.number().int().positive(),
    assetId: UuidSchema,
    region: NormalizedRectSchema,
    behavior: z.enum(['STATIC_CROP', 'ZOOM_IN', 'PAN', 'FOLLOW_TARGET']),
    reason: z.string().min(1),
  })
  .strict();

export const CaptionCueSchema = z
  .object({
    id: z.string().min(1),
    startMs: z.number().int().nonnegative(),
    endMs: z.number().int().positive(),
    text: z.string().min(1),
    segmentRef: z.string().optional(),
    timingSource: z.enum(['SPEECH_ALIGNED', 'ESTIMATED']),
    emphasisRanges: z.array(
      z
        .object({
          start: z.number().int().nonnegative(),
          end: z.number().int().positive(),
          kind: z.literal('KEYWORD'),
        })
        .strict(),
    ),
  })
  .strict();

export const EditorialTextCueSchema = z
  .object({
    id: z.string().min(1),
    startMs: z.number().int().nonnegative(),
    endMs: z.number().int().positive(),
    text: z.string().min(1),
    role: z.enum(['LABEL', 'NUMBER', 'COMPARISON', 'RESULT', 'CTA', 'EMPHASIS']),
    region: NormalizedRectSchema,
    motionPresetKey: z.string().optional(),
  })
  .strict();

export const PresenterCueSchema = z
  .object({
    assetId: UuidSchema,
    startMs: z.number().int().nonnegative(),
    endMs: z.number().int().positive(),
    region: NormalizedRectSchema,
    side: z.enum(['LEFT', 'RIGHT']),
    gestureDirection: z.enum(['LEFT', 'RIGHT', 'NONE']).optional(),
    pointingTarget: z
      .object({
        x: z.number().min(0).max(1),
        y: z.number().min(0).max(1),
      })
      .strict()
      .optional(),
    chromaKeyProfileKey: z.string().min(1),
  })
  .strict();

export const AudioPlanSchema = z
  .object({
    voice: z
      .object({
        assetId: UuidSchema,
        gainDb: z.number(),
      })
      .strict()
      .optional(),
    music: z
      .object({
        assetId: UuidSchema,
        gainDb: z.number(),
        startMs: z.number().int().nonnegative(),
        endMs: z.number().int().positive().optional(),
      })
      .strict()
      .optional(),
    sfx: z.array(
      z
        .object({
          assetId: UuidSchema,
          atMs: z.number().int().nonnegative(),
          gainDb: z.number(),
          purpose: z.string().min(1),
        })
        .strict(),
    ),
    ducking: z
      .object({
        musicUnderVoiceDb: z.number(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const TransitionInstructionSchema = z
  .object({
    atMs: z.number().int().nonnegative(),
    presetKey: z.string().min(1),
    durationMs: z.number().int().positive(),
    purpose: z.string().min(1),
  })
  .strict();

export const RenderSettingsSchema = z
  .object({
    width: z.literal(1080),
    height: z.literal(1920),
    fps: z.number().positive(),
    codecProfileKey: z.string().min(1),
    audioProfileKey: z.string().min(1),
  })
  .strict();

export const EditingRationaleSchema = z
  .object({
    hookStrategy: z.string().min(1),
    pacingStrategy: z.string().min(1),
    attentionStrategy: z.string().min(1),
    proofStrategy: z.string().min(1),
    endingStrategy: z.string().min(1),
  })
  .strict();

export const EditingPlanSpecSchema = z
  .object({
    masterDurationMs: z.number().int().positive(),
    selectedAssets: z.array(SelectedAssetSchema),
    timeline: z.array(TimelineBlockSchema),
    productFocus: z.array(ProductFocusWindowSchema),
    captions: z.array(CaptionCueSchema),
    onScreenText: z.array(EditorialTextCueSchema),
    presenter: z.array(PresenterCueSchema),
    audio: AudioPlanSchema,
    transitions: z.array(TransitionInstructionSchema),
    renderSettings: RenderSettingsSchema,
    rationale: EditingRationaleSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    const max = value.masterDurationMs;

    const timedCollections = [
      ['timeline', value.timeline],
      ['productFocus', value.productFocus],
      ['captions', value.captions],
      ['onScreenText', value.onScreenText],
      ['presenter', value.presenter],
    ] as const;

    for (const [name, items] of timedCollections) {
      // Frozen contract intentionally iterates heterogeneous timed collections.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      items.forEach((item: any, index: number) => {
        if (item.endMs > max) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `${name}[${index}].endMs exceeds masterDurationMs`,
            path: [name, index, 'endMs'],
          });
        }
        if (item.endMs <= item.startMs) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `${name}[${index}] has invalid timing`,
            path: [name, index, 'endMs'],
          });
        }
      });
    }

    value.transitions.forEach((t, index) => {
      if (t.atMs > max) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `transitions[${index}].atMs exceeds masterDurationMs`,
          path: ['transitions', index, 'atMs'],
        });
      }
    });
  });

export const EditingProfileVersionSpecSchema = z
  .object({
    identity: z
      .object({
        editingProfileVersionId: UuidSchema,
        key: z.string().min(1),
        version: z.number().int().positive(),
        name: z.string().min(1),
      })
      .strict(),

    pacing: z
      .object({
        targetEnergy: z.enum(['CALM', 'MODERATE', 'FAST', 'HIGH']),
        preferredAverageShotMs: z
          .object({
            min: z.number().int().positive(),
            max: z.number().int().positive(),
          })
          .strict(),
        maxDeadAirMs: z.number().int().nonnegative(),
        preserveNaturalPauseUpToMs: z.number().int().nonnegative(),
        maxUnchangedVisualMs: z.number().int().positive(),
        patternInterruptGuidance: z
          .object({
            enabled: z.boolean(),
            minimumSpacingMs: z.number().int().positive(),
            preferredTypes: z.array(z.string().min(1)),
          })
          .strict(),
      })
      .strict(),

    cuts: z
      .object({
        preferSemanticBoundaries: z.boolean(),
        minimumOrdinaryShotMs: z.number().int().positive(),
        allowFlashCuts: z.boolean(),
        avoidWordInternalCuts: z.boolean(),
      })
      .strict(),

    captions: z
      .object({
        mode: z.enum(['SEMANTIC_CHUNKS', 'SHORT_PHRASES']),
        maxLines: z.number().int().positive(),
        maxCharactersPerLine: z.number().int().positive(),
        minimumCueMs: z.number().int().positive(),
        maximumCueMs: z.number().int().positive(),
        emphasis: z
          .object({
            enabled: z.boolean(),
            maxHighlightedWordsPerCue: z.number().int().nonnegative(),
          })
          .strict(),
      })
      .strict(),

    focus: z
      .object({
        preferProductProofOverDecoration: z.boolean(),
        maxSimultaneousDominantElements: z.number().int().positive(),
        allowFollowTarget: z.boolean(),
      })
      .strict(),

    motion: z
      .object({
        allowedPresetKeys: z.array(z.string().min(1)),
        maximumConcurrentMotions: z.number().int().nonnegative(),
        preferSubtleMotion: z.boolean(),
        requirePurposeForMotion: z.boolean(),
        defaultTransitionDurationMs: z
          .object({
            min: z.number().int().positive(),
            max: z.number().int().positive(),
          })
          .strict(),
      })
      .strict(),

    presenter: z
      .object({
        allowedSides: z.array(z.enum(['LEFT', 'RIGHT'])).min(1),
        preferredWidthPercent: z
          .object({
            min: z.number().positive().max(100),
            max: z.number().positive().max(100),
          })
          .strict(),
        avoidCoveringProductRegion: z.boolean(),
        avoidCoveringCaptionRegion: z.boolean(),
        gestureAwarePlacement: z.boolean(),
        maximumContinuousPresenterMs: z.number().int().positive().optional(),
      })
      .strict(),

    audio: z
      .object({
        voiceTargetLoudness: z
          .object({
            targetLufs: z.number(),
            tolerance: z.number().nonnegative(),
          })
          .strict(),
        music: z
          .object({
            enabled: z.boolean(),
            defaultUnderVoiceDb: z.number(),
            allowNoMusic: z.boolean(),
          })
          .strict(),
        sfx: z
          .object({
            enabled: z.boolean(),
            maxEventsPer10Sec: z.number().int().nonnegative(),
          })
          .strict(),
        avoidContinuousAttentionSfx: z.boolean(),
      })
      .strict(),

    hook: z
      .object({
        maxSetupMs: z.number().int().nonnegative(),
        requireMeaningfulFirstFrame: z.boolean(),
        allowLogoIntro: z.literal(false),
        preferredOpeningModes: z
          .array(z.enum(['PRESENTER', 'PRODUCT_RESULT', 'PROBLEM_VISUAL', 'TEXT_STATEMENT']))
          .min(1),
        maximumSimultaneousFocalElements: z.number().int().positive(),
      })
      .strict(),

    ending: z
      .object({
        avoidDeadEnding: z.boolean(),
        preferredCtaLeadInMs: z.number().int().nonnegative(),
        allowAbruptCutIfIntentional: z.boolean(),
      })
      .strict(),

    constraints: z
      .object({
        suitablePrimaryFormats: z.array(z.string().min(1)).min(1),
        minDurationMs: z.number().int().positive(),
        maxDurationMs: z.number().int().positive(),
        requiresHumanPresenter: z.boolean(),
      })
      .strict(),
  })
  .strict();
