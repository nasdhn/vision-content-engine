# ADR-0021 — Deterministic layered testing and progressive enablement

## Status
Accepted

## Decision
The V1 test strategy uses deterministic unit/domain/contract/database/integration tests as the default, with a small number of high-value workflow, real-provider and operational acceptance tests.

External side-effect ambiguity, exact media lineage, approval gates, transactional outbox behavior, secret safety, analytics NULL semantics and attribution idempotence are release-blocking invariants.

First production deployment uses progressive enablement rather than enabling all autonomous publishing paths immediately.

## Consequences
- CI remains fast enough for normal development;
- critical workflow and safety guarantees are still tested end-to-end;
- media regressions are caught without brittle byte-equality;
- provider cost and side effects remain controlled;
- operational recovery becomes part of Definition of Done.
