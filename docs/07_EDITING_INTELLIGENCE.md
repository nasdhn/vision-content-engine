# 07 — Editing Intelligence

**Status:** ACCEPTED  
**Specification version:** spec-v0.8  
**Scope:** Vision Content Engine V1  
**Depends on:** Pattern Library ACCEPTED
**Accepted:** 2026-09-18

---

# 1. Purpose

Editing Intelligence is the editorial brain of the Content Engine.

Its goal is not to make a technically valid video.

Its goal is to make an automated short-form video feel as if a competent human editor intentionally decided:

- what the viewer sees;
- when the viewer sees it;
- what is cut;
- what is emphasized;
- where the eye should look;
- when the product appears;
- when the presenter appears;
- how subtitles behave;
- where silence/breathing is preserved;
- how sound supports attention;
- when the story ends.

The renderer executes.

Editing Intelligence decides.

---

# 2. Central quality principle

The system must optimize for:

```text
clarity
+ pace
+ proof
+ natural human rhythm
+ visual hierarchy
+ retention
```

not:

```text
maximum cuts
+ maximum zooms
+ maximum animations
```

Automation must not produce "AI editing style" as an aesthetic.

---

# 3. Editing Intelligence vs renderer

## Editing Intelligence

Produces:

```text
EditingPlanVersion
```

including:

- timeline structure;
- shot selection;
- cut points;
- visual focus;
- crop/zoom intent;
- caption plan;
- presenter placement;
- motion presets;
- audio intent;
- CTA ending behavior.

## Renderer

Consumes validated instructions and executes them deterministically using:

```text
Remotion
FFmpeg
ffprobe
```

Renderer does not make creative decisions.

---

# 4. Editing Intelligence vs Creative Director

## Creative Director

Decides the production concept:

```text
script
scenes
required recordings
required captures
template
editing profile
CTA
```

## Editing Intelligence

Decides the actual edit using the real assets that became available:

```text
exact asset selection
exact timing
exact cuts
exact focus
exact captions
exact visual composition
```

The Editing Intelligence may not rewrite the strategic concept silently.

If available assets make the CreativePlan impossible, it returns a structured blocker rather than inventing a different video.

---

# 5. EditingProfile

An EditingProfile defines reusable editing behavior.

Initial V1 profiles:

```text
FAST_PRODUCT_DEMO
FOUNDER_STORY
GREEN_SCREEN_EXPLAINER
PROBLEM_SOLUTION
MANUAL_VS_VISION
HIGH_ENERGY_SHORT
CALM_EXPERT_SHORT
```

Profiles are not finished timelines.

They provide constraints/default tendencies.

---

# 6. EditingProfileVersion contract

```ts
type EditingProfileVersionSpec = {
  identity: {
    editingProfileVersionId: string;
    key: string;
    version: number;
    name: string;
  };

  pacing: PacingPolicy;
  cuts: CutPolicy;
  captions: CaptionPolicy;
  focus: VisualFocusPolicy;
  motion: MotionPolicy;
  presenter: PresenterPolicy;
  audio: AudioPolicy;
  hook: HookEditingPolicy;
  ending: EndingPolicy;

  constraints: {
    suitablePrimaryFormats: PrimaryFormat[];
    minDurationMs: number;
    maxDurationMs: number;
    requiresHumanPresenter: boolean;
  };
};
```

---

# 7. Timebase

All canonical edit timing is integer milliseconds.

```text
startMs inclusive
endMs exclusive
```

Rules:

```text
startMs >= 0
endMs > startMs
endMs <= masterDurationMs
```

Frame conversion occurs in renderer.

The AI never expresses timing using vague language like:

```text
"after a little while"
"quickly"
"near the end"
```

without concrete timing output.

---

# 8. Master duration

The final EditingPlan defines:

```text
masterDurationMs
```

All child timing must fit inside it.

The master duration must remain within:

```text
CreativePlan target constraints
TemplateVersion capabilities
EditingProfile bounds
platform policy bounds
```

---

# 9. Asset evidence

Editing Intelligence receives only validated available assets.

Each asset summary includes enough information to make editing decisions:

```ts
type EditingAssetSummary = {
  assetId: string;
  kind: "VIDEO" | "AUDIO" | "IMAGE" | "SUBTITLE" | "OTHER";

  source:
    | "RECORDING"
    | "CAPTURE"
    | "SYSTEM"
    | "UPLOAD";

  durationMs?: number;
  width?: number;
  height?: number;
  fps?: number;

  semanticRole?: string;

  inspection?: {
    transcriptSegments?: TranscriptSegment[];
    visualMoments?: VisualMoment[];
    silenceWindows?: TimeRange[];
    qualityWarnings?: string[];
  };
};
```

It cannot reference an asset absent from the request.

---

# 10. Selection before timing

EditingPlan generation happens in two conceptual passes:

```text
PASS A — editorial selection
PASS B — timing/composition
```

Pass A decides:

- which takes;
- which capture moments;
- which screen/result;
- which product proof;
- which voice asset;
- which optional B-roll.

Pass B decides exact timing.

This prevents timing logic from being built around irrelevant source media.

Implementation may use one model call if the output contract clearly separates both phases.

---

# 11. Human take selection

When several takes exist, selection should consider:

```text
script completeness
clarity
pace
energy fit
technical quality
gesture usefulness
green-screen cleanliness
duration
```

The system must not select a take solely because it is shortest.

If automatic inspection cannot evaluate a meaningful criterion, it should not pretend to.

---

# 12. Natural voice editing

The user's real voice is the default.

Editing rules:

- remove clearly dead pre-roll/post-roll;
- trim excessive dead space;
- preserve intentional micro-pauses;
- do not remove every breath;
- do not time-stretch voice to force duration by default;
- avoid unnatural sentence fragmentation;
- do not cut inside words;
- avoid cuts that change linguistic meaning.

Audio timing is the backbone for narrated content.

Visual edits usually adapt to speech, not the reverse.

---

# 13. Silence policy

Not all silence is bad.

Silence classification:

```text
DEAD_AIR
NATURAL_BREATH
EMPHASIS_PAUSE
TRANSITION_PAUSE
UNKNOWN
```

Default:

```text
DEAD_AIR → trim aggressively
NATURAL_BREATH → usually preserve
EMPHASIS_PAUSE → preserve
TRANSITION_PAUSE → profile-dependent
UNKNOWN → conservative
```

The engine should prefer slightly human rhythm over hyper-compressed robotic speech.

---

# 14. Cut grammar

Cuts should occur primarily at meaningful boundaries:

```text
idea change
sentence/phrase boundary
visual proof change
speaker/presenter state change
product action change
attention reset
```

Avoid cutting only because a timer elapsed.

---

# 15. Minimum shot duration

Profiles define soft shot-duration ranges.

Hard rule:

Do not create extremely short flashes that are unreadable unless the profile explicitly supports them.

Example policy:

```text
ordinary information shot:
  target >= 700ms

text requiring reading:
  duration based on text/readability

pattern interrupt:
  may be shorter if visually simple
```

Exact thresholds remain profile configuration.

---

# 16. PacingPolicy

```ts
type PacingPolicy = {
  targetEnergy:
    | "CALM"
    | "MODERATE"
    | "FAST"
    | "HIGH";

  preferredAverageShotMs: {
    min: number;
    max: number;
  };

  maxDeadAirMs: number;

  preserveNaturalPauseUpToMs: number;

  maxUnchangedVisualMs: number;

  patternInterruptGuidance: {
    enabled: boolean;
    minimumSpacingMs: number;
    preferredTypes: string[];
  };
};
```

`maxUnchangedVisualMs` is a warning threshold, not a mandatory cut timer.

---

# 17. Pattern interrupts

Allowed examples:

```text
meaningful crop change
switch presenter ↔ product
result reveal
short text card
focus zoom
comparison switch
B-roll insert
```

Pattern interrupt must support:

```text
meaning
clarity
proof
attention
```

not simply movement for movement's sake.

---

# 18. Hook editing

The first 1–2 seconds receive special treatment.

The hook should have:

```text
one dominant idea
one dominant focal point
immediate audio/text meaning
minimal setup
```

Avoid:

```text
logo intro
long fade
empty establishing shot
slow cursor setup
multi-line paragraph before meaning
```

---

# 19. HookEditingPolicy

```ts
type HookEditingPolicy = {
  maxSetupMs: number;

  requireMeaningfulFirstFrame: boolean;

  allowLogoIntro: false;

  preferredOpeningModes: (
    | "PRESENTER"
    | "PRODUCT_RESULT"
    | "PROBLEM_VISUAL"
    | "TEXT_STATEMENT"
  )[];

  maximumSimultaneousFocalElements: number;
};
```

Default maximum focal elements in the opening should be low.

---

# 20. Visual hierarchy

At every meaningful moment the viewer should know:

```text
where to look first
what matters second
what can be ignored
```

Each scene/timeline block can define:

```text
primary focal element
secondary element
supporting element
```

The renderer uses layout, scale, opacity and motion to support that hierarchy.

---

# 21. Product UI readability

Vision UI must remain readable on a phone.

Rules:

- do not show a full desktop viewport when the important UI is tiny;
- crop to task-relevant region;
- use focus zoom when necessary;
- preserve enough context for orientation;
- avoid constant zoom motion;
- never obscure the exact proof with captions/presenter.

---

# 22. Product focus windows

A capture may include many UI regions.

Editing Intelligence may define focus windows:

```ts
type ProductFocusWindow = {
  startMs: number;
  endMs: number;

  assetId: string;

  region: NormalizedRect;

  behavior:
    | "STATIC_CROP"
    | "ZOOM_IN"
    | "PAN"
    | "FOLLOW_TARGET";

  reason: string;
};
```

`FOLLOW_TARGET` requires deterministic tracking support; if unavailable, reject or downgrade.

---

# 23. Crop coordinate system

Canonical visual coordinates should be normalized:

```text
x: 0..1
y: 0..1
width: 0..1
height: 0..1
```

Reason:

- independent of source resolution;
- easier validation;
- reusable across renderer sizes.

This supersedes ambiguous pixel-like crop fields from early draft contracts.

Implementation schemas must use the normalized convention consistently.

---

# 24. Presenter composition

For the user's established green-screen format:

```text
half-face / partial presenter
points toward content
product remains primary proof
```

Presenter is not automatically centered.

Editing Intelligence considers:

```text
gesture direction
product focus region
caption safe zone
CTA safe zone
face visibility
```

---

# 25. PresenterPolicy

```ts
type PresenterPolicy = {
  allowedSides: ("LEFT" | "RIGHT")[];

  preferredWidthPercent: {
    min: number;
    max: number;
  };

  avoidCoveringProductRegion: boolean;
  avoidCoveringCaptionRegion: boolean;

  gestureAwarePlacement: boolean;

  maximumContinuousPresenterMs?: number;
};
```

Placement can switch only when editorially justified.

Avoid presenter bouncing from side to side unnecessarily.

---

# 26. Green-screen keying

AI chooses a named profile only.

Example:

```text
GREENSCREEN_STANDARD_V1
GREENSCREEN_LOW_SPILL_V1
```

Actual chroma key parameters are deterministic renderer configuration.

Editing Intelligence never outputs raw FFmpeg chroma-key commands.

---

# 27. Caption philosophy

Captions are for:

```text
comprehension
retention
emphasis
silent viewing
```

not decoration.

Default:

- semantic chunks;
- high contrast;
- short line length;
- sparse emphasis;
- accurate timing;
- no constant bouncing words.

---

# 28. CaptionPolicy

```ts
type CaptionPolicy = {
  mode:
    | "SEMANTIC_CHUNKS"
    | "SHORT_PHRASES";

  maxLines: number;
  maxCharactersPerLine: number;

  minimumCueMs: number;
  maximumCueMs: number;

  emphasis: {
    enabled: boolean;
    maxHighlightedWordsPerCue: number;
  };

  safeZone: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
};
```

Safe-zone values use normalized or percentage convention defined by renderer contract.

---

# 29. Caption timing source

Preferred timing authority:

```text
real aligned speech timestamps
```

Fallback:

```text
script timing estimate
```

Estimated caption timing must be marked as estimated until real audio alignment is available.

When natural voice exists, final render should use speech-aligned timing where technically practical.

---

# 30. On-screen text vs captions

These are separate.

## Captions

Represent speech.

## On-screen editorial text

Adds:

```text
label
number
comparison
result
CTA
short emphasis
```

Do not duplicate full captions as giant on-screen text unless the template explicitly calls for it.

---

# 31. Motion philosophy

Motion should explain or direct attention.

Preferred:

```text
small scale changes
controlled position moves
mask reveals
focus zoom
short slide/fade
number/stat emphasis
```

Avoid by default:

```text
random rotations
constant bounce
unmotivated transitions
excessive blur
every-word motion
```

---

# 32. MotionPolicy

```ts
type MotionPolicy = {
  allowedPresetKeys: string[];

  maximumConcurrentMotions: number;

  preferSubtleMotion: boolean;

  requirePurposeForMotion: boolean;

  defaultTransitionDurationMs: {
    min: number;
    max: number;
  };
};
```

All motion keys must exist in a deterministic registry.

---

# 33. Transitions

Default transition is:

```text
CUT
```

Other transitions need a reason.

Examples:

```text
MATCH_CUT
SHORT_FADE
SLIDE
MASK_REVEAL
```

Avoid using transitions to hide weak structure.

---

# 34. Audio hierarchy

Priority:

```text
1. spoken voice
2. meaningful product/system sound if intentionally used
3. music
4. SFX
```

Music must never compromise speech intelligibility.

---

# 35. AudioPolicy

```ts
type AudioPolicy = {
  voiceTargetLoudness: {
    targetLufs: number;
    tolerance: number;
  };

  music: {
    enabled: boolean;
    defaultUnderVoiceDb: number;
    allowNoMusic: boolean;
  };

  sfx: {
    enabled: boolean;
    maxEventsPer10Sec: number;
  };

  avoidContinuousAttentionSfx: boolean;
};
```

Exact loudness normalization is deterministic.

---

# 36. Music choice

Music is optional.

Do not add music simply because the template supports it.

Useful when:

```text
rhythm benefits
energy benefits
does not distract
rights/usage are valid
```

Silence or voice-only is valid.

---

# 37. SFX

SFX should mark:

```text
meaningful reveal
interface state change
comparison pivot
CTA accent
```

Not every cut.

Repeated generic whooshes are explicitly discouraged.

---

# 38. Product sound

Do not fabricate click sounds that imply user actions if they create misleading product representation.

Synthetic interface SFX may be used stylistically only when clearly non-deceptive.

---

# 39. Script-to-visual alignment

Every major spoken claim should ideally have one of:

```text
visual proof
supporting product view
presenter emphasis
short editorial text
intentional visual rest
```

Avoid unrelated stock/B-roll that merely fills space.

---

# 40. Proof priority

When a script makes a claim that Vision can demonstrate:

```text
show proof > decorative motion
```

If visual proof conflicts with presenter prominence:

```text
proof wins
```

---

# 41. Manual → Vision edit grammar

Recommended:

```text
manual friction
↓
brief contrast beat
↓
Vision product focus
↓
result
```

Do not spend most of the video making the manual workflow look better than the product.

---

# 42. Founder Story edit grammar

Recommended:

```text
presenter first
↓
real context / artifact
↓
lesson
↓
optional product connection
```

Keep the human rhythm calmer than FAST_PRODUCT_DEMO.

Do not force product screenshots every two seconds.

---

# 43. Problem → Solution edit grammar

Recommended:

```text
problem visual/presenter
↓
consequence
↓
clear pivot
↓
Vision proof
↓
CTA
```

The pivot should be perceptible.

---

# 44. High-energy profile

`HIGH_ENERGY_SHORT` does not mean chaos.

It may use:

```text
shorter shot durations
faster product focus changes
more frequent emphasis
stronger opening cut
```

but must still respect readability and audio clarity.

---

# 45. Calm expert profile

`CALM_EXPERT_SHORT` allows:

```text
longer stable shots
fewer transitions
more natural pauses
less motion
more presenter continuity
```

without becoming visually static.

---

# 46. EditingPlan structure

Conceptual final plan:

```ts
type EditingPlanSpec = {
  masterDurationMs: number;

  selectedAssets: SelectedAsset[];

  timeline: TimelineBlock[];

  productFocus: ProductFocusWindow[];

  captions: CaptionCue[];

  onScreenText: EditorialTextCue[];

  presenter: PresenterCue[];

  audio: AudioPlan;

  transitions: TransitionInstruction[];

  renderSettings: RenderSettings;

  rationale: EditingRationale;
};
```

---

# 47. SelectedAsset

```ts
type SelectedAsset = {
  assetId: string;

  role:
    | "VOICE"
    | "PRESENTER"
    | "PRODUCT_CAPTURE"
    | "SCREENSHOT"
    | "BROLL"
    | "MUSIC"
    | "SFX"
    | "IMAGE";

  sourceInMs?: number;
  sourceOutMs?: number;

  reason: string;
};
```

For source video/audio:

```text
0 <= sourceInMs < sourceOutMs <= source duration
```

---

# 48. Timeline layer model

Timeline must explicitly support layering.

```ts
type TimelineBlock = {
  id: string;

  startMs: number;
  endMs: number;

  layer:
    | "BACKGROUND"
    | "PRODUCT"
    | "BROLL"
    | "PRESENTER"
    | "TEXT"
    | "CAPTION"
    | "OVERLAY";

  zIndex: number;

  source: TimelineSource;

  composition: VisualComposition;

  purpose: string;
};
```

This is more precise than a flat sequence of shots.

---

# 49. VisualComposition

```ts
type VisualComposition = {
  opacity: number;

  region: NormalizedRect;

  scaleMode:
    | "FIT"
    | "FILL"
    | "CROP";

  motionPresetKey?: string;
};
```

More specialized product focus/presenter behavior may further refine this.

---

# 50. NormalizedRect

```ts
type NormalizedRect = {
  x: number;      // 0..1
  y: number;      // 0..1
  width: number;  // >0..1
  height: number; // >0..1
};
```

Validate:

```text
x + width <= 1
y + height <= 1
```

unless an explicitly supported overscan mode exists.

---

# 51. Editing plan hard validation

Before render:

```text
all asset IDs exist
all timings valid
all source trims valid
timeline within master duration
no forbidden overlap
all motion presets exist
all chroma profiles exist
caption timing valid
caption safe zone valid
presenter/product collision constraints satisfied
audio assets exist
template slots satisfied
render settings supported
```

AI rationale cannot override hard validation.

---

# 52. Collision detection

The engine should deterministically detect important visual collisions:

```text
presenter covers product focus
caption covers CTA
caption covers important product output
multiple dominant text blocks overlap
```

Editing Intelligence can propose layout, but deterministic geometry validates it.

---

# 53. Safe zones

V1 uses configurable safe zones for:

```text
platform UI overlays
captions
CTA
presenter
product proof
```

Do not hard-code TikTok UI geometry inside general domain logic.

Store per-platform/layout policy configuration.

The clean master remains platform-neutral where possible.

---

# 54. Master render philosophy

Default:

```text
one clean 1080x1920 master
no platform watermark
```

Platform-specific derivative only when genuinely necessary.

Avoid creating three independently edited versions in V1 unless platform constraints require it.

---

# 55. Technical QA

Deterministic technical QA includes:

```text
file exists
decodable
expected width/height
expected duration tolerance
expected fps
audio stream expectations
no catastrophic black frames
no invalid silence
no missing source
no render exception
```

---

# 56. Creative QA preparation

Renderer/inspection pipeline should produce a structured inspection bundle for Creative QA.

Potential inputs:

```text
sampled frames
scene boundaries
cut timestamps
caption observations
speech transcript
silence windows
product focus windows
presenter placement
audio signals
```

Creative QA should not be forced to infer the complete video from metadata if multimodal inspection is available.

---

# 57. Human final review

The final human reviewer sees:

```text
video
concept
hook
script
CTA
Creative QA result
warnings/issues
```

Default review action:

```text
APPROVE
REJECT
REGENERATE
```

Structured rejection reasons feed future improvement.

---

# 58. Rejection repair strategy

Examples:

```text
PACING_TOO_SLOW
→ create new EditingPlanVersion with pacing-focused change
→ new Render
```

```text
CAPTIONS_TOO_BUSY
→ new EditingPlanVersion
→ same source assets
→ new Render
```

```text
SCRIPT_VISUAL_MISMATCH
→ may require new CreativePlanVersion or ScriptVersion
```

Repair scope should be minimal.

Do not regenerate the whole content pipeline for a local editing problem.

---

# 59. Editing reproducibility

A Render must pin:

```text
EditingPlanVersion
TemplateVersion
EditingProfileVersion
exact input Assets
renderer version
```

This is already supported by the accepted Prisma lineage.

---

# 60. Deterministic vs AI boundary

## AI-assisted

```text
take choice
pacing proposal
shot structure
product focus intent
caption chunking
presenter placement intent
motion intent
creative QA
```

## Deterministic

```text
timeline arithmetic
asset existence
coordinate validation
collision checks
template capabilities
motion preset execution
chroma key implementation
audio normalization
encoding
technical QA
```

---

# 61. V1 anti-patterns

The system should explicitly avoid:

```text
cut every N milliseconds
zoom every sentence
highlight every spoken word
music always on
whoosh on every transition
full desktop UI shrunk to phone
presenter covering product proof
captions covering interface
logo intro
generic stock footage replacing real proof
AI voice when natural voice exists
fake mouse/click activity
```

---

# 62. Quality diagnostics

For each produced EditingPlan, store diagnostic features useful later:

```text
average visual segment duration
number of cuts
number of focus changes
caption cue count
caption density
presenter screen time
product screen time
motion event count
SFX event count
music presence
hook product visibility time
CTA start time
```

These are descriptive signals, not quality scores.

---

# 63. Future learning

Later Analyst may correlate editing dimensions with outcomes.

Examples:

```text
earlier product reveal
longer presenter continuity
lower caption density
shorter average shots
```

But it must account for context and avoid treating correlation as universal causation.

---

# 64. V1 EditingProfile seed requirement

After acceptance create spec artifacts for the seven profiles:

```text
FAST_PRODUCT_DEMO
FOUNDER_STORY
GREEN_SCREEN_EXPLAINER
PROBLEM_SOLUTION
MANUAL_VS_VISION
HIGH_ENERGY_SHORT
CALM_EXPERT_SHORT
```

Each must have explicit defaults and bounds.

---

# 65. Editing Plan schema artifact

After acceptance create strict Zod spec artifacts for:

```text
NormalizedRect
SelectedAsset
TimelineBlock
ProductFocusWindow
CaptionCue
EditorialTextCue
PresenterCue
AudioPlan
TransitionInstruction
RenderSettings
EditingPlanSpec
EditingProfileVersionSpec
```

Cross-field/timeline refinements must be included, not only structural Zod validation.

---

# 66. Acceptance checklist

- [x] Editing Intelligence vs renderer boundary accepted.
- [x] Editing Intelligence vs Creative Director boundary accepted.
- [x] seven EditingProfiles accepted.
- [x] millisecond timebase accepted.
- [x] two-pass selection/timing model accepted.
- [x] natural voice editing policy accepted.
- [x] silence classification accepted.
- [x] cut grammar accepted.
- [x] pacing policy accepted.
- [x] pattern interrupt policy accepted.
- [x] hook editing rules accepted.
- [x] product UI readability rules accepted.
- [x] normalized coordinate system accepted.
- [x] presenter/green-screen policy accepted.
- [x] caption policy accepted.
- [x] audio/music/SFX policy accepted.
- [x] proof-first visual rule accepted.
- [x] format-specific edit grammars accepted.
- [x] layered EditingPlan model accepted.
- [x] deterministic hard-validation/collision rules accepted.
- [x] technical vs creative QA boundary accepted.
- [x] minimal-scope repair strategy accepted.
- [x] descriptive editing diagnostics accepted.
- [x] explicit V1 anti-patterns accepted.

Historical freeze actions — completed:

1. freeze `07_EDITING_INTELLIGENCE.md`;
2. generate EditingProfile seed artifacts;
3. generate EditingPlan Zod spec artifacts;
4. update Decisions/Status/Checklist;
5. proceed to `08_VIDEO_ENGINE.md`.

---

# spec-v1.0.4 amendment — structured blocker runtime contract

The historical sections above remain normative. The previously stated requirement to return a
structured blocker is now implemented by Editing Intelligence contract/prompt `1.1.0`.

A runtime result is exactly one of:

```text
PLAN    -> complete EditingPlanSpec
BLOCKED -> evidence-bound EditingBlockerSpec
```

`BLOCKED` is a successful editorial conclusion. It never creates a partial EditingPlanVersion,
never authorizes the renderer, and never retries solely because production is blocked. Exact
semantics and persistence are defined by `23_PHASE5_STRUCTURED_EDITING_BLOCKER_AMENDMENT.md`
and ADR-0027.
