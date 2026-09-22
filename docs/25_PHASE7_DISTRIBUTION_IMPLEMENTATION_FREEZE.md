# 25 — Phase 7 Distribution Implementation Freeze

**Status:** IMPLEMENTATION FREEZE — PHASE 7 AUTHORIZED SEQUENTIALLY
**Baseline HEAD:** `aa906bab2ae969244e6e9100244dbcc8d2a37554`
**Branch:** `phase/7-distribution`
**Frozen V1 specification:** `spec-v1.0.4` + accepted Distribution/Operations ADRs
**Date:** 2026-09-22

---

# 1. Purpose

Phase 7 implements Distribution without weakening the guarantees already proven through Phase 6.

Canonical flow remains:

```text
Render APPROVED
→ Publication DRAFT
→ Publication SCHEDULED
→ due-time control dispatch
→ API_AUTOMATED: PUBLISHING → PUBLISHED | FAILED | PUBLISHING_UNKNOWN
→ MANUAL_HANDOFF: READY_FOR_MANUAL_PUBLISH → PUBLISHED | CANCELLED
```

PostgreSQL is authoritative. Redis/BullMQ is delivery infrastructure, not business truth.

---

# 2. Inspection result at the Phase 7 baseline

The baseline already contains the canonical data model required by Distribution:

- `PlatformAccount`;
- `Publication`;
- `PublicationAttempt`;
- `AssetDerivation`;
- `OutboxEvent`;
- exact `Publication.mediaAssetId` lineage;
- `Publication.operationId` and `trackingCode`;
- durable outbox claims/fencing;
- kill switch `PAUSE_ALL_PUBLISHING`;
- global live-provider gate `VCE_REAL_PROVIDERS_ENABLED=false` by default.

`Persistence.createPublication()` already creates a **DRAFT only**, validates approved Render + exact/derived media lineage, and emits the transactional outbox.

The following are still scaffolds at this baseline:

```text
apps/control
apps/worker-publish
packages/publishing
```

No Prisma migration is expected for Phase 7 based on the inspected baseline.

A Phase 7 migration is a STOP CONDITION unless an accepted invariant is proven impossible with the current schema.

---

# 3. Provider-policy recheck — 2026-09-22

The accepted provider strategy remains valid at implementation start:

- TikTok Direct Post remains unsuitable for this private/internal tool; V1 remains `MANUAL_HANDOFF`.
- Instagram Professional account Reels publishing remains compatible with container creation → bounded processing poll → `media_publish`.
- YouTube remains `videos.insert`/resumable-capable and public automation remains audit/capability-gated.

This is an activation-time recheck, not a new product decision.

Real provider policy/capability must be checked again before live enablement in Phase 11.

---

# 4. Non-negotiable Distribution invariants

## 4.1 Exact media

Every Publication that can leave `DRAFT` has an exact `mediaAssetId`.

Allowed media identity:

```text
Render.approvedAssetId
OR
explicit PLATFORM_DERIVATIVE whose source is Render.approvedAssetId
```

No worker or provider adapter may select another Asset.

## 4.2 Human gate

Only a human-approved Render may produce a Publication.

Phase 7 does not introduce automated Render approval.

## 4.3 Scheduling authority

Canonical due time is:

```text
Publication.scheduledAt
```

The `control` process owns due-time discovery and dispatch.

Workers never own scheduling.

## 4.4 Transactional dispatch

A business transition that requests asynchronous publish/reconcile work and its `OutboxEvent` are committed in the same PostgreSQL transaction.

No canonical code path may use:

```text
database commit
→ queue.add()
```

without the outbox boundary.

## 4.5 Duplicate safety

`Publication.operationId` is stable across attempts.

`PublicationAttempt` is append-only per execution attempt.

A lost provider response after a possibly successful remote side effect must produce:

```text
PUBLISHING_UNKNOWN
```

not a blind retry.

## 4.6 Secrets

Jobs may carry:

```text
publicationId
publicationAttemptId
operationId
```

and other non-secret identifiers.

Jobs must never carry OAuth/access/refresh tokens or raw `credentialsRef` resolution values.

Adapters resolve secrets only at the adapter/secret-resolver boundary.

## 4.7 Kill switch / local safety

`PAUSE_ALL_PUBLISHING=true` blocks new publish side effects.

`VCE_REAL_PROVIDERS_ENABLED=false` means real provider adapters cannot perform remote publish calls.

Tests use fake providers by default.

No Phase 7 test may publish real social content.

---

# 5. Publication state rules

Two explicit state machines are used; do not infer a transition from platform name.

## 5.1 API_AUTOMATED

```text
DRAFT → SCHEDULED → PUBLISHING → PUBLISHED
                         ├──────→ FAILED
                         └──────→ PUBLISHING_UNKNOWN

PUBLISHING_UNKNOWN → PUBLISHED
                   → FAILED
                   → PUBLISHING   only after reconciliation proves retry eligibility

DRAFT → CANCELLED
SCHEDULED → CANCELLED
```

## 5.2 MANUAL_HANDOFF

```text
DRAFT → SCHEDULED → READY_FOR_MANUAL_PUBLISH → PUBLISHED
                    └────────────────────────→ CANCELLED

DRAFT → CANCELLED
SCHEDULED → CANCELLED
```

No fake `PublicationAttempt` is created for the operator's native TikTok action.

---

# 6. Leaving DRAFT

A Publication may become `SCHEDULED` only when all are proven:

```text
Render still APPROVED
mediaAssetId exact and READY
PlatformAccount ACTIVE
metadata schema valid for platform/mode
deliveryMode explicit and allowed
scheduledAt is a valid instant
required capability gate is satisfied for the requested mode
```

For automated providers, missing credentials/capabilities fail closed.

TikTok internal V1 must reject `API_AUTOMATED`.

---

# 7. Due-work control transaction

Phase 7A implements a PostgreSQL-owned due transition.

Conceptual transaction:

```text
SELECT due Publication
FOR UPDATE SKIP LOCKED

verify status = SCHEDULED
verify scheduledAt <= database clock
verify account/capability still valid
verify PAUSE_ALL_PUBLISHING is false
```

Then:

### MANUAL_HANDOFF

```text
SCHEDULED → READY_FOR_MANUAL_PUBLISH
AuditEvent
transactional OutboxEvent for projection/notification work only
```

No remote provider job is created.

### API_AUTOMATED

Atomically:

```text
SCHEDULED → PUBLISHING
create PublicationAttempt(status=QUEUED, next attemptNumber)
AuditEvent
OutboxEvent Publication.publish.requested
```

The attempt ID emitted by the transaction is the exact attempt executed by the worker.

A duplicate scheduler scan must not create a second active attempt.

---

# 8. BullMQ / outbox boundary

BullMQ is introduced as the async transport in Phase 7A.

The outbox dispatcher:

```text
claim OutboxEvent using existing durable claim/fencing
→ enqueue BullMQ job using OutboxEvent.id as stable deduplication identity
→ mark OutboxEvent DISPATCHED only after enqueue acknowledgement
```

Queue delivery may be duplicated.

Workers must therefore be idempotent against canonical PostgreSQL state.

Rotating outbox `claimToken` is never a transport idempotency key.

---

# 9. Publisher contract

`@vision/publishing` owns deterministic contracts and provider-independent orchestration types.

Conceptual interface remains:

```ts
interface PlatformPublisher {
  prepare(publication: PublicationSnapshot): Promise<PublishPreparation>;
  publish(
    publication: PublicationSnapshot,
    preparation: PublishPreparation,
  ): Promise<PublishResult>;
  reconcile(publication: PublicationSnapshot): Promise<ReconcileResult>;
}
```

Adapter responsibilities:

```text
auth semantics
metadata mapping
media transfer strategy
remote request identifiers
response/error classification
reconciliation
```

Adapter does **not** own:

```text
canonical scheduling
render/media selection
business state machine
analytics normalization
content strategy
```

---

# 10. Phase 7A — Runtime Foundation

Phase 7A implements only provider-independent runtime foundations:

1. runtime Distribution metadata schemas derived from the frozen artifacts;
2. publication transition guards;
3. schedule/cancel persistence operations;
4. due Publication claiming/transition through `control`;
5. `PublicationAttempt` creation/fencing for automated delivery;
6. transactional publish/reconcile outbox events;
7. BullMQ dispatcher transport boundary;
8. `worker-publish` orchestration against the publisher interface;
9. deterministic fake publisher;
10. retry classification primitives;
11. `PUBLISHING_UNKNOWN` fail-closed handling;
12. `PAUSE_ALL_PUBLISHING` enforcement;
13. tests proving no duplicate publication dispatch.

Phase 7A performs **zero real Meta/Google/TikTok publish calls**.

---

# 11. Later Phase 7 tranches

## 7B — TikTok manual handoff

```text
ready package
private media download/open
copyable metadata
scheduled target time
commercial-content reminder
manual completion
optional remote URL
```

No TikTok Direct Post API.

## 7C — Instagram adapter

Implement:

```text
Professional-account capability check
short-lived exact-asset delivery lease
REELS container creation
bounded FINISHED polling
media_publish
remote media ID
ambiguity/reconciliation
```

Live execution remains feature-gated and disabled by default.

## 7D — YouTube adapter

Implement:

```text
OAuth2 secret-reference boundary
resumable videos.insert
resume/reconcile
processing state
remote video ID
YOUTUBE_PUBLIC_UPLOAD_READY gate
```

Private/test upload capability precedes public production enablement.

## 7E — Account health + reconciliation + operator actions

Implement:

```text
capability refresh
REAUTH_REQUIRED
PUBLISHING_UNKNOWN reconciliation
safe reschedule/cancel
manual handoff completion
Needs Attention integration
```

## 7F — Phase closure

Implement:

```text
check:phase7
Distribution report
full browser/API/PostgreSQL/fake-provider regression
activation checklist for Phase 11
```

Phase 8 Analytics does not start automatically.

---

# 12. Live-provider activation boundary

Implementation and deterministic fake-provider tests are Phase 7.

Real production publishing is progressively enabled only under the accepted Phase 11 rollout.

Minimum live activation gates:

```text
explicit operator configuration
PAUSE_ALL_PUBLISHING=false
VCE_REAL_PROVIDERS_ENABLED=true
specific provider feature flag/capability true
account ACTIVE
credentials resolvable where required
preflight valid
```

Missing any gate fails closed.

---

# 13. Retry semantics

Automatic retry is allowed only when the adapter classifies the prior outcome as provably safe:

```text
TRANSIENT_FAILURE
RATE_LIMITED
```

and no ambiguous remote side effect exists.

`UNKNOWN_SIDE_EFFECT` always produces `PUBLISHING_UNKNOWN`.

No generic dashboard Retry action may bypass reconciliation.

Attempt/backoff count is bounded configuration.

---

# 14. Reconciliation

A reconciliation run may conclude:

```text
PUBLISHED
FAILED
still PUBLISHING_UNKNOWN
retry-eligible absence → PUBLISHING with a new PublicationAttempt
```

Reconciliation may use only documented provider evidence such as known remote IDs/session IDs/status endpoints.

It may not infer remote absence from worker lease expiry, process crash or timeout alone.

---

# 15. Technical preflight

Immediately before remote delivery the worker revalidates:

```text
Publication status/attempt ownership
exact Asset READY + not deleted
expected size/checksum present
private object exists
metadata schema
account ACTIVE
capability gate
media compatibility required by adapter
kill switch / live-provider gate
```

This is technical validation, not a third creative/human gate.

---

# 16. Dashboard boundary during Phase 7

Phase 6 Dashboard remains a control room over canonical state.

Phase 7 may add guarded operations for:

```text
schedule/reschedule
cancel while safe
manual TikTok completion
reconcile PUBLISHING_UNKNOWN
provider/account reconnect entry point when actually supported
```

React never performs provider calls directly and never owns publication lifecycle state.

---

# 17. No Prisma migration expected

The inspected canonical schema already contains all required V1 Distribution persistence.

Phase 7 code must first reuse it.

STOP before any migration if implementation appears to require:

```text
new Publication state
new delivery mode
new attempt response class
new provider-secret field
new scheduling aggregate
```

Such a requirement would contradict or amend the frozen model and needs explicit review.

---

# 18. Test gates

Release-blocking Phase 7 tests include:

```text
due publication dispatched exactly once
future publication not dispatched
cancelled publication not dispatched
kill switch blocks dispatch
manual handoff creates no fake API attempt
provider accepts + response lost → PUBLISHING_UNKNOWN
no second publish call while UNKNOWN
reconcile remote found → PUBLISHED
reconcile confirmed absent → retry eligible
account REAUTH_REQUIRED fails closed
metadata schemas reject invalid provider fields
exact media lineage preserved
jobs/logs contain no credentials
outbox duplicate delivery is harmless
DST/UTC scheduling remains canonical
```

Fake providers are mandatory for normal test suites.

---

# 19. STOP conditions

Stop rather than inventing behavior if:

- provider policy/capability changed materially;
- a real credential must be committed/exposed;
- a live remote side effect becomes ambiguous during development;
- schema migration appears necessary;
- an accepted state transition cannot be represented;
- exact media lineage cannot be proven;
- a duplicate publish cannot be ruled out;
- tests would need real public posting to pass.

---

# 20. Git checkpoints

Expected sequence:

```text
Phase 7 freeze
→ 7A runtime foundation
→ 7B TikTok manual handoff
→ 7C Instagram adapter
→ 7D YouTube adapter
→ 7E health/reconciliation/operator controls
→ 7F closure
```

No push or tag without explicit user request.
