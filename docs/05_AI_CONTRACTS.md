# 05 — AI Contracts

**Status:** ACCEPTED  
**Specification version:** spec-v0.6  
**Scope:** Vision Content Engine V1  
**Depends on:** Architecture, Domain Model, Workflows and Prisma Specification ACCEPTED
**Accepted:** 2026-09-18

---

# 1. Purpose

This document defines exactly what AI is allowed to receive and produce.

AI is used for:
- ambiguity;
- creative generation;
- editorial planning;
- constrained creative analysis;
- evidence-based interpretation.

AI is **not** the source of truth for:
- workflow state;
- publication;
- assets;
- schedules;
- credentials;
- retry policy;
- rendering;
- platform side effects.

Every production AI call uses:

1. a versioned capability;
2. a versioned prompt;
3. a versioned input schema;
4. a versioned output schema;
5. a versioned Knowledge Snapshot;
6. schema validation;
7. reference-integrity validation;
8. business-rule validation;
9. claim validation;
10. recorded ModelInvocation;
11. bounded retries.

No downstream component consumes unvalidated provider output.

---

# 2. V1 AI capability map

V1 defines five logical capabilities:

```text
Creator
CreativeDirector
EditingIntelligence
CreativeQA
Analyst
```

These are contracts, not autonomous agents.

One provider/model may implement several capabilities.

A separate autonomous Researcher is deferred.

---

# 3. AI processing boundary

Canonical flow:

```text
Canonical DB state
      ↓
Context Builder
      ↓
Versioned AI Request
      ↓
AIProviderGateway
      ↓
Provider
      ↓
Raw response
      ↓
Schema validation
      ↓
Reference validation
      ↓
Business validation
      ↓
Claim validation
      ↓
Validated AI output
      ↓
Application service
      ↓
Canonical DB state
```

The model never writes directly to the database.

---

# 4. Shared request envelope

```ts
type AiRequestEnvelope<TInput> = {
  requestId: string;              // UUID
  capability:
    | "CREATOR"
    | "CREATIVE_DIRECTOR"
    | "EDITING_INTELLIGENCE"
    | "CREATIVE_QA"
    | "ANALYST";

  purpose: string;

  prompt: {
    key: string;
    version: string;
    contentHash: string;
  };

  contracts: {
    inputSchemaVersion: string;
    outputSchemaVersion: string;
  };

  knowledgeSnapshot: {
    version: string;
    contentHash: string;
  };

  locale: "fr-FR";

  input: TInput;
};
```

Provider/model configuration is injected by the gateway and is not part of business input.

---

# 5. Shared validated response envelope

```ts
type AiValidatedResponse<TOutput> = {
  modelInvocationId: string;
  output: TOutput;

  validation: {
    schema: "PASS";
    references: "PASS";
    businessRules: "PASS";
    claims: "PASS" | "NOT_APPLICABLE";
  };

  warnings: AiContractWarning[];
};
```

Provider raw output never becomes canonical state directly.

---

# 6. Validation pipeline

Every AI output is validated in this order:

```text
1. parse
2. strict schema validation
3. reference integrity
4. business constraints
5. claims policy
6. deterministic duplication/consistency checks
```

If any mandatory stage fails:

```text
business workflow does not advance
```

Unknown output fields are rejected in production schemas unless explicitly allowed.

---

# 7. Brand & Product Knowledge Snapshot

AI must not reconstruct Vision facts from memory.

```ts
type BrandKnowledgeSnapshot = {
  version: string;
  contentHash: string;
  effectiveAt: string;

  brand: {
    name: "Vision";
    domain: string;
    primaryLanguage: "fr";
    market: "FRANCE";

    tone: string[];
    forbiddenTone: string[];
  };

  product: {
    category: string;
    description: string;

    features: ProductFeature[];
    useCases: UseCase[];
    targetCustomers: TargetCustomer[];
    valuePropositions: ValueProposition[];
  };

  commercial: {
    pricingClaims: VerifiedClaim[];
    ctas: CTAOption[];
  };

  claims: {
    verified: VerifiedClaim[];
    forbidden: ForbiddenClaim[];
  };

  visualIdentity: {
    allowedAssetIds: string[];
    notes: string[];
  };
};
```

The exact snapshot version/hash used by a ModelInvocation must remain recoverable.

---

# 8. Knowledge persistence decision

V1 may implement Knowledge Snapshots as:

- versioned repository artifacts; or
- immutable DB-backed versions.

Whichever implementation is chosen, it must provide:

```text
stable version
content hash
immutable historical retrieval
```

A mutable settings row without historical snapshots is not acceptable.

This storage choice is finalized during implementation planning, but the versioned contract is mandatory.

---

# 9. Verified claims

```ts
type VerifiedClaim = {
  id: string;
  text: string;

  type:
    | "PRODUCT_FACT"
    | "PRICING_FACT"
    | "BUSINESS_FACT"
    | "EXTERNAL_STAT";

  sourceIds: string[];
  validFrom?: string;
  validUntil?: string;
};
```

```ts
type ForbiddenClaim = {
  id: string;
  patternOrMeaning: string;
  reason: string;
};
```

Unsourced numerical/external claims are not allowed in autonomous generation.

---

# 10. Proposed claim output

Capabilities that generate copy containing factual assertions return:

```ts
type ProposedClaim = {
  text: string;

  type:
    | "PRODUCT_FACT"
    | "PRICING_FACT"
    | "EXTERNAL_STAT"
    | "OPINION"
    | "EXPERIENCE";

  verifiedClaimIds: string[];

  disposition:
    | "VERIFIED"
    | "HUMAN_REVIEW_REQUIRED";
};
```

A `PRODUCT_FACT`, `PRICING_FACT` or `EXTERNAL_STAT` without valid evidence cannot be `VERIFIED`.

---

# 11. Content Memory input

The model does not own persistent memory.

Content memory is reconstructed from canonical data.

```ts
type ContentMemoryItem = {
  conceptVersionId: string;
  publicationIds: string[];

  topic: string;
  angle: string;
  hookType?: string;

  patternVersionId?: string;
  templateVersionId?: string;
  editingProfileVersionId?: string;

  ctaType?: string;
  durationMs?: number;

  platforms: ("TIKTOK" | "INSTAGRAM" | "YOUTUBE")[];

  performance?: {
    measurementWindow: string;

    metrics: {
      views?: number | null;
      avgWatchDurationMs?: number | null;
      avgWatchPercentage?: number | null;
      completionRate?: number | null;
      shares?: number | null;
      saves?: number | null;
      profileVisits?: number | null;
      websiteClicks?: number | null;
    };

    comparabilityNotes: string[];
  };
};
```

Performance is contextualized by a measurement window.

---

# 12. Creator responsibility

Creator transforms strategy inputs into **candidate concepts**.

Creator cannot:
- approve concepts;
- invent PatternVersion IDs;
- invent Vision facts;
- publish;
- produce executable browser instructions.

---

# 13. Creator input

```ts
type CreatorInput = {
  briefVersion: {
    id: string;
    payload: unknown;
  };

  ideas: {
    id: string;
    title: string;
    description?: string;
  }[];

  patternCandidates: {
    patternVersionId: string;
    name: string;
    description: string;
    whenToUse: string;
    hookStructure: unknown;
    storyStructure: unknown;
    visualStructure: unknown;
    ctaStyle: unknown;
  }[];

  brandKnowledge: BrandKnowledgeSnapshot;

  contentMemory: ContentMemoryItem[];

  generationConstraints: {
    requestedConceptCount: number;

    targetPlatforms:
      | ["TIKTOK"]
      | ["INSTAGRAM"]
      | ["YOUTUBE"]
      | ("TIKTOK" | "INSTAGRAM" | "YOUTUBE")[];

    allowedPrimaryFormats: PrimaryFormat[];

    diversity: {
      maxSamePatternCount?: number;
      maxSameAngleCount?: number;
      avoidRecentSemanticSimilarityAbove?: number;
    };

    explorationPolicy: {
      mode: "EXPLORE" | "BALANCED" | "EXPLOIT";
      notes?: string;
    };
  };
};
```

---

# 14. Creator output

```ts
type CreatorOutput = {
  concepts: CreatorConcept[];
};

type CreatorConcept = {
  clientKey: string;
  ideaId?: string;

  title: string;
  angle: string;
  hook: string;
  audience: string;
  objective: string;
  hypothesis: string;

  selectedPatternVersionId: string;

  rationale: {
    whyThisPattern: string;
    whyThisAngle: string;
    whyThisCouldFitVision: string;
    differentiationFromRecentContent: string;
  };

  formatRecommendation: {
    primaryFormat: PrimaryFormat;
    targetDurationSec: number;
  };

  factualClaims: ProposedClaim[];
};
```

---

# 15. Creator hard validation

Reject if:

- concept count exceeds request;
- selected PatternVersion is not in candidates;
- Idea ID is unknown;
- required fields are empty;
- duration violates configured bounds;
- primary format is not allowed;
- claim policy fails;
- exact duplicate hook/script seed is detected.

Semantic similarity is evaluated deterministically after generation.

---

# 16. PrimaryFormat

```ts
type PrimaryFormat =
  | "PRODUCT_DEMO"
  | "MANUAL_TO_VISION"
  | "PROBLEM_SOLUTION"
  | "GREEN_SCREEN_EXPLAINER"
  | "FOUNDER_STORY";
```

---

# 17. Creative Director responsibility

Creative Director converts one **approved ConceptVersion** into production requirements.

It produces:
- Script content;
- Creative Plan;
- Recording requests;
- Capture requests;
- exact TemplateVersion selection;
- exact EditingProfileVersion selection;
- CTA plan.

It cannot claim that an asset already exists unless supplied.

---

# 18. Creative Director input

```ts
type CreativeDirectorInput = {
  conceptVersion: ApprovedConceptSnapshot;
  patternVersion: PatternVersionSnapshot;
  brandKnowledge: BrandKnowledgeSnapshot;

  templateCandidates: {
    templateVersionId: string;
    templateKey: string;
    capabilities: unknown;
    inputSchemaSummary: unknown;
  }[];

  editingProfileCandidates: {
    editingProfileVersionId: string;
    editingProfileKey: string;
    capabilities: string[];
  }[];

  captureScenarioCandidates: {
    captureScenarioVersionId: string;
    scenarioKey: string;
    inputSchemaSummary: unknown;
    outputCapabilities: string[];
  }[];

  availableAssets: AssetSummary[];

  productionCapabilities: {
    naturalVoiceAvailable: true;
    greenScreenPresenterAvailable: true;
    playwrightCaptureAvailable: true;
  };

  constraints: {
    targetAspectRatio: "9:16";
    targetPlatforms: ("TIKTOK" | "INSTAGRAM" | "YOUTUBE")[];
    minDurationSec: number;
    maxDurationSec: number;
  };
};
```

---

# 19. Creative Director output

```ts
type CreativeDirectorOutput = {
  script: {
    language: "fr";
    fullText: string;
    segments: ScriptSegment[];
    estimatedDurationSec: number;

    voiceMode:
      | "NATURAL_USER_VOICE"
      | "NO_VOICE"
      | "OTHER_HUMAN";
  };

  creativePlan: {
    primaryFormat: PrimaryFormat;
    targetDurationSec: number;

    templateVersionId: string;
    editingProfileVersionId: string;

    scenes: CreativeScene[];

    recordingRequests: RecordingRequestSpec[];
    captureRequests: CaptureRequestSpec[];

    requiredExistingAssetIds: string[];

    cta: {
      type: string;
      text: string;
      placement: "EARLY" | "MIDDLE" | "END";
    };

    platformConsiderations: PlatformConsideration[];
  };

  factualClaims: ProposedClaim[];
};
```

Exact version IDs are mandatory.

---

# 20. RecordingRequestSpec

```ts
type RecordingRequestSpec = {
  clientKey: string;

  type:
    | "VOICE"
    | "GREEN_SCREEN_VIDEO"
    | "SCREEN_VIDEO"
    | "BROLL"
    | "OTHER";

  title: string;
  instructions: string;

  scriptSegmentRefs: string[];

  targetDurationSec?: number;

  shot: {
    framing?: string;

    presenterPosition?:
      | "LEFT"
      | "RIGHT"
      | "CENTER";

    gestureDirection?:
      | "LEFT"
      | "RIGHT"
      | "NONE";

    eyeLine?: string;

    background?:
      | "GREEN_SCREEN"
      | "NATURAL"
      | "OTHER";
  };
};
```

Instructions must be directly executable by the human operator.

Avoid vague instructions such as:

```text
"Make it engaging"
"Make it dynamic"
```

without concrete direction.

---

# 21. CaptureRequestSpec

AI describes the editorial capture requirement, but does not create browser automation.

```ts
type CaptureRequestSpec = {
  clientKey: string;

  captureScenarioVersionId: string;

  scenarioInput: Record<string, unknown>;

  desiredOutputs: {
    role: "SCREENSHOT" | "VIDEO" | "FRAME";
    moment: string;
  }[];

  editorialPurpose: string;
};
```

Hard rule:

`captureScenarioVersionId` must be one of the supplied candidates.

The deterministic Playwright scenario owns executable steps.

---

# 22. Editing Intelligence responsibility

Editing Intelligence behaves like a planning editor.

It decides:
- pacing;
- visual focus;
- cut structure;
- caption timing plan;
- audio intent;
- green-screen placement;
- transition intent.

It does not:
- render;
- fabricate missing assets;
- execute FFmpeg;
- modify source recordings.

---

# 23. Editing Intelligence input

```ts
type EditingIntelligenceInput = {
  concept: ApprovedConceptSnapshot;

  scriptVersion: ScriptVersionSnapshot;
  creativePlanVersion: CreativePlanVersionSnapshot;

  editingProfile: EditingProfileVersionSnapshot;
  template: TemplateVersionSnapshot;

  assets: EditingAssetSummary[];

  allowedMotionPresets: string[];
  allowedTransitionPresets: string[];
  allowedChromaKeyProfiles: string[];

  durationConstraints: {
    minMs: number;
    maxMs: number;
  };

  renderConstraints: {
    width: 1080;
    height: 1920;
    allowedFps: number[];
  };
};
```

---

# 24. Editing Intelligence output

```ts
type EditingIntelligenceOutput = {
  timeline: TimelineBlock[];

  captionPlan: CaptionCue[];

  audioPlan: AudioPlan;

  visualFocus: VisualFocusInstruction[];

  transitions: TransitionInstruction[];

  greenScreenPlan: GreenScreenInstruction[];

  renderSettings: {
    width: 1080;
    height: 1920;
    fps: number;
  };

  editorialRationale: {
    hookStrategy: string;
    pacingStrategy: string;
    attentionStrategy: string;
    endingStrategy: string;
  };
};
```

---

# 25. TimelineBlock

```ts
type TimelineBlock = {
  id: string;

  startMs: number;
  endMs: number;

  source:
    | {
        type: "ASSET";
        assetId: string;
      }
    | {
        type: "GENERATED_TEXT";
      }
    | {
        type: "GENERATED_SHAPE";
      };

  role:
    | "HOOK"
    | "PRODUCT"
    | "PRESENTER"
    | "BROLL"
    | "TEXT"
    | "CTA"
    | "BACKGROUND";

  crop?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };

  transform?: {
    scale?: number;
    x?: number;
    y?: number;
    rotationDeg?: number;
  };

  motionPreset?: string;

  purpose: string;
};
```

Hard validation:

- `startMs >= 0`
- `endMs > startMs`
- within total duration
- asset IDs exist in supplied inputs
- motion preset is whitelisted
- crop values satisfy renderer coordinate rules

---

# 26. Caption contract

```ts
type CaptionCue = {
  id: string;

  startMs: number;
  endMs: number;

  text: string;

  segmentRef?: string;

  emphasisRanges: {
    start: number;
    end: number;
    kind: "KEYWORD";
  }[];
};
```

Rules:

- semantic chunks by default;
- exact timing bounds;
- emphasis is sparse;
- captions must correspond to script/audio unless explicitly marked as non-speech on-screen copy.

---

# 27. Audio plan contract

```ts
type AudioPlan = {
  voice?: {
    assetId: string;
    gainDb: number;
  };

  music?: {
    assetId: string;
    gainDb: number;
    startMs: number;
    endMs?: number;
  };

  sfx: {
    assetId: string;
    atMs: number;
    gainDb: number;
    purpose: string;
  }[];

  ducking?: {
    musicUnderVoiceDb: number;
  };
};
```

Every referenced audio asset must exist in the supplied asset list.

---

# 28. Visual focus contract

```ts
type VisualFocusInstruction = {
  startMs: number;
  endMs: number;

  targetAssetId: string;

  targetRegion: {
    x: number;
    y: number;
    width: number;
    height: number;
  };

  behavior:
    | "HOLD"
    | "ZOOM_IN"
    | "ZOOM_OUT"
    | "PAN";

  reason: string;
};
```

This is central for product-demo captures.

---

# 29. Transition contract

```ts
type TransitionInstruction = {
  atMs: number;

  preset: string;

  durationMs: number;

  purpose: string;
};
```

Preset must be whitelisted.

The LLM cannot invent arbitrary renderer code.

---

# 30. Green-screen presenter contract

```ts
type GreenScreenInstruction = {
  assetId: string;

  startMs: number;
  endMs: number;

  placement: {
    side: "LEFT" | "RIGHT";
    widthPercent: number;
    bottomPercent: number;
  };

  pointingTarget?: {
    x: number;
    y: number;
  };

  chromaKeyProfile: string;
};
```

`chromaKeyProfile` must be selected from supplied allowed profiles.

---

# 31. Creative QA responsibility

Creative QA reviews evidence about an actual render.

It cannot:
- publish;
- human-approve in V1;
- claim to have visually inspected content it was not given.

---

# 32. RenderInspectionBundle

Creative QA only evaluates dimensions supported by provided evidence.

```ts
type RenderInspectionBundle = {
  durationMs: number;

  sampledFrames: {
    atMs: number;
    assetId: string;
  }[];

  transcript?: {
    startMs: number;
    endMs: number;
    text: string;
  }[];

  cutEvents?: {
    atMs: number;
    type: string;
  }[];

  silenceWindows?: {
    startMs: number;
    endMs: number;
  }[];

  captionObservations?: {
    startMs: number;
    endMs: number;
    text: string;
  }[];

  productVisibilitySignals?: unknown;

  audioSignals?: unknown;
};
```

If visual evidence is absent, visual issues must be reported as `NOT_EVALUATED`, not guessed.

---

# 33. Creative QA output

```ts
type CreativeQAOutput = {
  result:
    | "PASS"
    | "PASS_WITH_WARNINGS"
    | "FAIL";

  evaluatedDimensions: string[];
  notEvaluatedDimensions: string[];

  issues: {
    code:
      | "PACING_TOO_SLOW"
      | "PACING_TOO_FAST"
      | "CUTS_TOO_MECHANICAL"
      | "CAPTIONS_TOO_BUSY"
      | "PRODUCT_NOT_VISIBLE_ENOUGH"
      | "HOOK_VISUALLY_WEAK"
      | "SOUND_TOO_BUSY"
      | "CTA_TOO_LONG"
      | "GREEN_SCREEN_BAD_PLACEMENT"
      | "SCRIPT_VISUAL_MISMATCH"
      | "OTHER";

    severity:
      | "WARNING"
      | "ERROR";

    startMs?: number;
    endMs?: number;

    explanation: string;
    suggestedFix?: string;
  }[];

  summary: string;
};
```

---

# 34. Creative QA deterministic boundary

Technical facts are not delegated to LLM judgment when deterministic checks exist.

Examples:

Deterministic:
- resolution;
- duration;
- fps;
- missing audio stream;
- invalid codec;
- black-frame threshold;
- invalid timeline references.

AI-assisted:
- pacing feel;
- clarity;
- visual focus;
- hook strength;
- excessive caption density;
- script/visual coherence.

---

# 35. Analyst responsibility

Analyst interprets evidence.

It cannot:
- rewrite raw metrics;
- convert missing data to zero;
- infer causal certainty without evidence;
- automatically change product strategy.

---

# 36. Analyst publication input

```ts
type AnalystPublication = {
  publicationId: string;

  platform: "TIKTOK" | "INSTAGRAM" | "YOUTUBE";

  publishedAt: string;

  measurementWindow: string;

  contentDimensions: {
    patternVersionId?: string;
    hookType?: string;
    templateVersionId?: string;
    editingProfileVersionId?: string;
    ctaType?: string;
    durationMs?: number;
    primaryFormat?: PrimaryFormat;
  };

  normalizedMetrics: {
    views?: number | null;
    likes?: number | null;
    comments?: number | null;
    shares?: number | null;
    saves?: number | null;
    watchTimeMs?: number | null;
    avgWatchDurationMs?: number | null;
    avgWatchPercentage?: number | null;
    completionRate?: number | null;
    profileVisits?: number | null;
    websiteClicks?: number | null;
  };

  comparability: {
    comparableMetricKeys: string[];
    limitations: string[];
  };
};
```

---

# 37. Analyst input

```ts
type AnalystInput = {
  analysisWindow: {
    from: string;
    to: string;
  };

  publications: AnalystPublication[];

  experiments: ExperimentSnapshot[];

  priorInsights: InsightSnapshot[];

  attributionSignals: {
    websiteVisits?: number | null;
    signups?: number | null;
    activations?: number | null;
    customers?: number | null;
    directPublicationLinks?: number | null;
    inferredSignals?: number | null;
  };

  minimumEvidencePolicy: {
    minimumComparableSamples: number;
    confidenceRulesVersion: string;
  };
};
```

---

# 38. Analyst output

```ts
type AnalystOutput = {
  insights: {
    statement: string;

    confidence:
      | "INSUFFICIENT_DATA"
      | "WEAK_SIGNAL"
      | "INTERESTING_SIGNAL"
      | "FAIRLY_SOLID";

    evidencePublicationIds: string[];

    limitations: string[];

    dimensions: {
      patternVersionIds?: string[];
      hookTypes?: string[];
      editingProfileVersionIds?: string[];
      platforms?: string[];
    };
  }[];

  recommendations: {
    title: string;
    description: string;

    nextTest: {
      hypothesis: string;
      change: string;
      keepConstant: string[];
      primaryMetric: string;
    };
  }[];
};
```

---

# 39. Analyst hard rules

Analyst must:

- distinguish observation from hypothesis;
- qualify confidence;
- mention sample limitations;
- respect platform metric comparability;
- compare similar measurement windows;
- treat NULL as unavailable;
- avoid unsupported causal language;
- recommend experiments rather than declare universal winners.

Forbidden unsupported claims include:

```text
"This format always works."
"TikTok prefers this template."
"This editing style caused the sales increase."
```

unless the evidence contract specifically supports such a conclusion.

---

# 40. AIProviderGateway

All providers sit behind one application interface.

```ts
interface AIProviderGateway {
  generateStructured<TInput, TOutput>(
    request: AiRequestEnvelope<TInput>,
    outputSchema: StrictSchema<TOutput>,
    policy: ModelPolicy
  ): Promise<AiValidatedResponse<TOutput>>;
}
```

Provider SDK responses do not leak into domain/application code.

---

# 41. ModelPolicy

```ts
type ModelPolicy = {
  capability:
    | "CREATOR"
    | "CREATIVE_DIRECTOR"
    | "EDITING_INTELLIGENCE"
    | "CREATIVE_QA"
    | "ANALYST";

  preferredProvider?: string;
  preferredModel?: string;

  reasoningLevel?: string;

  maxAttempts: number;
  timeoutMs: number;

  fallbackPolicy:
    | "NONE"
    | "SAME_CONTRACT_ALLOWED";

  maxInputTokens?: number;
  maxOutputTokens?: number;
  maxEstimatedCost?: number;
};
```

Fallback may change provider/model but never contract semantics.

---

# 42. AI retry policy

Eligible automatic retry:

- transient network error;
- provider 5xx;
- rate limit;
- schema-invalid response under bounded repair policy.

Not eligible for blind retry:

- poor subjective creative result;
- forbidden claim;
- missing source asset;
- invalid external reference;
- business-policy violation.

---

# 43. Schema repair retry

For a repair attempt:

```text
same task
same context
same contract
validation errors supplied
request only structural correction
```

The repair prompt must not invite unrelated creative expansion.

If repair fails after configured attempts:
- workflow fails or awaits attention.

---

# 44. Prompt Registry

Prompts are immutable versioned artifacts.

```ts
type PromptArtifact = {
  key: string;
  version: string;
  capability: string;
  schemaVersion: string;
  contentHash: string;
  status: "DRAFT" | "ACTIVE" | "DEPRECATED";
  content: string;
};
```

Production usage records exact:

```text
prompt key
prompt version
content hash
```

No in-place mutation of an already-used prompt.

---

# 45. Prompt storage

V1 may store prompt artifacts:

- in repository files; or
- in DB.

Requirements are the same:

- immutable version;
- exact retrieval;
- hash;
- clear active/deprecated status.

The implementation plan selects the simpler compliant option.

---

# 46. Deterministic reference validation

Before accepting AI output, validate every referenced ID against allowed request context.

Examples:

```text
PatternVersion
TemplateVersion
EditingProfileVersion
CaptureScenarioVersion
Asset
VerifiedClaim
```

If the model emits an ID not provided in the request:
- reject output.

This prevents hallucinated identifiers.

---

# 47. Deduplication boundary

AI receives relevant memory but is not authoritative for duplicate detection.

Deterministic checks include:

- normalized hook exact match;
- script hash;
- recently used pattern/angle rules;
- semantic similarity;
- deliberate-variant exemption.

A deliberate variant must record what is intentionally being held constant and changed.

---

# 48. AI cost controls

Every capability defines:

```text
max input tokens
max output tokens
max attempts
timeout
provider/model policy
estimated cost ceiling
```

A request may be rejected before provider execution when budget policy fails.

ModelInvocation records real cost when provider usage data allows it.

---

# 49. Raw request/response retention

Exact raw AI bodies can contain internal data.

V1 must explicitly configure:

```text
retention mode
redaction rules
retention duration
provider policy
```

At minimum retain:

```text
input hash
output hash
prompt version/hash
knowledge version/hash
model/provider
tokens/cost
latency
validation outcome
related entity IDs
```

---

# 50. Capability autonomy boundaries

### Creator
Proposes concepts.
Cannot approve them.

### Creative Director
Plans production.
Cannot fabricate assets.

### Editing Intelligence
Plans edits.
Cannot render.

### Creative QA
Evaluates only supplied evidence.
Cannot human-approve V1 final render.

### Analyst
Produces observations/hypotheses/recommendations.
Cannot rewrite metrics or autonomously alter strategy.

---

# 51. Concrete Zod artifacts

After this specification is accepted, create documentation artifacts for strict Zod schemas corresponding to:

```text
BrandKnowledgeSnapshot
CreatorInput
CreatorOutput
CreativeDirectorInput
CreativeDirectorOutput
EditingIntelligenceInput
EditingIntelligenceOutput
CreativeQAInput
CreativeQAOutput
AnalystInput
AnalystOutput
```

These remain spec artifacts until implementation is authorized.

---

# 52. Acceptance checklist

The AI contract specification can move to ACCEPTED when:

- [x] AI processing boundary accepted.
- [x] shared request/response envelope accepted.
- [x] validation pipeline accepted.
- [x] Knowledge Snapshot contract accepted.
- [x] claim contract accepted.
- [x] Content Memory contract accepted.
- [x] Creator contract accepted.
- [x] Creator diversity/exploration controls accepted.
- [x] Creative Director contract accepted.
- [x] exact TemplateVersion/EditingProfileVersion selection accepted.
- [x] RecordingRequestSpec accepted.
- [x] CaptureScenarioVersion-based CaptureRequest accepted.
- [x] Editing Intelligence contract accepted.
- [x] timeline/caption/audio/focus/transition/green-screen contracts accepted.
- [x] Creative QA evidence-bound evaluation accepted.
- [x] deterministic vs AI QA boundary accepted.
- [x] Analyst contract accepted.
- [x] measurement-window/comparability requirements accepted.
- [x] AIProviderGateway accepted.
- [x] retry/schema repair policy accepted.
- [x] Prompt Registry accepted.
- [x] reference-integrity validation accepted.
- [x] deterministic dedup boundary accepted.
- [x] cost controls accepted.
- [x] autonomy boundaries accepted.

After acceptance:

1. freeze `05_AI_CONTRACTS.md`;
2. update Decisions/Status/Checklist;
3. create strict Zod contract spec artifacts;
4. proceed to Pattern Library and Editing Intelligence specifications.
