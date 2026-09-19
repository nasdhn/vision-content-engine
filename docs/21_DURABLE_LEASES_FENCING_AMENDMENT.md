# 21 — Durable Leases and Fencing Amendment

**Status:** ACCEPTED AND VALIDATED — current canonical baseline; uncommitted review tranche.

**Specification:** `spec-v1.0.2`

**Amends:** `spec-v1.0.1`, durable job leases and outbox claims only.

**Decision date:** 2026-09-19

**Implementation authorization:** specification amendment only; Phase 1 remains blocked.

## 1. Gap discovered before Phase 1

The operations specification requires recoverable execution ownership, heartbeats, expiry
and abandoned outbox recovery. The test strategy requires heartbeat/death/expiry cases;
the restore runbook requires recovery from canonical PostgreSQL state.

The frozen JobAttempt and OutboxEvent models had no explicit durable renewal, expiry or
ownership-token fields. Reusing startedAt, availableAt or business JSON would introduce
hidden semantics. No migration or Phase 1 implementation was started.

Session locks alone are not the V1 contract: they can coordinate concurrent processes, but
do not provide the persisted heartbeat, expiry and last-ownership metadata selected here.
Transactional locking remains necessary to claim safely; it complements durable leases.

## 2. Common contract

PostgreSQL is authoritative for ownership, expiry and recovery. Redis loss must not erase
this evidence. No lease state is hidden in startedAt, availableAt, payloadJson or logs.

Each acquisition or recovery generates a **new UUID ownership token**. A token is opaque,
not a monotonic number: fencing is enforced by conditional updates comparing the supplied
token with the currently persisted token, together with the required state/expiry predicates.
An older token cannot authorize a later owner's completion or failure.

All lease comparisons and assigned timestamps use PostgreSQL's current clock. Date.now()
or a worker clock is not authoritative. Ownership decisions must use fresh database time
at the guarded write, including after lock waits; a timestamp frozen at the beginning of a
long transaction is not proof that ownership is still valid. Lease duration and heartbeat
interval are typed configuration; this amendment specifies no normative numeric duration.

Database fields remain millisecond UTC instants under amendment 20. A lost lease does not
undo an external effect that has already happened; fencing the database write does not
constitute remote-provider reconciliation.

## 3. JobAttempt contract

The existing `workerId` remains the operational owner identifier. Add only:

```prisma
leaseToken      String?   @db.Uuid
leaseAcquiredAt DateTime? @db.Timestamptz(3)
heartbeatAt     DateTime? @db.Timestamptz(3)
leaseExpiresAt  DateTime? @db.Timestamptz(3)
```

Recovery index: `@@index([status, leaseExpiresAt])`. Existing indexes remain unchanged.

### Claim

A PostgreSQL transaction selects eligible work using safe transactional locking,
`FOR UPDATE SKIP LOCKED` or an equivalent mechanism. It atomically sets RUNNING, workerId,
a fresh leaseToken, leaseAcquiredAt and heartbeatAt from database time, and leaseExpiresAt
from database time plus the configured duration. QUEUED does not require active lease metadata.

### Heartbeat and completion

Heartbeat updates require the same id, RUNNING status, matching leaseToken and an unexpired
lease (`leaseExpiresAt > current database time`). They update heartbeatAt and extend
leaseExpiresAt from database time.

Completion and failure use the same id/state/token/unexpired predicates. A guarded update
affecting zero rows means `STALE_LEASE` / loss of ownership, not success. Equality with the
expiry instant is expired. After expiry, the old worker no longer owns the attempt.

### Recovery

Recovery is allowed only by the job type's recovery policy. An eligible JobAttempt may be
taken over by a new worker with a fresh leaseToken and new acquisition/heartbeat/expiry data.
The old token cannot complete or fail that attempt. Ownership takeover is distinct from
creating a separately numbered technical attempt; no new universal retry policy is introduced.
Terminal attempts are not resurrected. Last-lease metadata may remain on terminal rows for audit.

## 4. OutboxEvent contract

Add only:

```prisma
claimOwner       String?
claimToken       String?   @db.Uuid
claimedAt        DateTime? @db.Timestamptz(3)
claimHeartbeatAt DateTime? @db.Timestamptz(3)
claimExpiresAt   DateTime? @db.Timestamptz(3)
```

Recovery index: `@@index([status, availableAt, claimExpiresAt])`.
The existing availability index remains; availableAt keeps its eligibility meaning.

An eligible PENDING event is claimed transactionally, becomes DISPATCHING and receives the
owner, a fresh claimToken, acquisition/heartbeat timestamps and configured expiry from the
database clock. A long dispatch may renew only with the matching current token, DISPATCHING
state and an unexpired claim.

Finalization to DISPATCHED or FAILED is conditional on the event id, DISPATCHING state and
current claimToken. An expired DISPATCHING claim may be taken over atomically by another
dispatcher with a new token. After takeover, the old dispatcher cannot mark either terminal
outcome with its old token; a zero-row conditional result signals lost ownership.
Last-claim metadata may be retained for audit. Token rotation must not change the event identity.

## 5. Outbox redelivery versus external-effect retry

Transport enqueue can succeed before the database mark DISPATCHED fails. The dispatcher
therefore sends the **stable OutboxEvent.id** as the transport idempotence/deduplication key.
A claimToken changes on takeover and must not replace that stable key. Redelivery of the same
event is expected to be tolerable; this is not a promise of exactly-once transport delivery.

This rule must never be generalized to social publication. An ambiguous Publication effect
still requires `PUBLISHING_UNKNOWN → reconciliation`. Lease expiry never proves that a
remote publish, upload or capture mission launch did not happen. Recovery must preserve the
existing safe-retry versus uncertain-side-effect distinction.

## 6. Exact manual PostgreSQL constraints

The canonical SQL is
`docs/spec-artifacts/final-reconciliation/durable-lease-constraints.sql`.
It defines four CHECK constraints for the future initial migration:

| Constraint                             | Rule                                                                                         |
| -------------------------------------- | -------------------------------------------------------------------------------------------- |
| JobAttempt_running_lease_required      | RUNNING requires workerId, leaseToken and all three lease timestamps.                        |
| JobAttempt_lease_time_order            | When each pair is present: leaseExpiresAt > leaseAcquiredAt; heartbeatAt >= leaseAcquiredAt. |
| OutboxEvent_dispatching_claim_required | DISPATCHING requires claimOwner, claimToken and all three claim timestamps.                  |
| OutboxEvent_claim_time_order           | When each pair is present: claimExpiresAt > claimedAt; claimHeartbeatAt >= claimedAt.        |

Presence is mandatory only in the active state. Explicit NULL guards make the ordering rules
compatible with absent or partial historical terminal metadata, while checking every known pair.
Valid last-lease metadata can remain after completion. No CHECK compares expiry with the current
clock: a row can legitimately remain RUNNING/DISPATCHING after expiry until recovery examines it.

These CHECKs enforce row shape and time ordering, not fencing. Fencing requires the conditional
write predicates above and their future PostgreSQL integration tests.
The three previously required manual constraints (Approval subject, ACTIVE KnowledgeSnapshot
uniqueness, REVENUE completeness) remain mandatory and unchanged.

## 7. Exact schema and preview boundary

The amendment adds nine nullable fields and two non-unique indexes, without changing any
existing field, default, relation, enum, nullability or deletion policy. Both schemas stay
semantically aligned; only Prisma formatting differs.

DateTime totals become **103**: the original 97 plus six nullable lease/claim instants.
All 103 use `@db.Timestamptz(3)`; there are 73 required and 30 nullable timestamps.

The reproducible Prisma preview contains 50 tables, 49 enums, 72 foreign keys and 106 secondary
indexes (35 unique, 71 non-unique). Its only SQL changes are nine added columns and two added
indexes. It has no CHECKs: the four new CHECKs are kept in the separate canonical SQL artifact,
just as the three earlier manual constraints require augmentation of the future migration.
No DROP, new deletion cascade or data conversion is introduced.

Preview SHA-256:

```text
c4aa995cc0e1849ee03c13213994282f6c916e57a58075f778e3540eabdfaf57
```

No application migration is created or applied. PostgreSQL public tables remain zero.

## 8. Validation gates

Use the pinned Node 24.21.0, pnpm 10.34.5 and Prisma 7.10.0:

```text
pnpm install --frozen-lockfile
pnpm prisma:format
pnpm prisma:validate
pnpm prisma:generate
pnpm db:preview
pnpm check
pnpm test
pnpm build:web
git diff --check
```

Static contracts verify historical/current manifests, both schema copies, the nine exact
field definitions, six new native timestamps, recovery indexes and the SQL constraint artifact.
All listed gates passed on 2026-09-19, including 21 tests across six files and the web build.
The CHECK expressions were also reviewed with 30 synthetic PostgreSQL VALUES cases inside a
read-only transaction (15 per model, zero mismatches); no table, ALTER TABLE or migration was executed.
These checks do not substitute for the separately authorized Phase 1 persistence/recovery tests.

## 9. Baseline and history

With the gates passed, **spec-v1.0.2** is the current canonical baseline. For the durable
lease/fencing contract and resulting timestamp count only, this amendment supersedes prior
specification statements. Other product, phase, lineage and safety decisions remain unchanged.

The immutable historical references remain:

- `spec-v1.0` at `f2450f34d7f55a4ce4cf950b5c7557d03c7e3549` and its original manifest.
- `spec-v1.0.1` at `de87d49a40f9edd7ed555b0705253e5eba244081` and its original manifest.

Amendment 20 remains the historical acceptance record for 97 fields; its UTC/native-type rule
continues to apply to all 103 current fields. Earlier status sections are dated history.

The new `spec-v1.0.2-manifest.json` covers the 149 spec-v1.0.1 entries plus this amendment,
ADR-0025, the exact CHECK SQL artifact and the historical spec-v1.0.1 manifest: **153 entries**.
It excludes itself and runtime/Phase 0 delivery artifacts. Historical fidelity tests reverse
only the declared schema additions and inspect unchanged document prefixes, without Git fetches.

This tranche stays uncommitted. No tag is created, moved or deleted; no push occurs.
No repository, service, worker recovery or queue implementation is authorized here.

**Phase 1 has NOT been started.**

**Phase 2 has NOT been started.**
