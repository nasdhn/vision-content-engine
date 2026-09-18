# 03 — Domain Model

**Status:** ACCEPTED  
**Specification version:** spec-v0.3  
**Scope:** Vision Content Engine V1  
**Depends on:** `02_SYSTEM_ARCHITECTURE.md` (ACCEPTED)
**Accepted:** 2026-09-18

---

## 1. Purpose

This document defines the canonical business/domain model for the Vision Content Engine V1.

The model must support the complete lineage:

`Campaign → Brief → Pattern → Concept → Script → CreativePlan → EditingPlan → Assets/Captures → Render → Approval → Publication → Metrics → Insight`

It must also support:

- immutable version history;
- asynchronous execution;
- retries and idempotency;
- auditability;
- AI cost tracking;
- media provenance;
- publication reconciliation;
- analytics normalization;
- future experiment/learning loops.

The goal is not merely to store content. The goal is to preserve **why a publication exists, how it was produced, what exactly was published, and what happened afterwards**.

---

## 2. Modeling principles

### 2.1 Stable identity + immutable versions

Mutable business objects that evolve over time are separated into:

- a stable root entity;
- one or more immutable version entities.

Example:

```text
Script
  └── ScriptVersion v1
  └── ScriptVersion v2
  └── ScriptVersion v3
```

Published lineage points to the exact version used.

### 2.2 Historical truth is never rewritten

If a published video used `TemplateVersion 4`, later changes to the template must not make history look like it used `TemplateVersion 7`.

### 2.3 Unknown is not zero

Any field that cannot be measured or is unavailable remains `NULL`.

### 2.4 Files are references

Binary files live in object storage.

Database entities store:

- object key;
- checksum;
- mime type;
- size;
- dimensions/duration;
- provenance;
- status.

### 2.5 External identities are first-class

Remote platform IDs are stored explicitly.

Never infer a TikTok/Instagram/YouTube post from URL text alone when a remote ID exists.

### 2.6 Operational history is explicit

Attempts, approvals, failures, AI calls, costs and workflow runs are all modeled.

No important operational event should exist only in logs.

---

# 3. Aggregate map

```text
Campaign
  └── Brief
        └── Idea
              └── Concept
                    └── ConceptVersion
                          ├── Script
                          │    └── ScriptVersion
                          ├── CreativePlan
                          │    └── CreativePlanVersion
                          └── ExperimentArm (optional)

Pattern
  └── PatternVersion

RecordingRequest
  └── Recording
        └── Asset

CaptureScenario
  └── CaptureScenarioVersion
        └── CaptureRun
              └── Asset

Template
  └── TemplateVersion

EditingProfile
  └── EditingProfileVersion

EditingPlan
  └── EditingPlanVersion

Render
  └── RenderAttempt
        └── Asset (final + diagnostics)

Approval

Publication
  └── PublicationAttempt
        ├── MetricSnapshotRaw
        └── MetricSnapshotNormalized

Experiment
  └── ExperimentArm

Insight
Recommendation

WorkflowRun
JobAttempt
OutboxEvent
AuditEvent
ModelInvocation
CostEntry
```

---

# 4. Core strategy entities

## 4.1 Campaign

Represents a bounded content initiative.

Examples:

- `September — Prospecting without website`
- `Vision launch week`
- `Feature X awareness`

Fields:

```text
id
name
slug
objective
status
startsAt
endsAt
createdAt
updatedAt
```

Possible statuses:

```text
DRAFT
ACTIVE
PAUSED
COMPLETED
ARCHIVED
```

Relations:

- has many Briefs;
- has many Publications indirectly through content lineage;
- may have many Experiments.

---

## 4.2 Brief

Human strategic input for a generation cycle.

Fields:

```text
id
campaignId
title
goal
audience
notes
priority
status
createdAt
updatedAt
```

Optional structured fields:

```text
topics[]
productAreas[]
mustMention[]
mustAvoid[]
preferredFormats[]
targetPlatforms[]
targetContentCount
```

A Brief is mutable until generation begins.

Once used to generate content, its effective snapshot must be preserved through `BriefVersion` or an immutable JSON snapshot attached to generation.

### Decision

V1 uses `BriefVersion` to preserve reproducibility.

---

## 4.3 BriefVersion

Immutable.

Fields:

```text
id
briefId
version
payloadJson
createdAt
createdBy
```

Unique constraint:

```text
(briefId, version)
```

Concept generation references `briefVersionId`.

---

## 4.4 Idea

Represents a raw idea/theme before a fully shaped concept.

Sources may include:

```text
USER
BRIEF_DERIVED
PERFORMANCE_DERIVED
RESEARCH_DERIVED   # future
```

Fields:

```text
id
briefId?
title
description
sourceType
sourceReferenceId?
status
createdAt
updatedAt
```

Ideas are intentionally lightweight.

---

# 5. Pattern Library

## 5.1 Pattern

Stable identity for a reusable marketing/content pattern.

Examples:

- `MANUAL_TO_AUTOMATION`
- `PROBLEM_SOLUTION`
- `SHOW_RESULT_FIRST`
- `MISTAKE_FIX`

Fields:

```text
id
key
name
category
status
createdAt
updatedAt
```

Statuses:

```text
DRAFT
ACTIVE
DEPRECATED
ARCHIVED
```

---

## 5.2 PatternVersion

Immutable version.

Fields:

```text
id
patternId
version
description
whenToUse
audienceFitJson
hookStructureJson
storyStructureJson
visualStructureJson
ctaStyleJson
constraintsJson
knownRisksJson
examplesJson
sourceType
sourceMetadataJson
confidence
createdAt
createdBy
```

Concept versions reference the exact `patternVersionId`.

---

# 6. Concept domain

## 6.1 Concept

Stable identity for a content concept.

Fields:

```text
id
ideaId?
briefId
status
createdAt
updatedAt
```

Statuses:

```text
DRAFT
AWAITING_REVIEW
APPROVED
REJECTED
ARCHIVED
```

---

## 6.2 ConceptVersion

Immutable content version.

Fields:

```text
id
conceptId
version
title
angle
hook
audience
objective
hypothesis
selectedPatternVersionId?
rationale
creatorType
creatorModelInvocationId?
createdAt
```

Possible `creatorType`:

```text
HUMAN
AI
HYBRID
```

Unique constraint:

```text
(conceptId, version)
```

Approval points to a specific `ConceptVersion`.

---

# 7. Script domain

## 7.1 Script

Stable identity.

Fields:

```text
id
conceptId
status
createdAt
updatedAt
```

---

## 7.2 ScriptVersion

Immutable.

Fields:

```text
id
scriptId
version
language
fullText
segmentsJson
estimatedDurationMs
voiceMode
createdAt
createdByType
modelInvocationId?
```

`segmentsJson` contains semantic script segments, not final subtitle timing.

Possible voice modes:

```text
NATURAL_USER_VOICE
NO_VOICE
OTHER_HUMAN
AI_VOICE   # allowed by model, not default
```

---

# 8. Creative planning

## 8.1 CreativePlan

Stable identity.

Fields:

```text
id
conceptId
status
createdAt
updatedAt
```

---

## 8.2 CreativePlanVersion

Immutable.

Fields:

```text
id
creativePlanId
version
scriptVersionId
targetDurationMs
primaryFormat
templateFamily
editingProfileKey
scenePlanJson
requiredRecordingsJson
requiredCapturesJson
requiredAssetsJson
ctaJson
platformConsiderationsJson
modelInvocationId?
createdAt
```

Example primary formats:

```text
PRODUCT_DEMO
MANUAL_TO_VISION
PROBLEM_SOLUTION
GREEN_SCREEN_EXPLAINER
FOUNDER_STORY
```

---

# 9. Human recording domain

## 9.1 RecordingRequest

Represents a concrete ask to the human operator.

Fields:

```text
id
creativePlanVersionId
type
title
instructions
scriptSegmentRef?
shotInstructionsJson
status
createdAt
completedAt?
```

Types:

```text
VOICE
GREEN_SCREEN_VIDEO
SCREEN_VIDEO
BROLL
OTHER
```

Statuses:

```text
PENDING
READY
UPLOADED
ACCEPTED
REJECTED
CANCELLED
```

---

## 9.2 Recording

Represents an uploaded human recording.

Fields:

```text
id
recordingRequestId
assetId
takeNumber
status
notes
createdAt
```

Possible statuses:

```text
UPLOADED
SELECTED
REJECTED
ARCHIVED
```

A request may have several takes.

---

# 10. Asset model

## 10.1 Asset

Canonical metadata for a binary object in storage.

Fields:

```text
id
kind
storageProvider
bucket
objectKey
checksumSha256
mimeType
sizeBytes
width?
height?
durationMs?
fps?
audioChannels?
sampleRate?
status
sourceType
sourceEntityType?
sourceEntityId?
createdAt
deletedAt?
```

Kinds:

```text
IMAGE
VIDEO
AUDIO
SUBTITLE
JSON
OTHER
```

Source types:

```text
UPLOAD
RECORDING
CAPTURE
RENDER
SYSTEM
EXTERNAL
```

Statuses:

```text
UPLOADING
READY
FAILED
QUARANTINED
ARCHIVED
```

Constraints:

- `objectKey` unique;
- checksum stored when available;
- referenced approved/published assets are not overwritten.

---

# 11. Product capture

## 11.1 CaptureScenario

Stable identity.

Fields:

```text
id
key
name
status
createdAt
updatedAt
```

---

## 11.2 CaptureScenarioVersion

Immutable executable scenario.

Fields:

```text
id
captureScenarioId
version
targetEnvironment
stepsJson
inputSchemaJson
outputSpecJson
browserConfigJson
createdAt
createdBy
```

---

## 11.3 CaptureRun

One execution.

Fields:

```text
id
captureScenarioVersionId
creativePlanVersionId?
operationId
status
startedAt?
finishedAt?
failureCode?
failureMessage?
traceAssetId?
createdAt
```

Statuses:

```text
PENDING
RUNNING
SUCCEEDED
FAILED
CANCELLED
```

Relations:

- produces many Assets;
- has many JobAttempts.

---

# 12. Template system

## 12.1 Template

Stable template identity.

Fields:

```text
id
key
name
category
status
createdAt
updatedAt
```

---

## 12.2 TemplateVersion

Immutable renderer contract.

Fields:

```text
id
templateId
version
inputSchemaJson
supportedAspectRatiosJson
minDurationMs?
maxDurationMs?
requiredSlotsJson
optionalSlotsJson
capabilitiesJson
rendererVersion
sourceRevision
createdAt
```

A Render references one exact TemplateVersion.

---

# 13. Editing Intelligence model

## 13.1 EditingProfile

Stable editing style identity.

Examples:

```text
FAST_PRODUCT_DEMO
GREEN_SCREEN_EXPLAINER
MANUAL_VS_VISION
PROBLEM_SOLUTION
FOUNDER_STORY
CALM_EXPERT_SHORT
```

Fields:

```text
id
key
name
status
createdAt
updatedAt
```

---

## 13.2 EditingProfileVersion

Immutable rule/profile configuration.

Fields:

```text
id
editingProfileId
version
pacingRulesJson
cutRulesJson
captionRulesJson
focusRulesJson
motionRulesJson
soundRulesJson
hookRulesJson
endingRulesJson
greenScreenRulesJson
createdAt
```

---

## 13.3 EditingPlan

Stable identity.

Fields:

```text
id
creativePlanId
status
createdAt
updatedAt
```

---

## 13.4 EditingPlanVersion

Immutable execution blueprint.

Fields:

```text
id
editingPlanId
version
creativePlanVersionId
editingProfileVersionId
templateVersionId
timelineJson
captionPlanJson
audioPlanJson
visualFocusJson
transitionPlanJson
greenScreenPlanJson
renderSettingsJson
modelInvocationId?
createdAt
```

The render worker consumes an EditingPlanVersion, not free-form AI output.

---

# 14. Rendering

## 14.1 Render

Stable requested deliverable.

Fields:

```text
id
editingPlanVersionId
operationId
status
approvedAssetId?
createdAt
updatedAt
```

Statuses:

```text
REQUESTED
QUEUED
RENDERING
TECHNICAL_QA
CREATIVE_QA
READY_FOR_REVIEW
APPROVED
REJECTED
FAILED
CANCELLED
```

---

## 14.2 RenderAttempt

Each technical execution.

Fields:

```text
id
renderId
attemptNumber
status
workerVersion
rendererVersion
startedAt
finishedAt?
failureCode?
failureMessage?
outputAssetId?
diagnosticAssetId?
technicalQaJson?
createdAt
```

Unique:

```text
(renderId, attemptNumber)
```

---

# 15. Approval model

## 15.1 Approval

Represents a human approval/rejection decision.

Fields:

```text
id
subjectType
subjectId
subjectVersionId?
decision
reasonCode?
comment?
actorType
actorId?
createdAt
```

Subjects V1:

```text
CONCEPT
RENDER
```

Decisions:

```text
APPROVED
REJECTED
```

Actor type:

```text
USER
SYSTEM   # future rules
```

Structured render rejection reason examples:

```text
PACING_TOO_SLOW
PACING_TOO_FAST
CUTS_TOO_MECHANICAL
CAPTIONS_TOO_BUSY
PRODUCT_NOT_VISIBLE_ENOUGH
HOOK_VISUALLY_WEAK
SOUND_TOO_BUSY
CTA_TOO_LONG
GREEN_SCREEN_BAD_PLACEMENT
OTHER
```

---

# 16. Publication model

## 16.1 Platform

Enum-like domain value in V1:

```text
TIKTOK
INSTAGRAM
YOUTUBE
```

A database reference table may still be used if provider metadata is useful.

---

## 16.2 PlatformAccount

Represents a connected account.

Fields:

```text
id
platform
displayName
remoteAccountId
status
credentialsRef
capabilitiesJson
createdAt
updatedAt
```

Credentials themselves are not stored as plaintext in ordinary application fields.

Statuses:

```text
ACTIVE
REAUTH_REQUIRED
DISABLED
ERROR
```

---

## 16.3 Publication

Canonical intended remote post.

Fields:

```text
id
renderId
platformAccountId
operationId
status
scheduledAt?
publishedAt?
remotePostId?
remoteUrl?
metadataJson
createdAt
updatedAt
```

Statuses:

```text
DRAFT
SCHEDULED
PUBLISHING
PUBLISHING_UNKNOWN
PUBLISHED
FAILED
CANCELLED
```

A Publication references the exact approved Render.

---

## 16.4 PublicationAttempt

Fields:

```text
id
publicationId
attemptNumber
status
startedAt
finishedAt?
remoteRequestId?
remotePostId?
responseClass
responseMetadataJson?
failureCode?
failureMessage?
createdAt
```

Response class:

```text
SUCCESS
TRANSIENT_FAILURE
PERMANENT_FAILURE
RATE_LIMITED
UNKNOWN_SIDE_EFFECT
```

Unique:

```text
(publicationId, attemptNumber)
```

---

# 17. Scheduling

Scheduling is represented directly on Publication through:

```text
scheduledAt
status
```

V1 does not require a separate Schedule aggregate.

Reason:

- the canonical scheduled object is the Publication itself;
- separate schedules add indirection without current benefit.

A future editorial calendar can query Publications + Campaign lineage.

---

# 18. Analytics

## 18.1 MetricSnapshotRaw

Immutable raw provider measurement.

Fields:

```text
id
publicationId
platform
collectedAt
providerSchemaVersion?
payloadJson
payloadHash?
createdAt
```

Raw snapshots are append-only.

---

## 18.2 MetricSnapshotNormalized

Normalized view at a point in time.

Fields:

```text
id
publicationId
rawSnapshotId?
collectedAt
views?
likes?
comments?
shares?
saves?
watchTimeMs?
avgWatchDurationMs?
avgWatchPercentage?
completionRate?
profileVisits?
websiteClicks?
otherMetricsJson?
normalizerVersion
createdAt
```

All unavailable values remain `NULL`.

---

# 19. Attribution

## 19.1 AttributionEvent

V1 stores only attribution evidence the system can reasonably observe.

Fields:

```text
id
publicationId?
campaignId?
eventType
occurredAt
source
confidenceType
externalVisitorId?
userId?
metadataJson?
createdAt
```

Possible event types:

```text
WEBSITE_VISIT
SIGNUP
ACTIVATION
CUSTOMER
REVENUE
```

Confidence type:

```text
DIRECT
INFERRED
UNKNOWN
```

V1 must not present inferred attribution as deterministic truth.

---

# 20. Experiment domain

## 20.1 Experiment

Represents a deliberate test.

Fields:

```text
id
campaignId?
name
hypothesis
primaryMetric
status
startedAt?
endedAt?
createdAt
```

Statuses:

```text
DRAFT
RUNNING
COMPLETED
CANCELLED
```

---

## 20.2 ExperimentArm

Links a concept/publication to a tested configuration.

Fields:

```text
id
experimentId
label
conceptVersionId?
publicationId?
variablesJson
createdAt
```

Typical variables:

```text
topic
angle
hookType
patternVersion
templateVersion
editingProfileVersion
ctaType
durationBucket
platform
```

---

# 21. Learning outputs

## 21.1 Insight

Represents an evidence-based observation.

Fields:

```text
id
scopeType
scopeId?
statement
confidence
evidenceJson
limitationsJson
createdAt
modelInvocationId?
```

Confidence vocabulary:

```text
INSUFFICIENT_DATA
WEAK_SIGNAL
INTERESTING_SIGNAL
FAIRLY_SOLID
```

No "winner" state is automatically inferred from a tiny sample.

---

## 21.2 Recommendation

Represents a proposed next test/action.

Fields:

```text
id
insightId?
title
description
recommendedTestJson
status
createdAt
```

Statuses:

```text
PROPOSED
ACCEPTED
REJECTED
EXECUTED
```

---

# 22. Workflow execution model

## 22.1 WorkflowRun

Represents one orchestration instance.

Fields:

```text
id
workflowType
rootEntityType
rootEntityId
status
currentStep
startedAt
finishedAt?
createdAt
updatedAt
```

Workflow types:

```text
CONCEPT_GENERATION
CREATIVE_PRODUCTION
CAPTURE
RENDER
PUBLICATION
ANALYTICS
WEEKLY_ANALYSIS
```

Statuses:

```text
PENDING
RUNNING
WAITING
SUCCEEDED
FAILED
CANCELLED
```

---

## 22.2 JobAttempt

Operational execution record for one worker job.

Fields:

```text
id
workflowRunId?
queueName
jobType
operationId
bullJobId?
attemptNumber
status
workerId?
startedAt?
finishedAt?
failureCode?
failureMessage?
createdAt
```

Status:

```text
QUEUED
RUNNING
SUCCEEDED
FAILED
CANCELLED
```

JobAttempt is operational history, not business state.

---

# 23. Transactional outbox

## 23.1 OutboxEvent

Fields:

```text
id
eventType
aggregateType
aggregateId
payloadJson
status
attemptCount
availableAt
dispatchedAt?
lastError?
createdAt
```

Statuses:

```text
PENDING
DISPATCHING
DISPATCHED
FAILED
```

Unique id:

```text
id
```

Consumers use event/operation identifiers for idempotency.

---

# 24. AI model invocation

## 24.1 ModelInvocation

Every production AI call.

Fields:

```text
id
purpose
provider
model
promptKey
promptVersion
inputSchemaVersion
outputSchemaVersion
status
inputHash
outputHash?
inputTokens?
outputTokens?
cachedInputTokens?
latencyMs?
costAmount?
costCurrency?
relatedEntityType?
relatedEntityId?
startedAt
finishedAt?
failureCode?
createdAt
```

Statuses:

```text
RUNNING
SUCCEEDED
FAILED
REJECTED_SCHEMA
```

Raw prompts/responses may be stored separately or redacted depending on security/privacy policy.

---

# 25. Cost model

## 25.1 CostEntry

Canonical cost ledger.

Fields:

```text
id
category
provider
amount
currency
quantity?
unit?
relatedEntityType?
relatedEntityId?
modelInvocationId?
renderAttemptId?
publicationId?
occurredAt
createdAt
metadataJson?
```

Categories:

```text
AI
RENDER
STORAGE
BANDWIDTH
PLATFORM
OTHER
```

CostEntry is append-only.

This enables:

```text
cost per concept
cost per rendered video
cost per published video
cost per campaign
```

---

# 26. Audit model

## 26.1 AuditEvent

Append-only.

Fields:

```text
id
actorType
actorId?
action
subjectType
subjectId
subjectVersionId?
beforeJson?
afterJson?
metadataJson?
createdAt
```

Actor types:

```text
USER
SYSTEM
WORKER
AI
```

Examples:

```text
CONCEPT_APPROVED
CONCEPT_REJECTED
RENDER_APPROVED
PUBLICATION_SCHEDULED
PUBLICATION_CANCELLED
ASSET_ARCHIVED
AUTONOMY_RULE_CHANGED
```

---

# 27. Content lineage requirements

The following lineage must be queryable without reconstructing from logs:

```text
Publication
→ Render
→ EditingPlanVersion
→ CreativePlanVersion
→ ScriptVersion
→ ConceptVersion
→ PatternVersion?
→ BriefVersion
→ Campaign
```

And media provenance:

```text
Render
→ Assets
   ├── Recording
   ├── CaptureRun
   ├── system asset
   └── template asset
```

And learning:

```text
Publication
→ Metric snapshots
→ Insight
→ Recommendation / Experiment
```

---

# 28. Deletion / archival strategy

Hard deletion is avoided for published lineage.

Entities may be:

- archived;
- disabled;
- logically deleted when safe.

Published or analytics-linked objects remain retained unless there is a legal/security reason requiring deletion.

Object storage cleanup must respect reference counts / retention policy.

---

# 29. Enumerations vs reference tables

Use enums when:

- values are system-level;
- changes require code updates;
- semantics are tightly controlled.

Examples:

```text
PublicationStatus
RenderStatus
ApprovalDecision
Platform
```

Use reference entities when:

- user-configurable;
- versioned;
- data-driven.

Examples:

```text
Pattern
Template
EditingProfile
PlatformAccount
```

---

# 30. JSON usage policy

JSON is acceptable for structured payloads that:

- are versioned contracts;
- vary by template/provider;
- are not primary relational query dimensions.

Examples:

```text
scenePlanJson
timelineJson
capabilitiesJson
raw provider payloads
```

Do **not** hide core relations or frequently queried dimensions in JSON.

Fields such as:

- status;
- platform;
- scheduledAt;
- patternVersionId;
- templateVersionId;
- publicationId;

must remain relational/typed.

---

# 31. Required unique constraints

At minimum:

```text
BriefVersion:             (briefId, version)
Pattern:                  key
PatternVersion:           (patternId, version)
ConceptVersion:           (conceptId, version)
ScriptVersion:            (scriptId, version)
CreativePlanVersion:      (creativePlanId, version)
CaptureScenario:          key
CaptureScenarioVersion:   (captureScenarioId, version)
Template:                 key
TemplateVersion:          (templateId, version)
EditingProfile:           key
EditingProfileVersion:    (editingProfileId, version)
EditingPlanVersion:       (editingPlanId, version)
Render:                   operationId
RenderAttempt:            (renderId, attemptNumber)
Publication:              operationId
PublicationAttempt:       (publicationId, attemptNumber)
Asset:                    objectKey
JobAttempt:               operationId + attemptNumber + jobType
```

Remote platform uniqueness should include:

```text
(platformAccountId, remotePostId)
```

when `remotePostId` is known.

---

# 32. Index requirements

Indexes should support:

- due publications by `status + scheduledAt`;
- pending outbox events by `status + availableAt`;
- workflow status queries;
- publications by platform/account/date;
- metrics by publication/date;
- model invocation cost/date;
- campaign lineage;
- review queues;
- assets by source entity;
- failed jobs needing attention.

Exact index definitions belong in the Prisma/schema draft.

---

# 33. Prisma implementation direction

The future Prisma schema should:

- model all canonical relations explicitly;
- use UUID/CUID-style opaque IDs consistently;
- use `DateTime` in UTC;
- use enums for controlled system state;
- use JSON only under the policy above;
- use explicit relation names where ambiguity exists;
- include indexes supporting worker scans;
- avoid cascading deletion across published lineage;
- use transactions for workflow state + outbox insertion.

The Prisma draft must not be written until this domain model is accepted.

---

# 34. V1 entities required before implementation

The following are considered required V1 entities:

```text
Campaign
Brief
BriefVersion
Idea
Pattern
PatternVersion
Concept
ConceptVersion
Script
ScriptVersion
CreativePlan
CreativePlanVersion
RecordingRequest
Recording
Asset
CaptureScenario
CaptureScenarioVersion
CaptureRun
Template
TemplateVersion
EditingProfile
EditingProfileVersion
EditingPlan
EditingPlanVersion
Render
RenderAttempt
Approval
PlatformAccount
Publication
PublicationAttempt
MetricSnapshotRaw
MetricSnapshotNormalized
AttributionEvent
Experiment
ExperimentArm
Insight
Recommendation
WorkflowRun
JobAttempt
OutboxEvent
ModelInvocation
CostEntry
AuditEvent
```

---

# 35. Explicitly deferred entities

Not required in V1:

```text
Workspace
Organization
Team
Role
Permission
Subscription
Invoice
TemplateMarketplace
ResearchSourceCrawler
Trend
CreatorProfile
SocialGraph
ContentLocalization
```

These must not leak into the V1 schema unless a later accepted spec requires them.

---

# 36. Domain model acceptance criteria

The domain model can move from `PROPOSED` to `ACCEPTED` when:

- [x] Stable entity roots and immutable version entities are accepted.
- [x] Full content lineage is preserved.
- [x] Campaign/Brief/Idea/Concept boundaries are accepted.
- [x] Pattern/PatternVersion structure is accepted.
- [x] Script/CreativePlan/EditingPlan versioning is accepted.
- [x] Recording and Asset separation is accepted.
- [x] CaptureScenario/CaptureRun model is accepted.
- [x] Template and EditingProfile versioning is accepted.
- [x] Render vs RenderAttempt separation is accepted.
- [x] Approval model is accepted.
- [x] Publication vs PublicationAttempt separation is accepted.
- [x] Raw vs normalized metric snapshots are accepted.
- [x] Attribution scope is accepted.
- [x] Experiment/Insight/Recommendation entities are accepted.
- [x] WorkflowRun/JobAttempt separation is accepted.
- [x] OutboxEvent is accepted.
- [x] ModelInvocation + CostEntry are accepted.
- [x] AuditEvent is accepted.
- [x] JSON usage policy is accepted.
- [x] Required unique/index directions are accepted.
- [x] Deferred multi-tenant/billing entities are confirmed out of scope.

After acceptance:

1. mark this document `ACCEPTED`;
2. update `DECISIONS.md`;
3. update `SPEC_FREEZE_CHECKLIST.md`;
4. update `SPEC_STATUS.md` to `spec-v0.3`;
5. create a **Prisma schema draft document**;
6. only after validation, begin `04_WORKFLOWS.md`.

---

# 37. Questions intentionally left for review

The model deliberately leaves a few choices for explicit validation before acceptance:

1. Should `Idea` remain a first-class entity, or should concepts derive directly from Briefs?
2. Should `RecordingRequest` support multiple takes? Proposed answer: yes.
3. Should scheduling remain on `Publication` without a separate Schedule entity? Proposed answer: yes.
4. Should `Insight` and `Recommendation` be V1 entities or only generated report JSON? Proposed answer: first-class entities, because they form the future learning memory.
5. Should `AttributionEvent` exist in V1 even though attribution will be incomplete? Proposed answer: yes, with `DIRECT / INFERRED / UNKNOWN`.


---

# 38. Review decisions — accepted

The five open review questions are resolved as follows:

1. **Idea remains a first-class entity.**
   - One Brief may yield multiple Ideas.
   - One Idea may yield multiple Concepts.
   - This preserves reuse and provenance.

2. **RecordingRequest supports multiple takes.**
   - One request may have multiple Recording rows.
   - One or more takes may be selected for production.

3. **No separate Schedule aggregate in V1.**
   - Canonical scheduling remains on `Publication.scheduledAt`.
   - A separate schedule entity may be introduced only if future requirements justify it.

4. **Insight and Recommendation are first-class entities.**
   - They form durable learning memory.
   - Weekly reports may reference them but are not the only place they live.

5. **AttributionEvent exists in V1.**
   - Attribution confidence is explicit: `DIRECT`, `INFERRED`, or `UNKNOWN`.
   - Inferred attribution must never be presented as deterministic truth.

With these decisions, the Domain Model is accepted and may be translated into a Prisma schema draft.
