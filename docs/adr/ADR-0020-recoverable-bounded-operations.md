# ADR-0020 — Recoverable and bounded operations

## Status
Accepted

## Decision
The Content Engine is operated as a recoverable system: PostgreSQL is authoritative, Redis is non-authoritative, binary media is private object storage, heavy workers are resource-bounded, and all high-risk external side effects use reconciliation-aware recovery.

Secrets are referenced rather than persisted in jobs/logs/business JSON.

Production uses pinned Docker Compose deployments, monitored backups, restore drills, kill switches and documented incident runbooks.

## Consequences
- host/Redis failure does not erase canonical workflow state;
- incidents can be reconstructed through correlation IDs and audit history;
- runaway render/AI/provider work has bounded blast radius;
- backups become operationally meaningful because restores are tested;
- local development cannot accidentally publish real content by default.
