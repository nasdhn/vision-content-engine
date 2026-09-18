import { z } from "zod";
import {
  AssetSummarySchema,
  BrandKnowledgeSnapshotSchema,
  ConceptVersionSnapshotSchema,
  JsonRecordSchema,
  PatternVersionSnapshotSchema,
  PlatformSchema,
  PrimaryFormatSchema,
  ProposedClaimSchema,
  ScriptSegmentSchema,
  UuidSchema,
} from "./shared";

export const RecordingRequestSpecSchema = z.object({
  clientKey: z.string().min(1),
  type: z.enum([
    "VOICE","GREEN_SCREEN_VIDEO","SCREEN_VIDEO","BROLL","OTHER",
  ]),
  title: z.string().min(1),
  instructions: z.string().min(1),
  scriptSegmentRefs: z.array(z.string().min(1)),
  targetDurationSec: z.number().positive().optional(),
  shot: z.object({
    framing: z.string().optional(),
    presenterPosition: z.enum(["LEFT","RIGHT","CENTER"]).optional(),
    gestureDirection: z.enum(["LEFT","RIGHT","NONE"]).optional(),
    eyeLine: z.string().optional(),
    background: z.enum(["GREEN_SCREEN","NATURAL","OTHER"]).optional(),
  }).strict(),
}).strict();

export const CaptureRequestSpecSchema = z.object({
  clientKey: z.string().min(1),
  captureScenarioVersionId: UuidSchema,
  scenarioInput: JsonRecordSchema,
  desiredOutputs: z.array(z.object({
    role: z.enum(["SCREENSHOT","VIDEO","FRAME"]),
    moment: z.string().min(1),
  }).strict()),
  editorialPurpose: z.string().min(1),
}).strict();

const CreativeSceneSchema = z.object({
  clientKey: z.string().min(1),
  objective: z.string().min(1),
  scriptSegmentRefs: z.array(z.string().min(1)),
  visualIntent: z.string().min(1),
  proofRequired: z.boolean(),
}).strict();

export const CreativeDirectorInputSchema = z.object({
  conceptVersion: ConceptVersionSnapshotSchema,
  patternVersion: PatternVersionSnapshotSchema.optional(),
  brandKnowledge: BrandKnowledgeSnapshotSchema,

  templateCandidates: z.array(z.object({
    templateVersionId: UuidSchema,
    templateKey: z.string().min(1),
    capabilities: JsonRecordSchema,
    inputSchemaSummary: JsonRecordSchema,
  }).strict()),

  editingProfileCandidates: z.array(z.object({
    editingProfileVersionId: UuidSchema,
    editingProfileKey: z.string().min(1),
    capabilities: z.array(z.string()),
  }).strict()),

  captureScenarioCandidates: z.array(z.object({
    captureScenarioVersionId: UuidSchema,
    scenarioKey: z.string().min(1),
    inputSchemaSummary: JsonRecordSchema,
    outputCapabilities: z.array(z.string()),
  }).strict()),

  availableAssets: z.array(AssetSummarySchema),

  productionCapabilities: z.object({
    naturalVoiceAvailable: z.boolean(),
    greenScreenPresenterAvailable: z.boolean(),
    playwrightCaptureAvailable: z.boolean(),
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
    segments: z.array(ScriptSegmentSchema).min(1),
    estimatedDurationSec: z.number().positive(),
    voiceMode: z.enum([
      "NATURAL_USER_VOICE","NO_VOICE","OTHER_HUMAN",
    ]),
  }).strict(),

  creativePlan: z.object({
    primaryFormat: PrimaryFormatSchema,
    targetDurationSec: z.number().positive(),
    templateVersionId: UuidSchema,
    editingProfileVersionId: UuidSchema,
    scenes: z.array(CreativeSceneSchema).min(1),
    recordingRequests: z.array(RecordingRequestSpecSchema),
    captureRequests: z.array(CaptureRequestSpecSchema),
    requiredExistingAssetIds: z.array(UuidSchema),
    cta: z.object({
      type: z.string().min(1),
      text: z.string().min(1),
      placement: z.enum(["EARLY","MIDDLE","END"]),
    }).strict(),
    platformConsiderations: z.array(z.object({
      platform: PlatformSchema,
      notes: z.array(z.string()),
    }).strict()),
  }).strict(),

  factualClaims: z.array(ProposedClaimSchema),
}).strict();
