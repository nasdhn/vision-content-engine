# ADR-0023 — Freeze spec-v1.0 and authorize phased implementation

## Status
Accepted

## Decision
The reconciled Vision Content Engine V1 specification is frozen as `spec-v1.0`.

The final Codex Master Prompt is the implementation entrypoint and authorizes Phase 0 only.

Every later implementation phase requires explicit continuation after review of the previous phase.

The final pre-implementation sanity pass validates JSON parsing, TypeScript spec syntax, static Prisma references/indexes and cross-artifact references. Project-local Prisma CLI validation remains a mandatory Phase 0 gate.

## Consequences
- implementation has a stable normative baseline;
- Codex cannot silently expand scope into later phases;
- any domain/schema discrepancy discovered by Prisma stops implementation instead of triggering speculative redesign;
- future spec changes after `spec-v1.0` require an explicit amendment/version rather than silent edits.
