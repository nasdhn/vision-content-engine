# ADR-0030 — Phase 8 analytics runtime boundary

## Status
Accepted for Phase 8 implementation

## Context
The frozen V1 Analytics specification already defines raw observations, normalized metric snapshots, attribution events, collection windows, provider adapters and confidence semantics. The canonical Prisma schema already contains the required persistence, while `apps/worker-analytics` and `@vision/analytics` remain scaffolds at the Phase 8 baseline.

Phase 8 must collect useful evidence without treating unavailable metrics as zero, without collapsing provider semantics into one score, without double-counting attribution, and without moving Phase 9 learning/strategy behavior into the ingestion layer.

Current provider behavior also matters: YouTube Analytics is delayed rather than real-time, current YouTube policies constrain derived metrics and require continuing authorization/deletion compliance, and Meta metric/retention rules must be verified before live Instagram analytics collection.

## Decision
Phase 8 uses PostgreSQL as the authority for analytics evidence and collection intent.

Raw evidence is persisted with a stable `collectionOperationId`, then normalized through versioned adapter/normalizer contracts. `MetricSnapshotRaw` remains the evidence record and `MetricSnapshotNormalized` remains a typed interpretation that preserves NULL for unavailable/unobserved values.

The `control` process derives collection intent from `Publication.publishedAt` plus the versioned collection-window registry and uses existing `WorkflowRun`, `JobAttempt` and transactional `OutboxEvent` primitives. BullMQ is transport only. Duplicate delivery is tolerated because the raw collection operation is idempotent in PostgreSQL.

Provider credentials are resolved only at adapter boundaries and never travel in queue payloads. Canonical Phase 8 tests use fake providers; live third-party collection is not a test dependency.

Attribution remains `DIRECT | INFERRED | UNKNOWN`. Vision product events arrive through a signed HTTP boundary with replay protection and source-event idempotence. Umami is imported through its supported API, never by database coupling.

Phase 8 does not implement EvidencePolicy conclusions, Analyst-generated Insights/Recommendations or autonomous strategy changes; those remain Phase 9.

No Prisma migration is expected. A migration request is a stop condition pending proof that an accepted Phase 8 invariant cannot be expressed by the frozen schema.

## Consequences
- raw provider/manual evidence and normalized interpretation remain separately auditable;
- delayed provider data can be represented honestly as unavailable instead of zero;
- collection retries cannot silently duplicate raw snapshots;
- provider metric semantics stay versioned and platform-aware;
- attribution certainty remains visible to operators;
- business events are deduplicated at the source-system boundary;
- TikTok analytics remains manual rather than scraped;
- live provider retention/permission checks remain explicit activation gates;
- YouTube-derived analytics beyond permitted API metrics is not introduced implicitly;
- Phase 9 receives trustworthy evidence instead of hidden strategy mutations.
