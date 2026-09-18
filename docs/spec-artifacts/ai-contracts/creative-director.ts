import { z } from "zod";
import {
  BrandKnowledgeSnapshotSchema,
  PlatformSchema,
  PrimaryFormatSchema,
  ProposedClaimSchema,
  UuidSchema,
} from "./shared";

export const RecordingRequestSpecSchema = z.object({
  clientKey: z.string().min(1),
  type: z.enum([
    "VOICE",
    "GREEN_SCREEN_VIDEO",
    "SCREEN_VIDEO",
    "BROLL",
    "OTHER",
  ]),
  title: z.string().min(1),
  instructions: z.string().min(1),
  scriptSegmentRefs: z.array(z.string().min(1)),
  targetDurationSec: z.number().positive().optional(),
  shot: z.object({
    framing: z.string().optional(),
    presenterPosition: z.enum(["LEFT", "RIGHT", "CENTER"]).optional(),
    gestureDirection: z.enum(["LEFT", "RIGHT", "NONE"]).optional(),
    eyeLine: z.string().optional(),
    background: z.enum(["GREEN_SCREEN", "NATURAL", "OTHER"]).optional(),
  }).strict(),
}).strict();

export const CaptureRequestSpecSchema = z.object({
  clientKey: z.string().min(1),
  captureScenarioVersionId: UuidSchema,
  scenarioInput: z.record(z.string(), z.unknown()),
  desiredOutputs: z.array(z.object({
    role: z.enum(["SCREENSHOT", "VIDEO", "FRAME"]),
    moment: z.string().min(1),
  }).strict()),
  editorialPurpose: z.string().min(1),
}).strict();

export const CreativeDirectorInputSchema = z.object({
  conceptVersion: z.unknown(),
  patternVersion: z.unknown(),
  brandKnowledge: BrandKnowledgeSnapshotSchema,

  templateCandidates: z.array(z.object({
    templateVersionId: UuidSchema,
    templateKey: z.string().min(1),
    capabilities: z.unknown(),
    inputSchemaSummary: z.unknown(),
  }).strict()),

  editingProfileCandidates: z.array(z.object({
    editingProfileVersionId: UuidSchema,
    editingProfileKey: z.string().min(1),
    capabilities: z.array(z.string()),
  }).strict()),

  captureScenarioCandidates: z.array(z.object({
    captureScenarioVersionId: UuidSchema,
    scenarioKey: z.string().min(1),
    inputSchemaSummary: z.unknown(),
    outputCapabilities: z.array(z.string()),
  }).strict()),

  availableAssets: z.array(z.unknown()),

  productionCapabilities: z.object({
    naturalVoiceAvailable: z.literal(true),
    greenScreenPresenterAvailable: z.literal(true),
    playwrightCaptureAvailable: z.literal(true),
  }).strict(),

  constraints: z.object({
    targetAspectRatio: z.literal("9:16"),
    targetPlatforms: z.array(PlatformSchema).min(1),
    minDurationSec: z.number().nonnegative(),
    maxDurationSec: z.number().positive(),
  }).strict(),
}).strict();

export const CreativeDirectorOutputSchema = z.object({
  script: z.object({
    language: z.literal("fr"),
    fullText: z.string().min(1),
    segments: z.array(z.unknown()),
    estimatedDurationSec: z.number().positive(),
    voiceMode: z.enum([
      "NATURAL_USER_VOICE",
      "NO_VOICE",
      "OTHER_HUMAN",
    ]),
  }).strict(),

  creativePlan: z.object({
    primaryFormat: PrimaryFormatSchema,
    targetDurationSec: z.number().positive(),
    templateVersionId: UuidSchema,
    editingProfileVersionId: UuidSchema,
    scenes: z.array(z.unknown()),
    recordingRequests: z.array(RecordingRequestSpecSchema),
    captureRequests: z.array(CaptureRequestSpecSchema),
    requiredExistingAssetIds: z.array(UuidSchema),
    cta: z.object({
      type: z.string().min(1),
      text: z.string().min(1),
      placement: z.enum(["EARLY", "MIDDLE", "END"]),
    }).strict(),
    platformConsiderations: z.array(z.unknown()),
  }).strict(),

  factualClaims: z.array(ProposedClaimSchema),
}).strict();
