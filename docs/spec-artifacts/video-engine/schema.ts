import { EditingPlanSpecSchema, RenderSettingsSchema } from "../editing-intelligence/schema";
import { z } from "zod";

export const UuidSchema = z.string().uuid();

export const MediaProbeSchema = z.object({
  assetId: UuidSchema,
  container: z.string().optional(),
  durationMs: z.number().int().nonnegative().optional(),
  video: z.object({
    codec: z.string(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    fps: z.number().positive(),
    pixelFormat: z.string().optional(),
    rotationDeg: z.number().optional(),
    color: z.object({
      primaries: z.string().optional(),
      transfer: z.string().optional(),
      matrix: z.string().optional(),
      range: z.string().optional(),
      hdrKind: z.enum([
        "SDR",
        "HDR10",
        "HLG",
        "DOLBY_VISION",
        "UNKNOWN_HDR",
      ]).optional(),
    }).strict().optional(),
  }).strict().optional(),
  audio: z.object({
    codec: z.string(),
    sampleRate: z.number().int().positive(),
    channels: z.number().int().positive(),
    durationMs: z.number().int().nonnegative().optional(),
  }).strict().optional(),
  probeVersion: z.string().min(1),
}).strict();

export const TemplateSlotSchema = z.object({
  key: z.string().min(1),
  accepts: z.enum([
    "VIDEO", "IMAGE", "AUDIO", "TEXT", "PRESENTER", "PRODUCT"
  ]),
  required: z.boolean(),
  maxInstances: z.number().int().positive().optional(),
  constraints: z.object({
    minDurationMs: z.number().int().nonnegative().optional(),
    maxDurationMs: z.number().int().positive().optional(),
    aspectRatio: z.string().optional(),
  }).strict().optional(),
}).strict();

export const TemplateRuntimeContractSchema = z.object({
  templateVersionId: UuidSchema,
  compositionKey: z.string().min(1),
  rendererApiVersion: z.string().min(1),
  supportedCanvas: z.object({
    width: z.literal(1080),
    height: z.literal(1920),
    allowedFps: z.array(z.number().positive()).min(1),
  }).strict(),
  supportedLayers: z.array(z.enum([
    "BACKGROUND","PRODUCT","BROLL","PRESENTER","TEXT","CAPTION","OVERLAY"
  ])).min(1),
  requiredSlots: z.array(TemplateSlotSchema),
  optionalSlots: z.array(TemplateSlotSchema),
  supportedMotionPresetKeys: z.array(z.string()),
  supportedTransitionPresetKeys: z.array(z.string()),
  supportedChromaKeyProfileKeys: z.array(z.string()),
  supportedColorProfileKeys: z.array(z.string()),
  supportedCodecProfileKeys: z.array(z.string()),
  supportedAudioProfileKeys: z.array(z.string()),
  assetDependencies: z.array(UuidSchema),
}).strict();

export const ColorProfileSchema = z.object({
  key: z.string().min(1),
  version: z.string().min(1),
  outputDynamicRange: z.literal("SDR"),
  primaries: z.string().min(1),
  transfer: z.string().min(1),
  matrix: z.string().min(1),
  range: z.string().min(1),
  pixelFormat: z.string().min(1),
  hdrInputPolicy: z.enum(["TONE_MAP_TO_SDR","REJECT_UNSUPPORTED"]),
}).strict();

export const AudioProfileSchema = z.object({
  key: z.string().min(1),
  version: z.string().min(1),
  voiceTargetLufs: z.number(),
  integratedTargetLufs: z.number(),
  truePeakCeilingDb: z.number(),
  musicUnderVoiceDb: z.number(),
  sampleRate: z.number().int().positive(),
  channels: z.number().int().positive(),
}).strict();

export const CodecProfileSchema = z.object({
  key: z.string().min(1),
  version: z.string().min(1),
  container: z.literal("mp4"),
  videoCodec: z.string().min(1),
  audioCodec: z.string().min(1),
  pixelFormat: z.string().min(1),
  videoSettings: z.record(z.string(), z.unknown()),
  audioSettings: z.record(z.string(), z.unknown()),
}).strict();

export const ResolvedRenderAssetSchema = z.object({
  assetId: UuidSchema,
  localUri: z.string().min(1),
  kind: z.enum(["VIDEO","AUDIO","IMAGE","FONT","OTHER"]),
  probe: MediaProbeSchema,
  checksumSha256: z.string().optional(),
}).strict();

export const RenderPayloadSchema = z.object({
  renderAttemptId: UuidSchema,
  template: TemplateRuntimeContractSchema,
  editingPlan: EditingPlanSpecSchema,
  resolvedAssets: z.array(ResolvedRenderAssetSchema),
  renderSettings: RenderSettingsSchema,
  provenance: z.object({
    editingPlanVersionId: UuidSchema,
    templateVersionId: UuidSchema,
    editingProfileVersionId: UuidSchema,
    rendererVersion: z.string().min(1),
    colorProfileKey: z.string().min(1),
    codecProfileKey: z.string().min(1),
    audioProfileKey: z.string().min(1),
  }).strict(),
}).strict();

export const TechnicalQaReportSchema = z.object({
  result: z.enum(["PASS","FAIL"]),
  probe: MediaProbeSchema,
  checks: z.array(z.object({
    key: z.string().min(1),
    status: z.enum(["PASS","FAIL","WARNING","NOT_APPLICABLE"]),
    message: z.string().optional(),
    data: z.unknown().optional(),
  }).strict()),
  rendererVersion: z.string().min(1),
  colorProfileKey: z.string().min(1),
  codecProfileKey: z.string().min(1),
  audioProfileKey: z.string().min(1),
}).strict();
