# 04 — Workflows

**Status:** ACCEPTED  
**Specification version:** spec-v0.4  
**Scope:** Vision Content Engine V1  
**Depends on:** Architecture ACCEPTED, Domain Model ACCEPTED, Prisma structural review ACCEPTED
**Accepted:** 2026-09-18

---

# 1. Purpose

This document defines all V1 lifecycle states, legal transitions, human gates, asynchronous boundaries, failure behavior and recovery rules.

It is the owner of lifecycle enums that were intentionally not frozen in the Prisma draft.

The guiding rule is:

> Business state lives in PostgreSQL. Queue/job state is operational and cannot replace business state.

---

# 2. Workflow families

V1 contains seven explicit workflow families:

1. Brief / Idea / Concept
2. Creative Production
3. Human Recording
4. Product Capture
5. Editing / Render / Review
6. Publication
7. Analytics / Learning

Each family can run independently but preserves lineage.

---

# 3. Brief lifecycle

## BriefStatus

```text
DRAFT
READY
GENERATING
ACTIVE
COMPLETED
ARCHIVED
```

### Meaning

`DRAFT`
- editable;
- not eligible for generation.

`READY`
- human considers the brief usable;
- can start concept generation.

`GENERATING`
- one or more generation workflows are running.

`ACTIVE`
- generation has produced concepts and the brief remains an active source.

`COMPLETED`
- no further generation expected in normal flow.

`ARCHIVED`
- retained for history, hidden from normal active views.

### Legal transitions

```text
DRAFT → READY
READY → DRAFT
READY → GENERATING
GENERATING → ACTIVE
GENERATING → READY        # generation failed/cancelled before useful result
ACTIVE → GENERATING       # another batch
ACTIVE → COMPLETED
COMPLETED → ACTIVE        # deliberate reopen
DRAFT/READY/ACTIVE/COMPLETED → ARCHIVED
```

A BriefVersion snapshot is created before each concept-generation request.

---

# 4. Idea lifecycle

## IdeaStatus

```text
DRAFT
ACTIVE
EXHAUSTED
ARCHIVED
```

`DRAFT`
- human/AI-created raw idea not yet used.

`ACTIVE`
- eligible for concept generation.

`EXHAUSTED`
- deliberately marked as sufficiently explored; still historically valid.

`ARCHIVED`
- hidden from normal ideation.

Transitions:

```text
DRAFT → ACTIVE
ACTIVE → EXHAUSTED
EXHAUSTED → ACTIVE
DRAFT/ACTIVE/EXHAUSTED → ARCHIVED
```

An idea is never automatically marked `EXHAUSTED` merely because one concept was created.

---

# 5. Concept lifecycle

Existing ConceptStatus is confirmed:

```text
DRAFT
AWAITING_REVIEW
APPROVED
REJECTED
ARCHIVED
```

Flow:

```text
generation
   ↓
DRAFT
   ↓
AWAITING_REVIEW
   ├── approve → APPROVED
   └── reject  → REJECTED
```

Rules:

- only a specific ConceptVersion is approved;
- approving an older ConceptVersion when a newer version exists requires explicit selection;
- rejected concept can receive a new version and return to `AWAITING_REVIEW`;
- `APPROVED` is required before creative production;
- archive does not delete lineage.

---

# 6. Script lifecycle

## ScriptStatus

```text
DRAFT
READY
SUPERSEDED
ARCHIVED
```

Rules:

- a Script root may have many immutable ScriptVersions;
- newest usable version may be `READY`;
- when a new version replaces a prior working version, prior version remains immutable and the root continues to represent the content;
- `SUPERSEDED` is a root-level convenience state only when an entirely new Script root replaces this script, which should be rare.

V1 normal flow:

```text
DRAFT → READY
READY → DRAFT    # only when creating/reworking a new version, not mutating old version
DRAFT/READY → ARCHIVED
```

Important:
Version history, not status mutation, expresses most revisions.

---

# 7. CreativePlan lifecycle

## CreativePlanStatus

```text
DRAFT
READY
BLOCKED_ON_RECORDING
BLOCKED_ON_CAPTURE
READY_FOR_EDITING
SUPERSEDED
ARCHIVED
```

Flow depends on requirements.

After CreativePlanVersion is created:

```text
DRAFT
 ↓ validate
READY
 ├─ needs human recordings → BLOCKED_ON_RECORDING
 ├─ needs product capture  → BLOCKED_ON_CAPTURE
 ├─ needs both             → blocked until both satisfied
 └─ needs neither          → READY_FOR_EDITING
```

When both required recordings and capture outputs become accepted/ready:

```text
BLOCKED_* → READY_FOR_EDITING
```

If a new CreativePlanVersion materially changes requirements:
- previous unfinished requests may be cancelled;
- root remains active;
- new requirements become canonical.

---

# 8. RecordingRequest lifecycle

Existing statuses refined to:

```text
PENDING
READY_TO_RECORD
UPLOADED
ACCEPTED
REJECTED
CANCELLED
```

Meaning:

`PENDING`
- request created but recording pack not yet surfaced/finalized.

`READY_TO_RECORD`
- human can record.

`UPLOADED`
- at least one take exists.

`ACCEPTED`
- one or more takes selected for editing.

`REJECTED`
- uploaded takes insufficient; new take needed.

`CANCELLED`
- requirement removed by a newer CreativePlanVersion or manual cancellation.

Transitions:

```text
PENDING → READY_TO_RECORD
READY_TO_RECORD → UPLOADED
UPLOADED → ACCEPTED
UPLOADED → REJECTED
REJECTED → READY_TO_RECORD
PENDING/READY_TO_RECORD/UPLOADED/REJECTED → CANCELLED
```

Multiple Recording rows/takes may exist.

At least one Recording must be `SELECTED` before request becomes `ACCEPTED`.

---

# 9. Recording lifecycle

Confirmed:

```text
UPLOADED
SELECTED
REJECTED
ARCHIVED
```

A Recording never transitions from `REJECTED` to `SELECTED` without deliberate human action.

Multiple takes may be selected if editing needs several segments.

---

# 10. CaptureRun lifecycle

Confirmed:

```text
PENDING
RUNNING
SUCCEEDED
FAILED
CANCELLED
```

Legal flow:

```text
PENDING → RUNNING
RUNNING → SUCCEEDED
RUNNING → FAILED
PENDING/RUNNING → CANCELLED
FAILED → new CaptureRun
```

Retry rule:
- a retry does not mutate the old CaptureRun back to PENDING;
- create a new JobAttempt for technical retry of the same run when no ambiguous side effect exists;
- create a new CaptureRun only when inputs/scenario version change or a deliberate new execution is requested.

A `SUCCEEDED` capture must have required CaptureRunAsset roles.

---

# 11. EditingPlan lifecycle

## EditingPlanStatus

```text
DRAFT
READY
SUPERSEDED
ARCHIVED
```

An EditingPlanVersion becomes `READY` only when:

- referenced CreativePlanVersion is valid;
- required RecordingRequests are accepted;
- required CaptureRuns succeeded;
- required Assets exist;
- TemplateVersion exists;
- EditingProfileVersion exists;
- structured plan validates.

Rendering consumes an immutable `EditingPlanVersion`.

---

# 12. Render lifecycle

Existing RenderStatus is refined/confirmed:

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

Flow:

```text
REQUESTED
  ↓ outbox
QUEUED
  ↓ worker
RENDERING
  ↓ render succeeds
TECHNICAL_QA
  ├─ fail → FAILED
  └─ pass
       ↓
CREATIVE_QA
  ├─ automatic critical fail → FAILED / regenerate path
  └─ pass/warnings acceptable
       ↓
READY_FOR_REVIEW
  ├─ human approve → APPROVED
  └─ human reject  → REJECTED
```

Rules:

- final human review is mandatory in V1;
- no Publication may reference a non-APPROVED Render;
- a rejected Render is immutable historical output;
- regeneration creates a new Render or new RenderAttempt according to whether inputs changed.

### Retry distinction

Same immutable inputs + transient renderer failure:
- new RenderAttempt under same Render.

Changed EditingPlanVersion / assets / requested creative change:
- new Render.

---

# 13. Creative QA behavior

Creative QA does not silently publish or approve.

It produces:

```text
PASS
PASS_WITH_WARNINGS
FAIL
```

`FAIL`
- stops before human review if a configured hard rule is violated.

`PASS_WITH_WARNINGS`
- may proceed to `READY_FOR_REVIEW`;
- warnings are visible to human reviewer.

The human may approve despite non-critical warnings.

---

# 14. Approval workflow

V1 human gates:

1. ConceptVersion approval.
2. Render approval.

No mandatory intermediate script approval.

Approval is append-only.

If a later version is generated:
- prior approval remains historical;
- it does not automatically approve the new version.

---

# 15. Publication lifecycle

Confirmed/refined:

```text
DRAFT
SCHEDULED
PUBLISHING
PUBLISHING_UNKNOWN
PUBLISHED
FAILED
CANCELLED
```

### Creation

Publication may be created only from an APPROVED Render.

Initial:

```text
DRAFT
```

### Scheduling

```text
DRAFT → SCHEDULED
```

Requires:

- platform account ACTIVE;
- metadata valid;
- scheduledAt present;
- approved render asset present.

### Publish

```text
SCHEDULED → PUBLISHING
```

Worker outcomes:

```text
success → PUBLISHED

known transient failure:
  PUBLISHING → SCHEDULED or remains retryable via attempts

known permanent failure:
  PUBLISHING → FAILED

ambiguous side effect:
  PUBLISHING → PUBLISHING_UNKNOWN
```

### Unknown reconciliation

`PUBLISHING_UNKNOWN` means:
- do not blindly retry upload;
- query/reconcile remote state.

Possible outcomes:

```text
remote post found → PUBLISHED
confirmed absent  → SCHEDULED / retry eligible
cannot determine  → manual attention
```

### Cancellation

```text
DRAFT/SCHEDULED → CANCELLED
```

A published remote post is not "cancelled" in V1. Deletion/unpublishing is a separate future workflow.

---

# 16. PlatformAccount lifecycle

Confirmed:

```text
ACTIVE
REAUTH_REQUIRED
DISABLED
ERROR
```

Rules:

- only ACTIVE accounts accept new scheduling;
- token refresh failure may lead to REAUTH_REQUIRED;
- platform/account outage does not automatically disable the account permanently.

---

# 17. Analytics measurement lifecycle

No lifecycle status is required on each metric row.

Analytics is driven by Publication state and collection windows.

Only `PUBLISHED` publications are eligible.

Suggested V1 windows:

```text
initial
+1h
+6h
+24h
+72h
+7d
```

Exact timing may later be platform-specific configuration.

Each collection appends:

```text
MetricSnapshotRaw
MetricSnapshotNormalized
```

Never overwrite prior snapshots.

---

# 18. Analysis eligibility

A publication/campaign may become analysis-eligible when:

- minimum measurement window reached;
- enough comparable content exists;
- metrics required for the analysis are available.

The Analyst can still produce `INSUFFICIENT_DATA`.

No forced conclusion.

---

# 19. Weekly analysis workflow

```text
PENDING
 ↓
collect eligible content
 ↓
normalize comparable dimensions
 ↓
Analyst
 ↓
Insight(s)
 ↓
Recommendation(s)
 ↓
SUCCEEDED
```

The weekly report is a presentation of durable Insight and Recommendation entities, not the only place analysis lives.

---

# 20. WorkflowRun lifecycle

Confirmed:

```text
PENDING
RUNNING
WAITING
SUCCEEDED
FAILED
CANCELLED
```

`WAITING` is important.

Examples:

- waiting for human concept approval;
- waiting for recording;
- waiting for final video approval;
- waiting for scheduledAt;
- waiting for measurement window.

A workflow can remain WAITING without occupying a worker.

---

# 21. JobAttempt lifecycle

Confirmed:

```text
QUEUED
RUNNING
SUCCEEDED
FAILED
CANCELLED
```

JobAttempt is operational only.

It never replaces domain status.

---

# 22. Outbox lifecycle

Confirmed:

```text
PENDING
DISPATCHING
DISPATCHED
FAILED
```

Policy:

- `FAILED` means dispatcher exhausted its configured automatic attempts;
- control process exposes it as operational attention;
- business aggregate remains recoverable.

---

# 23. AI invocation lifecycle

Confirmed:

```text
RUNNING
SUCCEEDED
FAILED
REJECTED_SCHEMA
```

AI schema failure:
- does not advance business workflow;
- may retry under bounded policy;
- repeated schema failure becomes workflow attention/failure.

---

# 24. End-to-end happy path

```text
Campaign ACTIVE
 ↓
Brief DRAFT
 ↓
Brief READY
 ↓
BriefVersion snapshot
 ↓
Brief GENERATING
 ↓
Ideas ACTIVE
 ↓
Concept DRAFT
 ↓
Concept AWAITING_REVIEW
 ↓ HUMAN
Concept APPROVED
 ↓
Script READY
 ↓
CreativePlan READY
 ├─ RecordingRequest(s)
 ├─ CaptureRun(s)
 └─ Assets
 ↓
CreativePlan READY_FOR_EDITING
 ↓
EditingPlan READY
 ↓
Render REQUESTED
 ↓
Render QUEUED
 ↓
Render RENDERING
 ↓
TECHNICAL_QA
 ↓
CREATIVE_QA
 ↓
READY_FOR_REVIEW
 ↓ HUMAN
APPROVED
 ↓
Publication DRAFT
 ↓
Publication SCHEDULED
 ↓
PUBLISHING
 ↓
PUBLISHED
 ↓
Metric snapshots
 ↓
Insight
 ↓
Recommendation
```

---

# 25. Human interaction boundaries

V1 requires human action only at these default gates:

### Gate A — concept review

Can:
- approve;
- reject;
- ask for regeneration/new ConceptVersion.

### Gate B — recording

Only when CreativePlan requires human media.

### Gate C — final video review

Can:
- approve;
- reject with structured reasons;
- request regeneration.

Everything after approved final video is automatic by default.

---

# 26. Future trusted auto mode

V1 architecture must support but not activate autonomous publishing by default.

Future policy can permit:

```text
Render READY_FOR_REVIEW
 ↓ automated trust policy
Render APPROVED by SYSTEM
 ↓
Publication scheduling/publishing
```

Only for explicitly trusted content categories.

This does not remove the Approval entity; actorType becomes SYSTEM.

---

# 27. Regeneration rules

## Concept regeneration

Creates new ConceptVersion or new Concept depending on intent:

- same underlying concept, rewritten angle/hook → new ConceptVersion;
- materially different content idea → new Concept.

## Script regeneration

New ScriptVersion.

## Creative plan regeneration

New CreativePlanVersion.

## Editing change

New EditingPlanVersion.

## Render retry

If exact inputs unchanged and failure is technical:
- new RenderAttempt.

If creative/input changes:
- new Render.

This distinction is mandatory.

---

# 28. Failure taxonomy

Business/worker failures use stable failure codes.

Categories:

```text
VALIDATION
DEPENDENCY
TRANSIENT_NETWORK
RATE_LIMIT
AUTH
ASSET_MISSING
CAPTURE_ASSERTION
RENDER_TECHNICAL
AI_SCHEMA
PLATFORM_REJECTION
UNKNOWN_SIDE_EFFECT
INTERNAL
```

Human-readable messages are separate from stable machine codes.

---

# 29. Needs-attention concept

Do not add `NEEDS_ATTENTION` indiscriminately to every entity enum.

Operational attention should generally be derived from:

- failed latest attempt;
- outbox FAILED;
- account REAUTH_REQUIRED;
- publication PUBLISHING_UNKNOWN;
- blocked workflow with unsatisfied dependency.

The dashboard may expose a unified "Needs Attention" view without forcing a universal domain status.

---

# 30. Workflow concurrency rules

### Concept generation

Multiple concepts may generate concurrently for one BriefVersion.

### Capture

Independent capture scenarios may run concurrently unless they share a constrained demo account/session.

### Render

Multiple renders may run concurrently subject to worker capacity.

### Publication

Concurrency is limited per platform/account by rate-limit policy.

### Analytics

Collections may run concurrently across publications.

---

# 31. Optimistic concurrency

Human/API mutations of mutable roots should use:

- `updatedAt`/version checks; or
- transaction conditions

to prevent overwriting concurrent changes.

Immutable version rows avoid most edit conflicts.

---

# 32. Recovery after process crash

The control process periodically detects:

- business objects in active states without live/recent attempts;
- pending outbox rows;
- due scheduled publications;
- stale RUNNING attempts beyond timeout.

Recovery never assumes that a remote side effect did not happen.

Publication uncertainty goes through reconciliation.

---

# 33. Lifecycle enums owned by this spec

After acceptance, the Prisma draft may replace placeholder strings with:

```text
BriefStatus
IdeaStatus
ScriptStatus
CreativePlanStatus
EditingPlanStatus
```

as defined here.

The following existing enums are also confirmed:

```text
ConceptStatus
RecordingRequestStatus
RecordingStatus
CaptureRunStatus
RenderStatus
PlatformAccountStatus
PublicationStatus
WorkflowStatus
JobAttemptStatus
OutboxStatus
ModelInvocationStatus
```

---

# 34. Acceptance criteria

The workflow spec can move to ACCEPTED when:

- [x] Brief lifecycle accepted.
- [x] Idea lifecycle accepted.
- [x] Concept lifecycle accepted.
- [x] Script lifecycle accepted.
- [x] CreativePlan lifecycle accepted.
- [x] RecordingRequest/Recording lifecycle accepted.
- [x] CaptureRun lifecycle accepted.
- [x] EditingPlan lifecycle accepted.
- [x] Render/RenderAttempt behavior accepted.
- [x] Creative QA behavior accepted.
- [x] Human approval gates accepted.
- [x] Publication/PUBLISHING_UNKNOWN reconciliation accepted.
- [x] Analytics collection lifecycle accepted.
- [x] Weekly analysis workflow accepted.
- [x] WorkflowRun WAITING semantics accepted.
- [x] Regeneration vs retry distinction accepted.
- [x] Failure taxonomy accepted.
- [x] Recovery behavior accepted.
- [x] Lifecycle enum ownership accepted.

After acceptance:

1. mark `04_WORKFLOWS.md` ACCEPTED;
2. update Decisions/Status/Checklist;
3. revise and freeze final Prisma schema draft;
4. then begin `05_AI_CONTRACTS.md`.
