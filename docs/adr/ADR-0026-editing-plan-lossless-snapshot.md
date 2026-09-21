# ADR-0026 — Lossless EditingPlan snapshot persistence

## Status

Accepted — 2026-09-21. Specification amendment `spec-v1.0.3`.

## Context

The frozen Editing Intelligence contract produces a complete `EditingPlanSpec`, while the
`spec-v1.0.2` `EditingPlanVersion` relation stored only several projections. Persisting only
those projections would lose `masterDurationMs`, exact selected assets, on-screen editorial
text and the editing rationale, weakening deterministic historical reproduction.

Embedding the missing fields inside unrelated existing JSON columns would create hidden
semantics and make reconstruction dependent on implementation convention.

## Decision

Add nullable `EditingPlanVersion.planSpecJson` as the exact complete validated
`EditingPlanSpec` snapshot. Keep the existing JSON fields as deterministic projections for
specialized access and renderer plumbing.

AI-produced plans must prove the exact successful `ModelInvocation` hash and applied marker
before READY promotion, and persisted projections must hash to the corresponding canonical
plan slices.

Null remains valid only for historical pre-amendment rows. No backfill invents missing edit
semantics.

## Consequences

- `spec-v1.0.3` becomes the current canonical specification baseline.
- `docs/spec-artifacts/schema.prisma` and `prisma/schema.prisma` remain semantically aligned.
- The runtime migration adds one nullable JSONB column and no destructive operation.
- Historical spec-v1.0, spec-v1.0.1 and spec-v1.0.2 manifests remain immutable.
- Render compilation can consume one lossless EditingPlan snapshot while checking projections
  and exact input-asset lineage.
- This ADR does not expand Phase 5 into renderer execution, Distribution or publication.
