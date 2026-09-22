# ADR-0029 — Phase 7 distribution runtime boundary

## Status
Accepted for Phase 7 implementation

## Context
The V1 Distribution specification is already frozen and the canonical Prisma schema already contains Publication, PublicationAttempt, PlatformAccount, AssetDerivation and OutboxEvent. Phase 6 intentionally exposed only read-only publication/calendar surfaces and stopped before side effects.

The implementation now needs a safe runtime boundary that cannot duplicate external posts, cannot bypass final human Render approval, cannot leak provider credentials into jobs, and cannot make Redis authoritative.

## Decision
Phase 7 uses PostgreSQL-owned Publication state plus the existing transactional outbox. The `control` process owns canonical due-time discovery. For API-automated delivery it atomically moves a due SCHEDULED Publication to PUBLISHING, creates the exact queued PublicationAttempt and emits a publish-request outbox event. For manual handoff it moves the due Publication to READY_FOR_MANUAL_PUBLISH without creating a fake API attempt.

BullMQ is transport only. `OutboxEvent.id` is the stable enqueue deduplication identity. Workers are idempotent against PostgreSQL state.

`PUBLISHING_UNKNOWN` is reconciliation-only: lease expiry, timeout or lost worker response never proves remote absence.

Real provider adapters remain disabled by default behind `PAUSE_ALL_PUBLISHING`, `VCE_REAL_PROVIDERS_ENABLED` and provider/account capability gates. Phase 7A uses fake providers only.

No Prisma migration is expected for Phase 7. A migration request is a stop condition pending proof that the frozen model cannot express an accepted invariant.

## Consequences
- canonical scheduling stays on `Publication.scheduledAt`;
- Redis loss does not erase business state;
- duplicate queue delivery is tolerated;
- manual TikTok handoff never creates synthetic provider attempts;
- ambiguous remote side effects cannot be blindly retried;
- provider credentials remain outside queue payloads/business JSON;
- provider implementations can be added incrementally without weakening the shared state machine;
- production enablement remains a separate progressive Phase 11 concern.
