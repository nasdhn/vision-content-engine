# ADR-0008 — Prisma 7 and UUID v7 baseline

## Status
Accepted

## Decision
Vision Content Engine V1 uses:
- Prisma ORM 7, explicitly pinned;
- UUID v7 canonical database identifiers.

## Rationale
The project prioritizes a stable supported ORM line and consistent time-ordered opaque identifiers.

## Consequences
- do not use `prisma@latest` blindly;
- lock exact dependency versions at bootstrap;
- canonical entity IDs use the same UUID strategy;
- external platform IDs remain separate strings.
