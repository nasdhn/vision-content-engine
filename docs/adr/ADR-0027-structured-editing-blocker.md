# ADR-0027 — Structured Editing Intelligence blocker

## Status

Accepted — 2026-09-21. Specification amendment `spec-v1.0.4`.

## Context

Editing Intelligence must sometimes conclude that the real available assets cannot satisfy the
approved CreativePlan. The frozen spec explicitly forbids silently rewriting the concept, but
the runtime 1.0.0 contract could only return an EditingPlanSpec.

Treating this conclusion as a provider failure would produce incorrect retries. Persisting a
partial plan would weaken lineage and allow rendering an edit the model itself declared
impossible.

## Decision

Keep contract/prompt 1.0.0 historical and add Editing Intelligence 1.1.0 with a strict
`PLAN | BLOCKED` result. `BLOCKED` is a successful, evidence-bound model result.

Persist it as canonical `EditingBlocker` lineage linked to the exact CreativePlanVersion and
ModelInvocation. Never create an EditingPlanVersion for a blocker. A later valid plan resolves
the blocker; a newer blocker supersedes the prior open blocker.

The existing EditingPlan root is demoted from READY to DRAFT while a blocker is open so the
existing render-request gate prevents new renders without mutating historical versions.

## Consequences

- business impossibility is distinct from provider/schema failure;
- provider retry semantics remain bounded and correct;
- blocker evidence is auditable and reference-whitelisted;
- historical plans/renders remain immutable;
- UI can later derive Needs Attention from canonical blocker state;
- `spec-v1.0.4` becomes the current specification baseline.
