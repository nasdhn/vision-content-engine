# ADR-0005 — Transactional Outbox between PostgreSQL and BullMQ

## Status
Accepted

## Context
Important business state is stored in PostgreSQL while asynchronous execution is performed through Redis/BullMQ. A direct `database commit → queue.add()` sequence can leave the systems inconsistent if one succeeds and the other fails.

## Decision
V1 uses a transactional outbox for important asynchronous work requests.

The business state transition and the corresponding outbox event are committed in the same PostgreSQL transaction. A dedicated dispatcher later pushes the event to BullMQ.

## Consequences
- PostgreSQL remains the recovery point.
- Dispatch may be retried safely.
- Workers must be idempotent.
- Duplicate queue delivery must be tolerated.
- Outbox monitoring and cleanup are operational responsibilities.
