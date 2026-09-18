import { z } from "zod";
import { UuidSchema } from "./shared";

export const TimelineBlockSchema = z.object({
  id: z.string().min(1),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().positive(),
  source: z.union([
    z.object({
      type: z.literal("ASSET"),
      assetId: UuidSchema,
    }).strict(),
    z.object({
      type: z.literal("GENERATED_TEXT"),
    }).strict(),
    z.object({
      type: z.literal("GENERATED_SHAPE"),
    }).strict(),
  ]),
  role: z.enum([
    "HOOK",
    "PRODUCT",
    "PRESENTER",
    "BROLL",
    "TEXT",
    "CTA",
    "BACKGROUND",
  ]),
  crop: z.object({
    x: z.number(),
    y: z.number(),
    width: z.number().positive(),
    height: z.number().positive(),
  }).strict().optional(),
  transform: z.object({
    scale: z.number().positive().optional(),
    x: z.number().optional(),
    y: z.number().optional(),
    rotationDeg: z.number().optional(),
  }).strict().optional(),
  motionPreset: z.string().optional(),
  purpose: z.string().min(1),
}).strict();

export const CaptionCueSchema = z.object({
  id: z.string().min(1),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().positive(),
  text: z.string().min(1),
  segmentRef: z.string().optional(),
  emphasisRanges: z.array(z.object({
    start: z.number().int().nonnegative(),
    end: z.number().int().positive(),
    kind: z.literal("KEYWORD"),
  }).strict()),
}).strict();

export const AudioPlanSchema = z.object({
  voice: z.object({
    assetId: UuidSchema,
    gainDb: z.number(),
  }).strict().optional(),
  music: z.object({
    assetId: UuidSchema,
    gainDb: z.number(),
    startMs: z.number().int().nonnegative(),
    endMs: z.number().int().positive().optional(),
  }).strict().optional(),
  sfx: z.array(z.object({
    assetId: UuidSchema,
    atMs: z.number().int().nonnegative(),
    gainDb: z.number(),
    purpose: z.string().min(1),
  }).strict()),
  ducking: z.object({
    musicUnderVoiceDb: z.number(),
  }).strict().optional(),
}).strict();

export const VisualFocusInstructionSchema = z.object({
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().positive(),
  targetAssetId: UuidSchema,
  targetRegion: z.object({
    x: z.number(),
    y: z.number(),
    width: z.number().positive(),
    height: z.number().positive(),
  }).strict(),
  behavior: z.enum(["HOLD", "ZOOM_IN", "ZOOM_OUT", "PAN"]),
  reason: z.string().min(1),
}).strict();

export const TransitionInstructionSchema = z.object({
  atMs: z.number().int().nonnegative(),
  preset: z.string().min(1),
  durationMs: z.number().int().positive(),
  purpose: z.string().min(1),
}).strict();

export const GreenScreenInstructionSchema = z.object({
  assetId: UuidSchema,
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().positive(),
  placement: z.object({
    side: z.enum(["LEFT", "RIGHT"]),
    widthPercent: z.number().positive().max(100),
    bottomPercent: z.number().min(0).max(100),
  }).strict(),
  pointingTarget: z.object({
    x: z.number(),
    y: z.number(),
  }).strict().optional(),
  chromaKeyProfile: z.string().min(1),
}).strict();

export const EditingIntelligenceInputSchema = z.object({
  concept: z.unknown(),
  scriptVersion: z.unknown(),
  creativePlanVersion: z.unknown(),
  editingProfile: z.unknown(),
  template: z.unknown(),
  assets: z.array(z.unknown()),
  allowedMotionPresets: z.array(z.string()),
  allowedTransitionPresets: z.array(z.string()),
  allowedChromaKeyProfiles: z.array(z.string()),
  durationConstraints: z.object({
    minMs: z.number().int().nonnegative(),
    maxMs: z.number().int().positive(),
  }).strict(),
  renderConstraints: z.object({
    width: z.literal(1080),
    height: z.literal(1920),
    allowedFps: z.array(z.number().positive()).min(1),
  }).strict(),
}).strict();

export const EditingIntelligenceOutputSchema = z.object({
  timeline: z.array(TimelineBlockSchema),
  captionPlan: z.array(CaptionCueSchema),
  audioPlan: AudioPlanSchema,
  visualFocus: z.array(VisualFocusInstructionSchema),
  transitions: z.array(TransitionInstructionSchema),
  greenScreenPlan: z.array(GreenScreenInstructionSchema),
  renderSettings: z.object({
    width: z.literal(1080),
    height: z.literal(1920),
    fps: z.number().positive(),
  }).strict(),
  editorialRationale: z.object({
    hookStrategy: z.string().min(1),
    pacingStrategy: z.string().min(1),
    attentionStrategy: z.string().min(1),
    endingStrategy: z.string().min(1),
  }).strict(),
}).strict();
