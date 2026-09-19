# ADR-0025 — Durable leases and fencing

## Status

Accepted — 2026-09-19. Specification amendment `spec-v1.0.2`.

## Context

Phase 1 inspection found that recoverable job ownership and abandoned outbox recovery lacked
an explicit durable representation in the frozen schema. Session locks alone do not meet the
selected persistent-heartbeat, observable-expiry and last-ownership audit requirements.

## Decision

Persist leases in PostgreSQL. JobAttempt keeps workerId and gains leaseToken, leaseAcquiredAt,
heartbeatAt and leaseExpiresAt. OutboxEvent gains claimOwner, claimToken, claimedAt,
claimHeartbeatAt and claimExpiresAt. Tokens are nullable UUIDs; all six new timestamps are
nullable `@db.Timestamptz(3)`. Add the two recovery indexes defined by amendment 21.

Every acquisition/takeover uses a fresh token. Heartbeats and finalization are conditional
writes with the state/token/expiry predicates specified in amendment 21. An old owner cannot
finalize after takeover. PostgreSQL's clock is authoritative; durations remain typed configuration.

Keep stable OutboxEvent.id for transport deduplication across token rotations. Never use lease
expiry to justify retrying an uncertain external effect; Publication retains PUBLISHING_UNKNOWN
and reconciliation. No product lifecycle enum or existing field changes.

## Consequences

- `docs/21_DURABLE_LEASES_FENCING_AMENDMENT.md` is the exact normative contract.
- Four manual CHECKs in the accompanying canonical SQL artifact enforce active-state presence
  and nullable historical timestamp ordering; they do not enforce fencing by themselves.
- The future initial migration must include those CHECKs alongside the three earlier manual constraints.
- DateTime count becomes 103; all timestamps retain the UTC semantics of amendment 20.
- Historical tags/manifests spec-v1.0 and spec-v1.0.1 remain immutable; a new manifest covers spec-v1.0.2.
- This tranche generates/reviews preview SQL only. No migration application or Phase 1 runtime implementation.
- The validated amendment becomes the current baseline without a commit, tag or push in this tranche.
