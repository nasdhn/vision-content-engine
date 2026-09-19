# 06 — Pattern Library Specification

**Status:** ACCEPTED  
**Specification version:** spec-v0.7  
**Scope:** Vision Content Engine V1  
**Depends on:** AI Contracts ACCEPTED
**Accepted:** 2026-09-18

---

# 1. Purpose

The Pattern Library is the reusable strategic memory that prevents the Creator from generating random generic content.

A Pattern is a reusable **marketing/story mechanism**.

It describes:

- what psychological or narrative mechanism is being used;
- when that mechanism is appropriate;
- how the story is structured;
- what visual proof is useful;
- what common failure modes to avoid.

A Pattern is **not**:

- a finished script;
- a copied competitor video;
- a hook library entry;
- an editing template;
- an editing profile;
- a platform post;
- a performance score.

Core principle:

```text
REFERENCE
→ ABSTRACT MECHANISM
→ PATTERN
→ HYPOTHESIS
→ VISION ADAPTATION
→ EXPERIMENT
→ PERFORMANCE EVIDENCE
```

---

# 2. Pattern vs related concepts

## Pattern

Defines **why and how the story persuades**.

Example:

```text
MANUAL_TO_AUTOMATION
```

Mechanism:

```text
show painful repeated manual work
→ reveal automated alternative
→ prove result
```

## Angle

Defines **what specific idea is being argued**.

Example:

```text
"Prospecting manually on Google Maps wastes time."
```

## Template

Defines **how content is visually rendered**.

Example:

```text
split-screen product demo with presenter inset
```

## EditingProfile

Defines **how the edit behaves over time**.

Example:

```text
FAST_PRODUCT_DEMO
```

These four concepts must not be merged.

---

# 3. Root/version model

Accepted domain model:

```text
Pattern
└── PatternVersion
```

`Pattern` is stable identity.

`PatternVersion` is immutable strategy definition.

Every ConceptVersion records the exact:

```text
patternVersionId
```

that influenced it.

An ACTIVE PatternVersion is never edited in place.

---

# 4. Pattern lifecycle

Pattern root status:

```text
DRAFT
ACTIVE
DEPRECATED
ARCHIVED
```

Meaning:

### DRAFT

Pattern exists but is not eligible for automatic concept generation.

### ACTIVE

Eligible for deterministic candidate selection.

### DEPRECATED

Historical use remains valid, but the selector no longer proposes it by default.

### ARCHIVED

Hidden from normal management views and retained for lineage.

---

# 5. Pattern categories

V1 controlled primary categories:

```text
PAIN
TRANSFORMATION
DEMONSTRATION
EDUCATION
CONTRARIAN
PROOF
FOUNDER
OBJECTION
```

A Pattern has:

```text
one stable primary category
+
zero or more version-specific tags
```

Tags are descriptive and may evolve without creating new semantic categories.

## 5.1 Category stability rule

The primary category belongs to the stable `Pattern` identity in the accepted Prisma model.

A PatternVersion may repeat that category in exported/spec artifacts for readability, but it must match the root Pattern category.

If a proposed revision changes the mechanism enough to require a different primary category, create a **new Pattern root** rather than silently changing the historical category of the existing Pattern.

Tags remain flexible/version-specific descriptive metadata.


Examples:

```text
manual-work
prospecting
workflow
product-proof
founder
time-saving
mistake
comparison
```

---

# 6. PatternVersion contract

```ts
type PatternVersionSpec = {
  identity: {
    patternVersionId: string;
    patternKey: string;
    name: string;
    version: number;

    category:
      | "PAIN"
      | "TRANSFORMATION"
      | "DEMONSTRATION"
      | "EDUCATION"
      | "CONTRARIAN"
      | "PROOF"
      | "FOUNDER"
      | "OBJECTION";

    tags: string[];
  };

  thesis: {
    description: string;
    psychologicalMechanism: string;
    whyItMayWork: string;

    whenToUse: string[];
    whenNotToUse: string[];
  };

  structure: {
    hook: PatternHookStructure;
    story: PatternStoryBeat[];
    visual: PatternVisualStructure;
    cta: PatternCtaStructure;
  };

  adaptation: {
    suitableVisionUseCases: string[];
    suitableAudiences: string[];

    compatiblePrimaryFormats: PrimaryFormat[];

    compatibleEditingProfileKeys: string[];
  };

  constraints: {
    forbiddenMoves: string[];
    commonFailureModes: string[];

    requiresProductProof: boolean;
    requiresHumanPresence: boolean;
    requiresExternalClaimEvidence: boolean;
  };

  provenance: PatternProvenance;
};
```

Important:

**Performance evidence is intentionally absent from PatternVersion.**

PatternVersion remains immutable strategic truth.

---

# 7. Hook structure

```ts
type PatternHookStructure = {
  objective: string;

  shape:
    | "QUESTION"
    | "PROBLEM_STATEMENT"
    | "CONTRARIAN_CLAIM"
    | "RESULT_FIRST"
    | "MISTAKE"
    | "COMPARISON"
    | "LIVE_PROOF"
    | "OBSERVATION";

  formula: string;

  timingGuidance: {
    targetFirstBeatMs: number;
    maxSetupMs: number;
  };

  originalExamples: string[];
};
```

`originalExamples` must be:

- synthetic;
- written for Vision;
- or abstract examples.

Do not store copied competitor scripts here.

---

# 8. Story beats

```ts
type PatternStoryBeat = {
  order: number;

  role:
    | "HOOK"
    | "CONTEXT"
    | "PAIN"
    | "PROOF"
    | "TRANSFORMATION"
    | "EXPLANATION"
    | "OBJECTION"
    | "DEMO"
    | "CTA";

  objective: string;

  optional: boolean;

  durationWeight?: number;
};
```

`durationWeight` is relative guidance, not a fixed timeline.

The Creative Director may adapt wording and exact duration while preserving the strategic mechanism.

---

# 9. Visual structure

```ts
type PatternVisualStructure = {
  openingVisualIntent: string;

  recommendedVisualModes: (
    | "PRODUCT_SCREEN"
    | "GREEN_SCREEN_PRESENTER"
    | "TEXT_LED"
    | "BEFORE_AFTER"
    | "COMPARISON"
    | "BROLL"
  )[];

  proofMoment?: string;

  recommendedRevealWindow?: {
    minMs: number;
    maxMs: number;
  };

  visualFailureModes: string[];
};
```

Pattern visual guidance is editorial.

It does not replace the EditingPlan.

---

# 10. CTA structure

```ts
type PatternCtaStructure = {
  preferredTypes: (
    | "SOFT_DISCOVERY"
    | "TRY_PRODUCT"
    | "VISIT_PROFILE"
    | "COMMENT"
    | "SAVE"
    | "FOLLOW"
    | "NO_CTA"
  )[];

  tone: string;

  placementGuidance:
    | "EARLY"
    | "MIDDLE"
    | "END"
    | "CONTEXT_DEPENDENT";

  avoid: string[];
};
```

The final CTA is still selected by the Creative Director within allowed Brand Knowledge.

---

# 11. Pattern provenance

```ts
type PatternProvenance = {
  sourceType:
    | "INTERNAL_SYNTHESIS"
    | "USER_OBSERVATION"
    | "REFERENCE_ANALYSIS"
    | "PERFORMANCE_DERIVED"
    | "RESEARCH_DERIVED";

  sourceReferenceIds: string[];

  createdBy:
    | "HUMAN"
    | "AI_ASSISTED";

  abstractionNotes?: string;
};
```

Rule:

```text
Reference ≠ Pattern
```

A source/reference is evidence that inspired analysis.

The Pattern must express the **abstract mechanism**, not reproduce the source.

---

# 12. Performance evidence is separate

Performance changes over time.

Therefore it must not be stored inside immutable PatternVersion definition.

Conceptual evidence view:

```ts
type PatternEvidenceSnapshot = {
  patternVersionId: string;

  computedAt: string;
  analysisWindow: {
    from: string;
    to: string;
  };

  usage: {
    conceptCount: number;
    publishedCount: number;
  };

  signals: {
    metric: string;
    observation: string;

    confidence:
      | "INSUFFICIENT_DATA"
      | "WEAK_SIGNAL"
      | "INTERESTING_SIGNAL"
      | "FAIRLY_SOLID";

    comparablePublicationIds: string[];
    limitations: string[];
  }[];

  knownBiases: string[];
};
```

This snapshot is derived from publication/analytics lineage.

It is not the Pattern's identity.

---

# 13. No universal Pattern score

V1 explicitly forbids a canonical field like:

```text
patternScore = 92
```

because it creates false certainty across:

- different audiences;
- different topics;
- different platforms;
- different durations;
- different editing styles;
- different sample sizes.

Evidence remains contextual.

---

# 14. Deterministic Pattern Selector

Creator does not receive every active PatternVersion.

A deterministic selector creates a bounded candidate set first.

Inputs:

```text
BriefVersion
Idea
target audience
Vision use case
allowed PrimaryFormats
available production capabilities
recent content memory
recent Pattern usage
explicit exclusions
exploration policy
```

Output:

```ts
type PatternCandidateSet = {
  candidates: {
    patternVersionId: string;

    eligibilityReasons: string[];

    cautions: string[];

    evidenceSummary?: {
      confidence: string;
      observation: string;
    };
  }[];
};
```

Creator may only select one of these candidates.

---

# 15. Pattern eligibility rules

A PatternVersion is excluded when a hard incompatibility exists.

Examples:

```text
requiresProductProof = true
but no usable product demonstration can be produced
```

or:

```text
requiresHumanPresence = true
but current production request explicitly forbids presenter footage
```

or:

```text
requiresExternalClaimEvidence = true
but no verified evidence is available
```

Hard eligibility is deterministic.

---

# 16. Pattern ranking philosophy

Do not use one opaque global AI score.

Candidate selection should use understandable factors:

```text
strategic fit
production compatibility
recent fatigue
evidence relevance
exploration need
explicit campaign constraints
```

Implementation may assign internal weights later, but candidate explanations must remain inspectable.

---

# 17. Exploration and exploitation

Default V1 mode:

```text
BALANCED
```

Conceptual guidance:

```text
majority:
  strategically suitable patterns with useful prior signal

meaningful minority:
  under-tested but suitable patterns

small minority:
  deliberate novel variants
```

Do not hard-code permanent percentages in domain logic.

Percentages belong to configurable policy.

---

# 18. Pattern fatigue

Do not block a Pattern merely because it was used recently.

Fatigue is evaluated through combination similarity.

Dimensions:

```text
patternVersion
audience
topic
angle
hook shape
proof type
primary format
platform
```

Examples:

```text
same Pattern
+ different audience
+ different problem
= potentially valuable variation
```

while:

```text
same Pattern
+ same angle
+ nearly identical hook
+ same proof
= probable repetition
```

---

# 19. Deliberate variants

A deliberate variant is allowed when it explicitly records:

```text
what remains constant
what changes
why the variant exists
```

Example:

```text
constant:
  MANUAL_TO_AUTOMATION
  same product proof

change:
  hook from pain statement → result first

purpose:
  test hook framing
```

This belongs to Experiment/Concept metadata, not a new Pattern by default.

---

# 20. Initial seed philosophy

Do not start with dozens of patterns.

Too many overlapping Pattern definitions make selection worse.

V1 starts with **8 core patterns**.

Additional patterns are added only when they represent a genuinely distinct mechanism.

---

# 21. Initial V1 seed set

```text
1. MANUAL_TO_AUTOMATION
2. PROBLEM_TO_SOLUTION
3. MISTAKE_CONSEQUENCE_FIX
4. CONTRARIAN_EXPLANATION
5. RESULT_FIRST_HOW
6. FOUNDER_OBSERVATION_LESSON
7. LIVE_PRODUCT_PROOF
8. OBJECTION_TO_PROOF
```

Patterns such as:

```text
BEFORE_TO_AFTER
OLD_WAY_NEW_WAY
HIDDEN_COST_OF_MANUAL_WORK
```

are initially treated as possible **angles/variants** of the core mechanisms rather than separate Patterns.

This avoids unnecessary semantic overlap.

---

# 22. Seed — MANUAL_TO_AUTOMATION

## Mechanism

Contrast visible repeated manual effort with a concrete automated path.

## When to use

- manual process is understandable;
- Vision genuinely removes steps;
- product proof is available.

## Core flow

```text
manual pain
→ repeated steps
→ pivot
→ Vision workflow
→ concrete result
→ CTA
```

## Visual intent

```text
manual tools / tabs / spreadsheet / Maps
→ visual pivot
→ Vision capture
```

## Failure mode

Generic:

```text
"AI saves you time"
```

without showing real proof.

---

# 23. Seed — PROBLEM_TO_SOLUTION

## Mechanism

Make one specific pain recognizable before presenting Vision as the answer.

## Flow

```text
specific problem
→ consequence
→ solution mechanism
→ proof
→ CTA
```

## Failure mode

Problem too broad:

```text
"Prospecting is hard."
```

Better:

```text
"You spend 40 minutes opening company websites just to see whether they fit."
```

Claims still require evidence where factual/numerical.

---

# 24. Seed — MISTAKE_CONSEQUENCE_FIX

## Mechanism

Reveal a common behavior that produces a bad outcome, then show the correction.

## Flow

```text
mistake
→ consequence
→ why
→ corrected workflow
→ proof
```

Useful for educational content without becoming a tutorial-only channel.

---

# 25. Seed — CONTRARIAN_EXPLANATION

## Mechanism

Challenge a familiar assumption, then justify the alternative.

## Flow

```text
contrarian hook
→ qualification
→ explanation
→ proof/example
→ takeaway
```

Risk:

manufactured controversy.

Rule:

the contrarian position must reflect a defensible Vision/product/founder viewpoint.

---

# 26. Seed — RESULT_FIRST_HOW

## Mechanism

Reveal a useful result before explaining the process.

## Flow

```text
result
→ curiosity gap
→ how it happened
→ short workflow
→ CTA
```

Very compatible with short product demos.

---

# 27. Seed — FOUNDER_OBSERVATION_LESSON

## Mechanism

Use a genuine founder/product-building observation as the entry point.

## Flow

```text
observation
→ concrete situation
→ lesson
→ implication for prospecting/business
→ optional Vision connection
```

Rule:

do not fabricate personal founder experiences.

---

# 28. Seed — LIVE_PRODUCT_PROOF

## Mechanism

Use actual product behavior as the hook.

## Flow

```text
visible proof/result
→ what is happening
→ minimal explanation
→ workflow/result
→ CTA
```

Risk:

slow or visually unreadable UI.

Requires strong product capture.

---

# 29. Seed — OBJECTION_TO_PROOF

## Mechanism

Start from a real objection or doubt and answer it with evidence/demonstration.

Examples:

```text
"Mais une IA de prospection va juste me sortir des entreprises au hasard."
```

then:

```text
show constraints
→ show output
→ explain qualification
```

Risk:

inventing objections nobody actually has.

Use objections from:
- real user questions;
- sales conversations;
- known target-customer concerns;
- clearly framed hypotheses.

---

# 30. Pattern activation quality gate

A PatternVersion cannot become ACTIVE unless it has:

- one distinct mechanism;
- clear when-to-use;
- clear when-not-to-use;
- HookStructure;
- StoryBeats;
- VisualStructure;
- CTA guidance;
- production requirements;
- common failure modes;
- provenance;
- at least one original Vision-specific adaptation example;
- no obvious semantic duplicate among existing ACTIVE Patterns.

---

# 31. Pattern semantic overlap review

Before activating a new Pattern:

```text
compare mechanism
compare hook role
compare story progression
compare proof mechanism
```

If difference is mostly:

```text
topic
wording
hook text
specific use case
```

then it is probably an Angle, not a new Pattern.

---

# 32. Pattern deprecation

Deprecate rather than delete when:

- mechanism is redundant;
- it consistently creates low-quality concepts;
- strategic assumptions change;
- a better consolidated Pattern replaces it.

Historical ConceptVersions retain the old PatternVersion relation.

---

# 33. Future SourceReference

Automatic external research is deferred, but future SourceReference should support:

```text
platform
url
author/account
discoveredAt
observedAt
transcript/summary
observed hook structure
observed story structure
observed visual structure
observed CTA
visible public metrics if available
analysis notes
```

A SourceReference is never treated as ground truth for algorithm behavior.

---

# 34. Future Researcher flow

```text
research objective
↓
discover candidate references
↓
SourceReference
↓
extract mechanism
↓
compare against active Pattern Library
↓
new Pattern proposal
or
new evidence/reference for existing Pattern
↓
validation
```

One successful reference must never automatically create a "proven" Pattern.

---

# 35. Pattern analytics

Performance is derived through lineage:

```text
PatternVersion
← ConceptVersion
← Render
← Publication
← MetricSnapshot
```

Analysis must control for context where possible:

```text
platform
measurement window
format
duration
topic
audience
editing profile
CTA
sample size
```

---

# 36. V1 management UX requirement

Pattern Library management must eventually display:

```text
name
category
status
mechanism
when to use
recent usage
contextual evidence
known failure modes
current version
```

It must not present one simplistic global leaderboard.

---

# 37. Spec artifacts after acceptance

After acceptance create:

```text
docs/spec-artifacts/pattern-library/
├── schema.ts
├── README.md
└── seeds/
    ├── MANUAL_TO_AUTOMATION.json
    ├── PROBLEM_TO_SOLUTION.json
    ├── MISTAKE_CONSEQUENCE_FIX.json
    ├── CONTRARIAN_EXPLANATION.json
    ├── RESULT_FIRST_HOW.json
    ├── FOUNDER_OBSERVATION_LESSON.json
    ├── LIVE_PRODUCT_PROOF.json
    └── OBJECTION_TO_PROOF.json
```

These remain specification artifacts until implementation authorization.

---

# 38. Acceptance checklist

- [x] Pattern vs Angle vs Template vs EditingProfile distinction accepted.
- [x] root/version lifecycle accepted.
- [x] controlled categories accepted.
- [x] immutable PatternVersion contract accepted.
- [x] performance evidence separated from PatternVersion accepted.
- [x] hook/story/visual/CTA contracts accepted.
- [x] provenance rules accepted.
- [x] no universal Pattern score accepted.
- [x] deterministic candidate selector accepted.
- [x] eligibility rules accepted.
- [x] exploration/exploitation policy accepted.
- [x] fatigue based on combination similarity accepted.
- [x] deliberate variant policy accepted.
- [x] 8-pattern initial seed set accepted.
- [x] semantic overlap gate accepted.
- [x] Pattern activation/deprecation policy accepted.
- [x] external Researcher remains deferred.

Historical freeze actions — completed:

1. freeze `06_PATTERN_LIBRARY_SPEC.md`;
2. create strict Pattern Zod artifact;
3. create the 8 seed Pattern artifacts;
4. update Decisions/Status/Checklist;
5. proceed to `07_EDITING_INTELLIGENCE.md`.
