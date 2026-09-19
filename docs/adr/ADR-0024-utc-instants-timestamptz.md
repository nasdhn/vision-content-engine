# ADR-0024 — Persist V1 UTC instants as timestamptz(3)

## Status

Accepted — 2026-09-19. Specification amendment `spec-v1.0.1`.

## Context

Phase 0 Prisma validation succeeded but its SQL preview mapped all 97 unannotated DateTime
fields to `TIMESTAMP(3)` without time zone. This contradicted the timezone-aware scheduling
requirement in spec 11 and UTC instant semantics in spec 13. No migration was applied.

## Decision

Every V1 `DateTime` / `DateTime?` represents an instant and receives `@db.Timestamptz(3)`
in both the canonical and runtime schemas. UTC is canonical; `Europe/Paris` is only used
for UI presentation and interpretation before conversion to an unambiguous instant.
The native type retains millisecond precision and does not preserve an original time-zone identifier.

Only the native persistence type changes. Relations, enums, defaults, field names, nullability,
indexes and deletion policies stay identical. No application feature or migration is introduced.

## Consequences

- `docs/20_TIME_SEMANTICS_AMENDMENT.md` defines the limited normative override and validation gates.
- After those gates pass, `spec-v1.0.1` becomes the current baseline, without creating a Git tag.
- `spec-v1.0` at `f2450f34d7f55a4ce4cf950b5c7557d03c7e3549` and its manifest remain historical and immutable.
- A new manifest verifies the amended baseline; fidelity checks continue to protect the historical version.
- The initial SQL preview is regenerated and reviewed, never applied by this amendment.
- Phase 1 still requires separate explicit authorization. No tag is created/moved/deleted and no push occurs.
