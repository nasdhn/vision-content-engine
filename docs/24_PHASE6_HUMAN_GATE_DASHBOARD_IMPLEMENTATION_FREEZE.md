# Phase 6 — Human-gate Dashboard Implementation Freeze

**Status:** ACCEPTED FOR IMPLEMENTATION
**Date:** 2026-09-21
**Branch:** `phase/6-human-gate-dashboard`
**Baseline HEAD:** `3b3209693fbbf18f5db807639f6877114f8b045c`
**Nature:** implementation freeze only; no change to frozen product/domain specification

## 1. Purpose

Phase 6 turns the existing canonical workflow state into the internal human control surface.

The dashboard is not a second workflow engine. React never owns lifecycle truth and must not
reimplement domain transitions already enforced by the application/database layers.

The user remains:

```text
creative director
+ final reviewer
+ operator of exceptions
```

The two mandatory human gates are exactly:

```text
ConceptVersion review
Final Render review
```

Recording input is conditional human input, not an additional approval gate.

## 2. Audit of the Phase 5 baseline

The implementation baseline already provides:

- secure local single-user session/cookie + CSRF behavior for the Recording Pack;
- private Recording Pack upload/preview/selection;
- exact ConceptVersion approval persistence through `Approval`;
- stale-version protection for normal concept decisions;
- explicit exact-version selection primitives for exceptional concept review;
- Render `READY_FOR_REVIEW → APPROVED | REJECTED` transitions;
- exact successful output-asset validation before Render approval;
- Technical QA and evidence-bound Creative QA persisted on RenderAttempt;
- AuditEvent lineage;
- canonical workflow/job/outbox state;
- `EditingBlocker` OPEN/RESOLVED/SUPERSEDED persistence.

No new database entity is required for Phase 6.

Observed gaps that Phase 6 must close:

1. the web app is currently a Recording Pack page, not a dashboard shell;
2. the API session implementation is owned by RecordingController and must be shared safely
   before adding dashboard controllers;
3. no dashboard read-model/application service exists;
4. no Concept review API/UI exists;
5. no final Render review API/UI exists;
6. current private preview is restricted to Recording assets and cannot expose Render outputs;
7. Render rejection currently does not persist dashboard rejection reason/comment;
8. Needs Attention has no derived read model yet;
9. deep-link routing does not exist yet.

## 3. Frozen runtime boundary

### Frontend owns

- presentation;
- navigation;
- filters;
- local player state;
- loading/error/empty states;
- keyboard shortcuts;
- confirmation affordances;
- non-authoritative optimistic detail such as button busy state.

### Frontend does not own

- lifecycle transitions;
- approval truth;
- current canonical status;
- retry safety;
- publication side effects;
- rendering;
- Creative QA;
- Technical QA;
- asset authorization;
- workflow/job/outbox mutation.

All meaningful writes go through authenticated backend application methods.

## 4. Authentication boundary

V1 remains internal and single-user.

Phase 6 reuses the existing secure local access model:

```text
__Host-vce HttpOnly Secure SameSite=Strict cookie
+ same-origin validation
+ CSRF token for writes
+ login rate limiting
```

Before multiple controllers are introduced, session state and CSRF/origin checks must move from
RecordingController-private state into one shared API auth/session service.

No second authentication mechanism is introduced in Phase 6.

## 5. Primary routes

The Phase 6 shell supports stable routes:

```text
/
 /attention
 /concepts
 /concepts/:conceptVersionId
 /production
 /production/:creativePlanVersionId
 /review
 /review/:renderId
 /calendar
 /published
 /assets
 /assets/:assetId
 /patterns
 /templates
 /settings
 /analytics
```

`/analytics` exists as a stable navigation destination but Phase 8 owns real analytics ingestion
and analysis. Phase 6 must not fabricate analytics data.

Refresh/deep-link behavior must preserve the intended route and object context.

## 6. Dashboard home

Home answers only:

```text
What needs my attention?
What is being produced?
What is ready for concept review?
What is ready for final review?
What has recently changed?
```

No vanity-metric headline is required.

Cards link to canonical detail routes.

## 7. Needs Attention derivation

Needs Attention is computed at read time. No `NEEDS_ATTENTION` database enum/table is added.

Phase 6 sources that may be surfaced when present:

```text
EditingBlocker.status = OPEN
RecordingRequest requiring human input/selection
Render.status = FAILED
CaptureRun.status = FAILED
WorkflowRun.status = FAILED
OutboxEvent.status = FAILED
PlatformAccount.status = REAUTH_REQUIRED | ERROR
Publication.status = PUBLISHING_UNKNOWN | FAILED
```

A row contains:

```text
kind
severity
title
reason
affectedEntity
createdAt
recommendedAction
targetRoute
```

Phase 6 exposes no generic retry button. A retry/reconcile action is shown only when an already
implemented backend operation can prove that action safe.

## 8. Concept review contract

Default queue:

```text
Concept.status = AWAITING_REVIEW
```

The card/detail uses one exact ConceptVersion and shows:

```text
title
hook
angle
pattern
format recommendation when available
target duration when available
hypothesis
rationale
brief/campaign context when available
createdAt/version
```

Primary writes:

```text
APPROVE
REJECT
```

Concept rejection reason codes offered by UI:

```text
HOOK_WEAK
ANGLE_TOO_GENERIC
TOO_AD_LIKE
TOO_REPETITIVE
NOT_TRUE_TO_VISION
WRONG_AUDIENCE
OTHER
```

A reason is optional for Concept rejection. Free-text comment is optional.

Normal decision path uses the exact version shown and must fail closed on a stale latest version.
The exceptional explicit-version selection protocol already present in Persistence remains
available for future UI but is not required for the default queue.

Concept approval remains a decision on the shown ConceptVersion, never on an abstract Concept.

## 9. Production contract

Production is a read model across canonical states, not a queue dashboard.

User-facing stages:

```text
Waiting for me
Capturing
Editing
Rendering
Failed
Done
```

Production detail can show:

```text
concept/hook
script summary
creative-plan version
Recording Pack
capture status
editing/blocker status
render status
next expected action
diagnostics in an expandable section
```

The current Recording Pack behavior is preserved and integrated instead of rewritten.

## 10. Final Render review contract

Queue:

```text
Render.status = READY_FOR_REVIEW
```

Default ordering:

```text
oldest ready first
```

Review detail shows:

```text
large vertical private video player
hook
concept summary
script
CTA
target-platform intent when present
Creative QA result
Creative QA summary
timestamped QA issues/warnings
technical status summary
version/lineage summary
```

Primary writes:

```text
APPROVE
REJECT
```

Approval must resolve the exact successful READY output Asset server-side and then pass that exact
asset ID into the existing guarded Render decision.

Render rejection reason choices:

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
SCRIPT_VISUAL_MISMATCH
OTHER
```

The dashboard requires one structured reason when the user rejects a Render. A free-text comment is
optional.

Persistence may remain backwards-compatible for non-dashboard callers, but dashboard writes persist
`Approval.reasonCode` and optional `Approval.comment`.

No approval/rejection state is displayed optimistically before canonical confirmation.

## 11. Render media authorization

The browser never receives bucket/object keys.

Render review media is served through a render-scoped authenticated endpoint. The server resolves
the eligible output asset from Render/RenderAttempt lineage.

Eligible review media must satisfy all of:

```text
Render status is READY_FOR_REVIEW, APPROVED or REJECTED
RenderAttempt.status = SUCCEEDED
RenderAttempt.outputAssetId matches the resolved Asset
Asset.status = READY
Asset.deletedAt IS NULL
checksum/size are present
private storage bytes validate against canonical metadata
```

For APPROVED renders, `Render.approvedAssetId` is authoritative.

The endpoint must not accept an arbitrary storage URL/path supplied by the client.

## 12. Creative QA presentation

Creative QA remains advisory to the human gate.

```text
PASS
PASS_WITH_WARNINGS
FAIL
```

Only `READY_FOR_REVIEW` renders enter the normal final-review queue, therefore a currently blocked
Creative QA `FAIL` does not masquerade as review-ready.

Timestamped issues may seek the video player to the issue time.

Technical QA facts remain separate from subjective Creative QA.

## 13. Calendar / Published boundary

Phase 6 may read existing Publication rows and present honest empty/read-only states.

Phase 6 does not implement:

```text
publication scheduler
remote upload
platform adapter
reconciliation
manual TikTok handoff
publication retry
```

Those are Phase 7.

No scheduling mutation is added early merely to make the screen appear complete.

## 14. Analytics boundary

The `/analytics` navigation contract is preserved, but Phase 8 owns:

```text
raw metric ingestion
normalization
attribution
analytics comparisons
analytics UI backed by real evidence
```

Phase 6 may show an explicit unavailable/not-yet-active state. It must never synthesize performance
data.

## 15. Assets / Patterns / Templates / Settings boundary

These are operational read surfaces in Phase 6.

Allowed:

```text
list/detail
status
version
lineage/usage where already queryable
technical metadata
masked/reference-only configuration state
```

Not introduced in Phase 6:

```text
raw JSON editors
secret display
template mutation engine
pattern performance leaderboard
destructive historical asset deletion
```

## 16. API shape

Phase 6 uses one shared authenticated session boundary.

Planned read endpoints:

```text
GET /api/dashboard
GET /api/attention
GET /api/concepts/review
GET /api/concepts/:conceptVersionId
GET /api/production
GET /api/production/:creativePlanVersionId
GET /api/review
GET /api/review/:renderId
GET /api/review/:renderId/media
GET /api/calendar
GET /api/published
GET /api/assets
GET /api/assets/:assetId
GET /api/patterns
GET /api/templates
GET /api/settings/summary
```

Planned Phase 6 writes:

```text
POST /api/concepts/:conceptVersionId/decision
POST /api/review/:renderId/decision
existing Recording Pack upload/selection writes
```

Publication/analytics writes are not Phase 6 API surface.

## 17. Error/stale-state behavior

Business conflicts are explicit and safe.

Examples:

```text
STALE_VERSION
INVALID_TRANSITION
RENDER_OUTPUT_MISMATCH
HUMAN_APPROVAL_REQUIRED
ASSET_NOT_AVAILABLE
```

The UI responds by refreshing canonical state and explaining the conflict. It does not silently
retry a user decision against a different version.

Raw SQL/storage/provider/internal error strings remain hidden.

## 18. Accessibility / responsive minimum

Desktop is primary.

Mobile/tablet must support:

```text
login
Needs Attention
Concept approve/reject
Recording instructions/upload/selection
Final video review
Render approve/reject
```

Requirements:

```text
semantic controls
visible focus
keyboard reachability
non-color-only states
video captions control when available
no horizontal overflow for mandatory mobile tasks
```

Desktop review shortcuts may be added only with focus/confirmation safeguards.

## 19. Phase 6 implementation tranches

### 6A — Shared session + Dashboard read model + shell

- extract shared local session/auth boundary;
- preserve all Recording Pack security tests;
- add dashboard/attention application read model;
- add API controllers for read endpoints;
- add shell/navigation/route handling;
- add Dashboard + Needs Attention screens.

### 6B — Concept gate

- Concept review queue/detail;
- exact-version decision endpoint;
- approval/rejection persistence;
- structured optional rejection reason;
- stale-state browser/integration/Postgres tests;
- batch actions only after single-item semantics are proven.

### 6C — Production + Recording Pack integration

- Production list/detail;
- move existing Recording Pack UX into the shell without regression;
- blockers/capture/render state;
- human-input status;
- existing upload/private preview/selection preserved.

### 6D — Final Render gate

- review queue/detail;
- secure render-scoped media preview;
- Creative QA display and timestamp seek;
- exact output-asset approval;
- structured rejection reason + note;
- no optimistic canonical decision;
- desktop + mobile browser tests.

### 6E — Supporting read surfaces + closure

- Calendar/Published read-only current-state views;
- Assets/Patterns/Templates/Settings read surfaces;
- Analytics explicit deferred state;
- deep-link refresh coverage;
- accessibility/responsive regression;
- Phase 6 aggregate check;
- Phase 6 report.

## 20. Expected schema impact

Expected:

```text
no Prisma migration
```

The existing `Approval.reasonCode`, `Approval.comment`, status enums, AuditEvent and lineage fields are
sufficient.

A migration is a STOP condition unless a demonstrated invariant cannot be represented safely with
the existing model.

## 21. Acceptance

Phase 6 is closed only when all are true:

- both human gates are executable in the dashboard;
- approval always targets exact canonical version/render media;
- stale state fails closed;
- render bytes remain private and lineage-authorized;
- Recording Pack behavior has not regressed;
- Needs Attention is derived, not persisted as a fake workflow state;
- no Phase 7 publication side effect exists;
- no Phase 8 analytics evidence is invented;
- deep links survive refresh;
- required mobile review/upload paths work;
- static/unit/contract/Postgres/storage/web/browser suites are green;
- a canonical `check:phase6` command exists;
- Phase 6 report records known limitations and next-phase boundary.

## 22. Stop conditions

Stop instead of inventing behavior when:

- a human action would need a domain transition not already accepted;
- a Render media request cannot prove exact lineage;
- a dashboard write would create a publication/platform side effect;
- a stale decision cannot be rejected deterministically;
- a new mandatory human gate appears necessary;
- implementation would require exposing storage paths, secrets or raw internal errors;
- a Prisma migration appears necessary without an already accepted domain requirement.
