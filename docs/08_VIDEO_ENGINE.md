# 08 — Video Engine

**Status:** ACCEPTED  
**Specification version:** spec-v0.9  
**Scope:** Vision Content Engine V1  
**Depends on:** Editing Intelligence ACCEPTED
**Accepted:** 2026-09-18

---

# 1. Purpose

The Video Engine converts a validated immutable EditingPlanVersion plus exact media inputs into a deterministic clean master video.

It is responsible for:

- media ingest validation;
- input normalization;
- template resolution;
- Remotion composition;
- deterministic motion/layout execution;
- green-screen execution;
- audio assembly;
- captions/on-screen text;
- encoding;
- output inspection;
- technical QA;
- render diagnostics;
- immutable output Assets.

It is **not** responsible for:

- concept generation;
- script writing;
- deciding editorial strategy;
- changing EditingPlan meaning;
- publishing;
- platform analytics.

---

# 2. Core invariant

Given the same:

```text
EditingPlanVersion
TemplateVersion
EditingProfileVersion
exact RenderInputAssets
renderer version
font/template assets
render settings
```

the Video Engine should produce functionally reproducible output.

Byte-for-byte identical output is desirable where practical but is not the primary invariant across different underlying system/library builds.

Functional reproducibility and pinned provenance are mandatory.

---

# 3. Runtime architecture

Logical flow:

```text
Render REQUESTED
↓
transactional outbox
↓
render job
↓
RenderAttempt RUNNING
↓
resolve immutable inputs
↓
materialize assets
↓
probe + normalize inputs
↓
validate Template contract
↓
compile render payload
↓
Remotion render
↓
FFmpeg post-processing if required
↓
ffprobe output inspection
↓
technical QA
↓
upload immutable output Asset
↓
RenderAttempt SUCCEEDED
↓
Render TECHNICAL_QA / CREATIVE_QA
```

---

# 4. Remotion role

Remotion is the primary deterministic visual composition layer.

It receives validated structured data rather than natural-language instructions.

Conceptually:

```text
EditingPlanSpec
+ TemplateRuntimeContract
+ resolved local/signed asset URLs
↓
Remotion Composition
↓
encoded render
```

No LLM call occurs inside frame rendering.

---

# 5. FFmpeg / ffprobe role

FFmpeg is used where deterministic media processing is better handled outside React composition, including possible:

- input normalization;
- audio normalization/mixing assistance;
- transcode;
- chroma-key preprocessing where chosen by implementation;
- muxing;
- post-render normalization.

ffprobe is used for machine-readable inspection of source/output streams and media metadata.

The exact division between Remotion and FFmpeg is implementation detail as long as the contract remains deterministic.

---

# 6. Render isolation

Each RenderAttempt uses an isolated working directory:

```text
/render-work/{renderAttemptId}/
```

It contains only temporary materialized inputs/intermediates/output.

Rules:

- unique per attempt;
- never reused as canonical storage;
- removed after successful upload/retention window;
- no secrets baked into output;
- no cross-render mutable shared state.

---

# 7. Source asset materialization

Object storage remains canonical for binary media.

Worker:

```text
Asset metadata
↓
authorized object fetch
↓
local temp materialization
↓
checksum validation where available
↓
ffprobe
```

A missing or checksum-invalid required input fails before expensive rendering.

### Runtime network rule

The renderer must not consume arbitrary model/user-supplied internet URLs directly.

Before rendering, every media dependency must resolve to:

- a known Asset from object storage;
- a versioned template dependency;
- or an explicitly controlled internal resource.

The render runtime should not need open internet access for ordinary composition.

This improves:

- reproducibility;
- SSRF resistance;
- failure isolation;
- asset lineage.

---

# 8. Media probe contract

Each renderable source produces a normalized probe record.

```ts
type MediaProbe = {
  assetId: string;

  container?: string;

  durationMs?: number;

  video?: {
    codec: string;
    width: number;
    height: number;
    fps: number;
    pixelFormat?: string;
    rotationDeg?: number;

    color?: {
      primaries?: string;
      transfer?: string;
      matrix?: string;
      range?: string;

      hdrKind?:
        | "SDR"
        | "HDR10"
        | "HLG"
        | "DOLBY_VISION"
        | "UNKNOWN_HDR";
    };
  };

  audio?: {
    codec: string;
    sampleRate: number;
    channels: number;
    durationMs?: number;
  };

  probeVersion: string;
};
```

Unknown/non-applicable values stay absent/null rather than invented.

---

# 9. Color / HDR handling

V1 should produce a predictable **SDR social master**.

Phone recordings may arrive as:

```text
SDR
HDR10
HLG
Dolby Vision
```

If HDR metadata is mishandled, social output can become:

```text
washed out
over-bright
low contrast
or visually inconsistent between platforms
```

Therefore color handling is a first-class normalization concern.

### V1 output policy

Default master color profile:

```text
SDR_BT709_SOCIAL_V1
```

Conceptually:

```text
BT.709 primaries
BT.709 SDR transfer/matrix policy
social-compatible 4:2:0 output
```

Exact encoder flags are owned by a versioned ColorProfile.

### Input rule

If source is already compatible SDR:

```text
preserve/normalize metadata safely
```

If source is detected as HDR / HLG / Dolby Vision:

```text
decode correctly
→ deterministic tone-map / color conversion
→ SDR BT.709 working/output pipeline
```

If safe conversion cannot be guaranteed:

```text
fail preflight with explicit unsupported-color error
```

Do not silently strip HDR metadata while leaving HDR pixel values unchanged.

---

# 10. ColorProfile

```ts
type ColorProfile = {
  key: string;
  version: string;

  outputDynamicRange: "SDR";

  primaries: string;
  transfer: string;
  matrix: string;
  range: string;

  pixelFormat: string;

  hdrInputPolicy:
    | "TONE_MAP_TO_SDR"
    | "REJECT_UNSUPPORTED";
};
```

Initial key:

```text
SDR_BT709_SOCIAL_V1
```

---

# 11. Input normalization

Do not force all uploaded source media to be permanently re-encoded on ingest.

V1 uses normalization when needed for reliable rendering.

Possible normalized working formats:

```text
video:
  renderer-compatible codec/container
  normalized orientation
  stable timestamps

audio:
  renderer-compatible PCM/AAC path as appropriate
  known sample rate/channel layout
```

Normalization outputs are intermediate or cached Assets only when useful.

Original uploads remain preserved.

---

# 12. Orientation

Phone recordings may contain rotation metadata.

The worker must resolve effective orientation from probe metadata and normalize visual orientation before layout calculations.

EditingPlan coordinates refer to the **display-corrected media orientation**, not raw encoded orientation.

---

# 13. Template root/version

Existing domain:

```text
Template
└── TemplateVersion
```

TemplateVersion is immutable.

A Render pins an exact TemplateVersion through its EditingPlanVersion.

---

# 14. Template responsibility

A Template defines available composition primitives and layout capabilities.

It does not define the marketing strategy.

A template may implement:

- product canvas;
- presenter layer;
- captions;
- text cards;
- background;
- comparison panes;
- CTA treatment;
- motion presets;
- masks;
- borders/shadows;
- brand styling.

---

# 15. TemplateRuntimeContract

```ts
type TemplateRuntimeContract = {
  templateVersionId: string;

  compositionKey: string;
  rendererApiVersion: string;

  supportedCanvas: {
    width: 1080;
    height: 1920;
    allowedFps: number[];
  };

  supportedLayers: (
    | "BACKGROUND"
    | "PRODUCT"
    | "BROLL"
    | "PRESENTER"
    | "TEXT"
    | "CAPTION"
    | "OVERLAY"
  )[];

  requiredSlots: TemplateSlot[];
  optionalSlots: TemplateSlot[];

  supportedMotionPresetKeys: string[];
  supportedTransitionPresetKeys: string[];
  supportedChromaKeyProfileKeys: string[];
  supportedCodecProfileKeys: string[];
  supportedAudioProfileKeys: string[];

  assetDependencies: string[];
};
```

---

# 16. TemplateSlot

```ts
type TemplateSlot = {
  key: string;

  accepts:
    | "VIDEO"
    | "IMAGE"
    | "AUDIO"
    | "TEXT"
    | "PRESENTER"
    | "PRODUCT";

  required: boolean;

  maxInstances?: number;

  constraints?: {
    minDurationMs?: number;
    maxDurationMs?: number;
    aspectRatio?: string;
  };
};
```

Slots are validated before render.

---

# 17. Initial V1 template families

V1 begins with a small number of high-quality template families:

```text
PRODUCT_DEMO
MANUAL_TO_VISION
PROBLEM_SOLUTION
GREEN_SCREEN_EXPLAINER
FOUNDER_STORY
```

Do not create one template for every video.

EditingPlan + profile variation should create diversity inside each family.

---

# 18. Template variants

Template variants should usually be represented by structured parameters/presets rather than new templates.

Examples:

```text
presenter left/right
light/dark supporting surface
comparison split ratio
caption position preset
CTA treatment
```

Create a new TemplateVersion when renderer behavior/contract changes.

Create a new Template root only for a genuinely distinct composition system.

---

# 19. Motion registry

EditingPlan may reference only registered motion keys.

Example registry:

```text
SUBTLE_SCALE_IN
FOCUS_ZOOM
SHORT_SLIDE_UP
SHORT_SLIDE_LEFT
MASK_REVEAL
RESULT_POP
SUBTLE_FADE
```

Each registry entry defines deterministic parameters/ranges.

No arbitrary JavaScript animation code from AI.

---

# 20. Transition registry

Default:

```text
CUT
```

Optional:

```text
MATCH_CUT
SHORT_FADE
SLIDE
MASK_REVEAL
```

Transition implementation is deterministic and template-compatible.

---

# 21. Chroma key registry

Example:

```text
GREENSCREEN_STANDARD_V1
GREENSCREEN_LOW_SPILL_V1
```

Each profile pins deterministic parameters such as:

```text
key color
similarity/tolerance
blend
spill reduction
edge treatment
```

The exact FFmpeg/renderer implementation is hidden behind the profile.

---

# 22. Font strategy

Fonts are media dependencies, not assumed operating-system state.

TemplateVersion must pin allowed font Asset(s) or package-bundled licensed font identifiers.

Render worker must fail clearly if required font cannot be resolved.

Do not depend on random host-installed fonts.

---

# 23. Brand assets

Logo/icon/background assets are pinned through TemplateVersionAsset or allowed Vision asset references.

No mutable "latest logo.png" path in historical render lineage.

---

# 24. Render payload

Before invoking Remotion, application code compiles a renderer payload.

```ts
type RenderPayload = {
  renderAttemptId: string;

  template: TemplateRuntimeContract;

  editingPlan: EditingPlanSpec;

  resolvedAssets: ResolvedRenderAsset[];

  renderSettings: RenderSettings;

  provenance: {
    editingPlanVersionId: string;
    templateVersionId: string;
    editingProfileVersionId: string;
    rendererVersion: string;
    colorProfileKey: string;
    codecProfileKey: string;
    audioProfileKey: string;
  };
};
```

The payload is schema-validated.

---

# 25. ResolvedRenderAsset

```ts
type ResolvedRenderAsset = {
  assetId: string;
  localUri: string;

  kind:
    | "VIDEO"
    | "AUDIO"
    | "IMAGE"
    | "FONT"
    | "OTHER";

  probe: MediaProbe;

  checksumSha256?: string;
};
```

`localUri` is attempt-scoped and never persisted as canonical identity.

---

# 26. Time conversion

EditingPlan uses milliseconds.

Remotion operates with frame-oriented timing.

Conversion:

```text
startFrame = deterministic conversion(startMs, fps)
endFrame   = deterministic conversion(endMs, fps)
```

One shared utility owns rounding rules.

Do not independently round timing in every template component.

---

# 27. Rounding policy

V1 must define one rule.

Recommended:

```text
start frame: floor
end frame: ceil
```

while ensuring:

```text
at least one frame
no timeline overflow
```

This preserves intended coverage better than inconsistent nearest rounding.

---

# 28. Layer order

`zIndex` in EditingPlan is authoritative within supported layer constraints.

Renderer also enforces safety priorities where defined.

Example:

```text
background < product/broll < presenter < editorial text < captions < critical overlay
```

A template may restrict illegal combinations.

---

# 29. Asset trimming

For source media:

```text
sourceInMs
sourceOutMs
```

are applied before/while composing.

Validation checks against probed duration.

Never silently clamp a wildly invalid trim.

Small codec/timestamp tolerance may be handled deterministically and recorded.

---

# 30. Product focus rendering

Normalized ProductFocusWindow coordinates are resolved relative to display-corrected source dimensions.

Operations may include:

```text
static crop
controlled zoom
pan
```

`FOLLOW_TARGET` is only available if the deterministic implementation supports a validated tracking target.

Otherwise the plan is rejected before render or downgraded explicitly by policy.

---

# 31. Presenter rendering

Presenter compositing respects:

```text
NormalizedRect
side
gesture target
chroma key profile
safe zones
product focus
```

The green-screen crop is display-corrected before chroma key/layout.

---

# 32. Caption rendering

Captions consume final validated cue timing.

Renderer owns:

- line wrapping under policy;
- font metrics;
- safe-zone placement;
- emphasis styling;
- animation preset.

Renderer must not rewrite words.

If text cannot fit within policy, validation fails or deterministic fallback is used and diagnosed.

---

# 33. Speech alignment stage

When natural voice is present, caption alignment may require a deterministic/ML transcription alignment stage before final EditingPlan validation.

The output is timestamp data, not creative copy.

Exact alignment engine/vendor is not frozen in this spec.

Requirements:

```text
word/segment timestamps
confidence where available
language support for French
reproducible output metadata
```

---

# 34. Audio assembly

Audio plan may include:

```text
voice
music
SFX
```

Worker validates duration and availability.

Voice remains priority.

---

# 35. Loudness normalization

Use deterministic loudness policy.

Example policy targets may be configured by AudioProfile.

Do not hard-code one LUFS value throughout renderer logic.

Profile contains:

```text
target loudness
true peak ceiling
music under voice behavior
```

Final values belong to versioned AudioProfile configuration.

---

# 36. AudioProfile

```ts
type AudioProfile = {
  key: string;
  version: string;

  voiceTargetLufs: number;
  integratedTargetLufs: number;
  truePeakCeilingDb: number;

  musicUnderVoiceDb: number;

  sampleRate: number;
  channels: number;
};
```

EditingProfile gives editorial preference; AudioProfile gives deterministic mastering parameters.

---

# 37. CodecProfile

```ts
type CodecProfile = {
  key: string;
  version: string;

  container: "mp4";
  videoCodec: string;
  audioCodec: string;

  pixelFormat: string;

  videoSettings: Record<string, unknown>;
  audioSettings: Record<string, unknown>;
};
```

Exact encoder flags are implementation-owned versioned configuration.

---

# 38. Clean master

Default V1 output:

```text
1080x1920
9:16
SDR BT.709 social color profile
no platform watermark
MP4-compatible social master
```

Exact codec profile is configurable/versioned.

The master is platform-neutral.

The master also pins:

```text
ColorProfile
CodecProfile
AudioProfile
```

---

# 39. Exact publication media asset

A Publication must eventually identify the **exact Asset uploaded to the remote platform**.

Current accepted Prisma links:

```text
Publication → Render
Render → approvedAssetId
```

This is sufficient only when every platform receives the clean master unchanged.

Because V1 intentionally allows platform derivatives when required, the final distribution schema needs an explicit relation:

```text
Publication.mediaAssetId → Asset
```

Rule:

```text
no derivative needed:
  Publication.mediaAssetId = Render.approvedAssetId

derivative needed:
  Publication.mediaAssetId = exact derivative Asset
```

This must remain a real relational FK, not a value hidden inside `metadataJson`.

This is a **required schema amendment** to be incorporated before `11_DISTRIBUTION.md` is frozen.

---

# 40. Media derivative provenance

A platform derivative must record where it came from.

V1 proposed minimum provenance:

```text
derived Asset
source master Asset
transformation profile/version
createdAt
```

The exact persistence shape can be:

- a dedicated `AssetDerivation` relation; or
- an equivalent explicit typed relation accepted during Distribution spec.

Do not rely only on filename conventions.

---

# 41. Platform derivatives

V1 creates platform-specific derived media only when necessary.

Examples:

```text
platform duration constraint
codec/container requirement
audio constraint
safe-zone variant
```

Do not create three independently edited videos merely because there are three platforms.

---

# 42. RenderAttempt

A RenderAttempt represents one technical execution using immutable Render intent.

Same inputs + transient technical failure:

```text
new RenderAttempt
same Render
```

Changed EditingPlan/assets:

```text
new Render
```

---

# 43. Render worker idempotence

`operationId` and RenderAttempt identity prevent duplicate canonical results.

If a worker crashes after upload but before DB commit:

```text
recover/reconcile object storage
before rerendering blindly
```

Temporary object naming must allow reconciliation.

---

# 44. Output object naming

Use immutable non-human canonical keys.

Conceptual:

```text
renders/{renderId}/attempts/{attemptNumber}/{assetId}.mp4
```

Do not use title/caption as canonical object key.

---

# 45. Successful output

Only after:

```text
render command success
+ file exists
+ ffprobe readable
+ technical QA pass
+ object upload success
```

may the attempt become `SUCCEEDED`.

---

# 46. Technical QA dimensions

Required deterministic checks include:

```text
output file exists
probe succeeds
video stream exists
expected dimensions
expected display orientation
duration within tolerance
fps acceptable
codec/container allowed
pixel format allowed
expected SDR/BT.709 output color metadata
no accidental HDR/Dolby Vision signaling
audio presence according to plan
audio stream decodable
no catastrophic black output
no catastrophic silence
size > minimum sanity threshold
```

---

# 47. Duration tolerance

Exact frame conversion can cause small boundary differences.

Use explicit tolerance derived from fps/frame duration.

Do not use arbitrary multi-second tolerance.

---

# 48. Black-frame detection

Black-frame QA should detect catastrophic problems, not reject intentional dark frames.

Use:

```text
time window
percentage/duration threshold
context
```

A short intentional black transition is not a failure.

---

# 49. Silence detection

Silence QA distinguishes:

```text
intentional pause
music-free section
actual missing voice/audio
```

Do not fail simply because some silence exists.

Catastrophic silence is evaluated against expected AudioPlan.

---

# 50. TechnicalQaReport

```ts
type TechnicalQaReport = {
  result:
    | "PASS"
    | "FAIL";

  probe: MediaProbe;

  checks: {
    key: string;
    status:
      | "PASS"
      | "FAIL"
      | "WARNING"
      | "NOT_APPLICABLE";
    message?: string;
    data?: unknown;
  }[];

  rendererVersion: string;
  codecProfileKey: string;
  audioProfileKey: string;
};
```

Stored on RenderAttempt.

---

# 51. Diagnostics

On failure preserve bounded diagnostics:

```text
renderer stderr/log excerpt
FFmpeg stderr/log excerpt
probe result
failed validation codes
renderer version
host/worker identity
input Asset IDs
```

Do not preserve huge temporary trees forever.

---

# 52. Failure codes

Video-engine stable codes include:

```text
INPUT_ASSET_MISSING
INPUT_CHECKSUM_MISMATCH
INPUT_PROBE_FAILED
INPUT_UNSUPPORTED
INPUT_COLOR_PROFILE_UNSUPPORTED
HDR_NORMALIZATION_FAILED
TEMPLATE_CONTRACT_FAILED
EDITING_PLAN_INVALID
ASSET_TRIM_INVALID
PRESET_UNKNOWN
COLLISION_VALIDATION_FAILED
NORMALIZATION_FAILED
REMOTION_RENDER_FAILED
FFMPEG_FAILED
OUTPUT_MISSING
OUTPUT_PROBE_FAILED
TECHNICAL_QA_FAILED
OBJECT_UPLOAD_FAILED
INTERNAL_RENDER_ERROR
```

Messages are separate from stable codes.

---

# 53. Retryability

Examples:

Retryable:

```text
temporary object-store fetch failure
transient renderer process crash
temporary disk/resource failure
upload network failure
```

Not blindly retryable:

```text
unknown preset
invalid asset trim
template contract mismatch
missing required slot
unsupported input
```

Retry policy uses failure classification from architecture.

---

# 54. Resource management

Capture/render are heavy workloads.

Worker limits:

```text
max concurrent renders
CPU limit
memory limit
temporary disk budget
render timeout
```

V1 favors predictable throughput over saturating the host.

---

# 55. Cancellation

Render may be cancelled when:

```text
job not started
or
worker supports safe process termination
```

Cancellation must terminate child processes and clean temp resources.

Already uploaded canonical outputs are not silently deleted without policy.

---

# 56. Renderer versioning

Every successful/failed attempt records:

```text
rendererVersion
Remotion package/runtime version
FFmpeg build/version
template source revision
color/codec/audio profile versions
```

Exact persistence layout can be diagnostic JSON plus explicit existing fields where appropriate.

---

# 57. Template source revision

TemplateVersion already contains:

```text
sourceRevision
rendererVersion
```

This should pin the exact code revision/build identity used for the template behavior.

Do not render historical TemplateVersion using silently changed template code.

---

# 58. Build artifact strategy

Production render workers should use a pinned renderer build/image.

TemplateVersion maps to compatible renderer/source revisions.

Do not dynamically `git pull` renderer code before each job.

---

# 59. Preview

Dashboard preview should use the same template contract and EditingPlan data where practical.

Preview does not have to be byte-identical to final encode.

But composition semantics must match.

---

# 60. Render cost

Each RenderAttempt can emit CostEntry data.

Potential dimensions:

```text
duration
render wall time
CPU time if available
storage output bytes
egress where measurable
Remotion licensing/render cost if applicable
```

Do not invent infrastructure cost precision that is unavailable.

---

# 61. Remotion licensing gate

Before production implementation, verify the then-current Remotion licensing terms for this automated internal rendering use case.

Licensing is an operations/commercial dependency, not a reason to couple domain architecture to Remotion.

The rendering boundary should allow replacement if licensing or technical constraints change.

---

# 62. Renderer abstraction

Application layer depends on:

```ts
interface VideoRenderer {
  render(input: ValidatedRenderPayload): Promise<RendererExecutionResult>;
}
```

Remotion implementation sits behind this boundary.

This prevents business/domain code from depending directly on Remotion APIs.

---

# 63. V1 anti-patterns

Do not:

```text
let AI generate arbitrary Remotion code per video
let AI generate shell/FFmpeg commands
render directly from mutable latest template files
trust upload extension instead of probing
skip output probe because process exit code was 0
overwrite previous render output
make local temp paths canonical
use platform-watermarked source as master
depend on host-installed fonts
hide normalization/QA failures
retry permanent contract failures endlessly
```

---

# 64. Spec artifacts after acceptance

Create:

```text
docs/spec-artifacts/video-engine/
├── schema.ts
├── README.md
├── template-contract.json
├── motion-registry.json
├── transition-registry.json
├── chroma-key-profiles.json
├── color-profiles.json
├── audio-profiles.json
└── codec-profiles.json
```

Create initial TemplateVersion specs separately under:

```text
docs/spec-artifacts/templates/
```

---

# 65. Required schema amendment discovered by this spec

The currently accepted Prisma specification should be amended before Distribution is frozen.

Minimum required addition:

```prisma
model Publication {
  // existing fields...
  mediaAssetId String? @db.Uuid

  mediaAsset Asset? @relation(
    "PublicationMediaAsset",
    fields: [mediaAssetId],
    references: [id],
    onDelete: Restrict
  )
}
```

The field may remain nullable while Publication is still DRAFT if the final upload asset has not yet been prepared.

Before:

```text
SCHEDULED
```

it must resolve to the exact Asset intended for upload.

The Asset model requires the corresponding back-relation.

Derivative provenance shape is finalized with Distribution, but the exact uploaded Asset FK is mandatory.

This is not scope creep: it closes a lineage hole revealed by allowing platform-specific derivatives.


# 66. Acceptance checklist

- [x] Video Engine responsibility boundary accepted.
- [x] functional reproducibility invariant accepted.
- [x] render lifecycle accepted.
- [x] Remotion/FFmpeg/ffprobe responsibility split accepted.
- [x] render-attempt isolation accepted.
- [x] asset materialization/probing accepted.
- [x] orientation normalization accepted.
- [x] HDR/Dolby Vision → SDR normalization policy accepted.
- [x] SDR_BT709_SOCIAL_V1 ColorProfile accepted.
- [x] renderer no-arbitrary-remote-fetch rule accepted.
- [x] TemplateRuntimeContract accepted.
- [x] five template families accepted.
- [x] motion/transition/chroma registries accepted.
- [x] font/brand asset pinning accepted.
- [x] RenderPayload accepted.
- [x] ms→frame conversion policy accepted.
- [x] source trimming accepted.
- [x] product focus/presenter/caption execution accepted.
- [x] speech-alignment stage boundary accepted.
- [x] AudioProfile accepted.
- [x] CodecProfile accepted.
- [x] clean master + derivative policy accepted.
- [x] exact `Publication.mediaAssetId` requirement accepted.
- [x] derivative provenance requirement accepted.
- [x] RenderAttempt/idempotence behavior accepted.
- [x] TechnicalQaReport accepted.
- [x] technical QA dimensions accepted.
- [x] failure code/retry policy accepted.
- [x] renderer version/build pinning accepted.
- [x] renderer abstraction accepted.
- [x] Remotion licensing gate accepted.

After acceptance:

1. freeze `08_VIDEO_ENGINE.md`;
2. generate renderer/template spec artifacts;
3. update Decisions/Status/Checklist;
4. proceed to `09_PRODUCT_CAPTURE_PLAYWRIGHT.md`.
