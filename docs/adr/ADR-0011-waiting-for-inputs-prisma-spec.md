# ADR-0011 — CreativePlan WAITING_FOR_INPUTS and concrete Prisma spec artifact

## Status
Accepted

## Decision
`CreativePlanStatus` uses a single `WAITING_FOR_INPUTS` state instead of mutually exclusive recording/capture blocker states.

Outstanding dependencies are derived from relational state.

The accepted concrete Prisma schema remains under `docs/spec-artifacts/` until implementation is explicitly authorized.

## Rationale
A CreativePlan can require several missing input types simultaneously. One generic waiting state plus explicit dependency relations is more truthful than mutually exclusive blocker enums.

Keeping Prisma artifacts under docs prevents accidental premature implementation while preserving an executable-shaped source of truth.
