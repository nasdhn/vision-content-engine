# 27 — Phase 9 Learning Implementation Freeze

**Status:** ACCEPTED FOR IMPLEMENTATION  
**Phase:** 9 — Learning loop  
**Base checkpoint:** `e3c5494ceb0316c86119346b2228e5da10dd987d`  
**Branch:** `phase/9-learning`  
**Depends on:** Phase 8 closed and `pnpm check:phase8` green  
**Prisma migration:** none expected

---

# 1. Purpose

Phase 9 turns trustworthy Phase 8 evidence into bounded, reviewable learning outputs:

```text
Phase 8 evidence
→ deterministic comparability / EvidencePolicy
→ experiment evidence frames
→ Analyst interpretation
→ durable Insight
→ durable Recommendation
→ optional human-approved next-test proposal
```

Phase 9 does **not** rewrite analytics evidence and does **not** autonomously mutate strategy.

---

# 2. Canonical source boundary

Phase 9 may read:

```text
MetricSnapshotNormalized
AttributionEvent
Publication
Render lineage
ConceptVersion
PatternVersion
EditingProfileVersion
TemplateVersion
Experiment
ExperimentArm
prior Insight
```

It may also read durable diagnostics required to explain data quality or comparability.

Phase 9 must not treat raw provider payloads as direct Analyst input.

Raw Phase 8 evidence remains immutable under its own retention rules.

---

# 3. Existing persistence reused

The current schema already contains:

```text
Experiment
ExperimentArm
Insight
Recommendation
WorkflowRun(WEEKLY_ANALYSIS)
JobAttempt
ModelInvocation
AuditEvent
```

Phase 9 V1 therefore requires **no Prisma migration**.

Any implementation that appears to require a schema change must stop for explicit review before
modifying Prisma.

---

# 4. Evidence before AI

The Analyst never decides whether rows are comparable.

A deterministic Evidence Engine runs first and produces versioned evidence frames containing:

```text
analysis window
measurement window
metric key / business outcome
platform
metric semantics version
eligible publication IDs
excluded publication IDs + reasons
sample size
distinct publish dates
content dimensions
comparability limitations
attribution confidence notes
outlier diagnostics
deterministic confidence ceiling
EvidencePolicy version
```

The LLM receives this prepared evidence, not an unfiltered database dump.

---

# 5. Phase 9 EvidencePolicy runtime v1

Canonical runtime policy key:

```text
EVIDENCE_POLICY_RUNTIME_V1
```

Confidence labels retain their spec meaning:

```text
INSUFFICIENT_DATA
WEAK_SIGNAL
INTERESTING_SIGNAL
FAIRLY_SOLID
```

They describe **evidence quality**, not statistical certainty.

Runtime guardrails:

```text
single Publication → max WEAK_SIGNAL

direct comparison requires:
- same measurement window
- compatible metric semantics
- compatible analysis grain
- no unresolved source-authority conflict

INTERESTING_SIGNAL ceiling requires:
- at least 3 comparable Publications
- at least 2 distinct publish dates
- important confounders explicitly represented

FAIRLY_SOLID ceiling requires:
- at least 6 comparable Publications
- at least 3 distinct publish dates
- compatible metric semantics
- consistent direction across observations
- no single observation dominating the conclusion
- important confounders documented
```

These thresholds are implementation policy, not universal scientific claims.

---

# 6. Outlier and direction guardrails

Runtime defaults:

```text
outlierDominanceShare = 0.60
consistentDirectionShare = 0.75
```

If the engine cannot defensibly calculate a required outlier/direction check for a candidate
`FAIRLY_SOLID` frame, the ceiling must remain below `FAIRLY_SOLID`.

Do not silently assume the check passed.

---

# 7. Comparison grain

Primary supported grains:

```text
Publication
PatternVersion
EditingProfileVersion
TemplateVersion
Platform
Experiment
```

Phase 9A may start with the dimensions already available structurally.

An LLM must not rediscover structured dimensions such as platform, pattern, template, editing
profile, duration or measurement age.

---

# 8. Platform and metric comparability

Cross-platform metrics are not assumed equivalent by name.

A direct comparison must respect:

```text
measurement window
metricSemanticsVersion
comparabilityJson
platform-specific definitions
```

If the semantics are incompatible or unknown:

```text
direct comparison = blocked
limitation = persisted/presented
```

The Analyst may discuss the limitation but may not override it.

---

# 9. Business outcome authority

Phase 9 inherits Phase 8 source authority:

```text
UMAMI      → WEBSITE_VISIT
VISION_APP → SIGNUP / ACTIVATION / CUSTOMER / REVENUE
```

Attribution confidence remains separate:

```text
DIRECT
INFERRED
UNKNOWN
```

`INFERRED` must never be silently promoted to `DIRECT`.

Unknown/unlinked outcomes may be included as business context but must not be attached to a
specific Publication without evidence.

---

# 10. NULL versus zero

Mandatory invariant:

```text
NULL = unavailable / unsupported / not observed
0    = observed zero
```

The Evidence Engine, Analyst input builder, persisted Insight evidence and Learning UI must preserve
this distinction.

No ratio may silently coalesce a NULL numerator or denominator to zero.

---

# 11. Deterministic confidence ceiling

Each evidence frame computes a deterministic maximum confidence.

Example:

```text
frame ceiling = WEAK_SIGNAL
Analyst returns INTERESTING_SIGNAL
→ validation failure
→ output rejected
```

The Analyst may return a lower confidence than the ceiling.

It may never return a higher one.

The persisted Insight records both:

```text
analystConfidence
deterministicConfidenceCeiling
```

inside durable evidence metadata.

---

# 12. Analyst V1

Capability:

```text
ANALYST
```

A versioned prompt artifact must be added before runtime use.

The Analyst input follows the already frozen Analyst contract and includes only structured,
bounded evidence:

```text
analysisWindow
eligible Publications + normalized metrics
comparability notes
Experiment snapshots
prior relevant Insights
business attribution signals
minimum EvidencePolicy
```

No secrets, raw provider payloads or arbitrary SQL/database dumps.

---

# 13. Analyst hard validation

Before persistence, validation must enforce:

```text
every evidencePublicationId belongs to the provided evidence frame
confidence <= deterministic ceiling
unknown UUIDs rejected
unsupported metric/window rejected
deterministic limitations cannot be removed
NULL semantics preserved
no unsupported causal claim
no universal "always works" rule
no invented Experiment arm/publication
```

Deterministic limitations are merged into the persisted Insight even if the Analyst omits them.

---

# 14. Causality boundary

Phase 9 V1 sets:

```text
causalClaimsAllowed = false
```

even for deliberate Experiments.

Allowed wording:

```text
"In this sample, arm A had a higher 7-day signup rate than arm B."
```

Forbidden as an autonomous conclusion:

```text
"Hook A caused more customers."
```

No experiment in V1 is automatically treated as randomized causal evidence.

---

# 15. Experiment analysis

Existing `Experiment.primaryMetric` is respected.

The analyzer does not change the primary metric after observing results.

Experiment analysis checks:

```text
declared primary metric
arm membership
measurement readiness
same/comparable window
metric availability
source authority
sample count per arm
data-quality limitations
```

An Experiment can yield `INSUFFICIENT_DATA`.

Phase 9 does not mutate Experiment status based on observed metrics.

---

# 16. No automatic winner state

The current schema has no canonical Experiment winner field and Phase 9 V1 does not invent one.

The system may persist a bounded descriptive Insight such as:

```text
"Arm A had the higher observed primary metric in the eligible sample."
```

with confidence and limitations.

It must not create an authoritative global winner or rewrite future strategy.

---

# 17. Durable Insight

Every persisted `Insight` must contain at least:

```text
scopeType
scopeId when applicable
statement
confidence
modelInvocationId when AI-generated

evidenceJson:
- analysisOperationKey
- EvidencePolicy version
- analysis window
- measurement window(s)
- evidence Publication IDs
- excluded Publication IDs/reasons
- sample size/context
- deterministic confidence ceiling
- metric/business outcome
- structured dimensions

limitationsJson:
- deterministic comparability limitations
- Analyst limitations
- data-quality limitations
```

Insight evidence is append-only learning evidence.

Do not mutate historical Insights to make a later conclusion look cleaner.

---

# 18. Durable Recommendation

Recommendations are linked to supporting Insights.

New recommendations start:

```text
PROPOSED
```

`recommendedTestJson` contains:

```text
hypothesis
change
keepConstant[]
primaryMetric
measurementWindow
```

A Recommendation is a proposal, not an instruction to mutate strategy.

---

# 19. Recommendation lifecycle

Allowed operator transitions:

```text
PROPOSED → ACCEPTED
PROPOSED → REJECTED
ACCEPTED → EXECUTED
```

Illegal transitions fail closed.

Accepting a Recommendation does **not** directly:

```text
modify a Pattern
modify an EditingProfile
modify a Template
modify prompts
change posting cadence
change CTA policy
generate Concepts
publish content
```

---

# 20. Recommendation → Experiment proposal

The preferred flow is:

```text
Insight
→ Recommendation
→ human ACCEPTS
→ explicit "Create experiment proposal" action
→ DRAFT Experiment
```

Acceptance alone does not create the Experiment.

The explicit proposal action may create exactly one DRAFT Experiment for that accepted
Recommendation and must be idempotent.

No content generation starts automatically.

---

# 21. Weekly analysis workflow

Use existing:

```text
WorkflowRun.workflowType = WEEKLY_ANALYSIS
```

Canonical flow:

```text
PENDING
→ collect eligible evidence
→ build deterministic evidence frames
→ evaluate Experiments
→ invoke Analyst
→ validate output against EvidencePolicy
→ persist Insights/Recommendations atomically
→ SUCCEEDED
```

Failures do not leave partially persisted learning outputs.

---

# 22. Weekly analysis window

A weekly run always receives an explicit UTC half-open interval:

```text
[from, to)
```

The scheduler must persist the intended window before dispatch.

Retries reuse the same logical window and operation identity.

Do not derive a different window from worker wall-clock time on retry.

---

# 23. Idempotence

A logical weekly analysis has a stable:

```text
analysisOperationKey
```

derived from:

```text
analysis window
EvidencePolicy version
Analyst prompt version
```

Retries must not create duplicate Insights/Recommendations for the same successful logical
operation.

Use PostgreSQL transaction/advisory locking or an equivalent canonical database fence.

BullMQ identity alone is not the source of truth.

---

# 24. Prior Insight context

The Analyst may receive prior relevant Insights, but they are context, not truth.

Prior Insights:

```text
must keep their original confidence
must keep their limitations
must not override current evidence
must not be recursively treated as new independent samples
```

The input builder must bound how many prior Insights are supplied.

---

# 25. Weekly report

The weekly report is a **read projection**, not a new truth table.

Default sections:

```text
1. Business outcomes
2. Funnel
3. Platform performance
4. Content/pattern signals
5. Editing signals
6. Experiments
7. Anomalies/data-quality issues
8. Recommendations for next week
```

It is generated from durable Phase 8 evidence plus persisted Phase 9 Insights/Recommendations.

---

# 26. Learning UI

The dashboard may expose:

```text
weekly analysis runs
Insights
confidence
evidence/sample context
limitations
Recommendations
Recommendation status
Experiment evidence
```

Confidence and limitations must remain visible.

The UI must not present a high-view / zero-business-outcome item as an unqualified success.

---

# 27. No strategy autopilot

Phase 9 V1 must not automatically:

```text
change AI prompts
retire or promote Patterns
change EditingProfile defaults
change Templates
change posting frequency
change CTA policy
accept Recommendations
create Concepts
publish content
```

The system learns by producing evidence-backed proposals for a human.

---

# 28. No provider activation

Phase 9 does not enable real analytics providers.

`VCE_REAL_PROVIDERS_ENABLED` remains fail-closed exactly as Phase 8 left it.

Provider activation remains Phase 11.

---

# 29. AI safety / prompt-injection boundary

Analytics text fields, referrers, captions, titles and metadata are **data**, never instructions.

The Analyst prompt must explicitly state this.

Analyst input uses structured fields and bounded strings.

No provider/user text may:

```text
change the output schema
request secrets
request code execution
change EvidencePolicy
override deterministic limitations
```

---

# 30. Cost boundary

Every Analyst invocation remains subject to the existing AI gateway:

```text
budget reservation
max attempts
timeout
token limits
cost ceiling
provider fallback policy
ModelInvocation / ModelInvocationAttempt persistence
```

A failed or over-budget invocation produces no durable Insight/Recommendation output.

---

# 31. Phase 9 implementation sequence

Implementation order is frozen:

```text
9A — Evidence & Comparability Engine
9B — Experiment Evidence Analyzer
9C — Analyst Runtime + hard validation
9D — Insight / Recommendation persistence + lifecycle
9E — Weekly Analysis orchestration + idempotence
9F — Learning UI / weekly report / explicit next-test proposal
9G — Phase 9 closure
```

Do not skip ahead.

---

# 32. Phase 9A — Evidence & Comparability Engine

Expected scope:

```text
runtime EvidencePolicy contract
analysis-frame types
measurement-window compatibility
metric-semantics compatibility
source-authority helpers
NULL-safe rate helpers
sample/date counts
outlier/direction diagnostics
deterministic confidence ceiling
unit + PostgreSQL evidence fixtures
```

No Analyst call in 9A.

---

# 33. Phase 9B — Experiment Evidence Analyzer

Expected scope:

```text
load Experiment/ExperimentArm
resolve exact Publication membership
validate declared primary metric
measurement readiness
arm-level sample context
comparison frame
descriptive arm result
limitations
```

No Experiment status mutation and no global winner field.

---

# 34. Phase 9C — Analyst Runtime

Expected scope:

```text
analyst prompt artifact
existing AnalystInput/Output contracts wired to runtime
AI gateway invocation
deterministic fake Analyst
hard business validation
confidence ceiling enforcement
evidence-ID subset enforcement
causal-language guardrail
tests without live AI provider
```

No Insight persistence until output validation is green.

---

# 35. Phase 9D — Durable Learning Outputs

Expected scope:

```text
transactional Insight persistence
Recommendation persistence
AuditEvent
Recommendation transition service
idempotent accepted-recommendation → DRAFT Experiment proposal action
```

No concept generation from that Experiment.

---

# 36. Phase 9E — Weekly Analysis Orchestration

Expected scope:

```text
WEEKLY_ANALYSIS WorkflowRun
canonical window
stable operation identity
JobAttempt/outbox/BullMQ
durable lease/fencing
atomic final persistence
retry/recovery
no duplicate learning outputs
```

Worker payload remains secret-free.

---

# 37. Phase 9F — Learning UI / Weekly Report

Expected scope:

```text
authenticated read models
weekly run status
Insights + confidence
sample/evidence context
limitations
Recommendations + status controls
explicit experiment-proposal action
weekly report projection
mobile/browser tests
```

No autonomous strategy controls.

---

# 38. Tests

Phase 9 must include deterministic tests proving at minimum:

```text
single publication cannot exceed WEAK_SIGNAL
incompatible windows block direct comparison
incompatible metric semantics block direct comparison
NULL is not zero
outlier dominance caps confidence
confidence above deterministic ceiling is rejected
unknown evidence Publication ID is rejected
unsupported causal language is rejected
Experiment primary metric cannot be switched after results
retry does not duplicate Insights/Recommendations
Recommendation transitions fail closed
acceptance alone creates no Experiment
explicit proposal action creates at most one DRAFT Experiment
weekly worker payload is secret-free
no real AI/provider call occurs in tests
```

---

# 39. Completion gate

Phase 9 closure must add:

```text
pnpm check:phase9
```

and preserve all earlier gates.

The final gate must include at least:

```text
test:infra
check
test:postgres
test:storage
test:analytics:runtime
test:distribution:runtime
test:learning:runtime
build:web
test:browser
```

---

# 40. Stop conditions

Stop and report instead of inventing a decision if implementation would require:

```text
Prisma migration
changing frozen Phase 8 evidence semantics
real provider activation
unbounded raw provider retention
a new mandatory human production gate
autonomous strategy mutation
a causal claim policy beyond this freeze
secret exposure
remote side effects
```

---

# 41. Phase 9 exit condition

Phase 9 is complete only when the system can:

```text
take canonical Phase 8 evidence
deterministically bound what comparisons are valid
invoke the Analyst without letting it expand evidence confidence
persist durable Insights/Recommendations
let a human accept/reject Recommendations
create an idempotent DRAFT Experiment proposal only on explicit action
run a retry-safe weekly analysis workflow
present learning with visible confidence/limitations
```

while preserving:

```text
raw evidence
normalized evidence
attribution confidence
source authority
NULL semantics
human agency
```
