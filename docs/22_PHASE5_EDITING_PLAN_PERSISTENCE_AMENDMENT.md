# 22 — Phase 5 EditingPlan lossless persistence amendment

**Status:** ACCEPTED AND VALIDATED — current canonical baseline after validation.

**Specification:** `spec-v1.0.3`

**Amends:** `spec-v1.0.2`, EditingPlan persistence only.

**Decision date:** 2026-09-21

**Implementation authorization:** Phase 5 Editing Intelligence persistence only.

## 1. Problem

The accepted `EditingPlanSpec` is the complete immutable edit:

- `masterDurationMs`
- `selectedAssets`
- `timeline`
- `productFocus`
- `captions`
- `onScreenText`
- `presenter`
- `audio`
- `transitions`
- `renderSettings`
- `rationale`

The `spec-v1.0.2` relational `EditingPlanVersion` had useful projected JSON fields but could
not reconstruct that contract without loss. In particular, `masterDurationMs`,
`selectedAssets`, `onScreenText` and `rationale` had no canonical storage location.

Hiding them inside an unrelated projection would weaken historical render lineage.

## 2. Decision

Add exactly one nullable JSON field:

```prisma
model EditingPlanVersion {
  // existing fields...
  planSpecJson Json?
}
```

For every EditingPlanVersion produced by Phase 5 Editing Intelligence,
`planSpecJson` is the exact validated `EditingPlanSpec` associated with the successful
`ModelInvocation`.

It is the lossless canonical edit snapshot.

The existing fields remain deterministic projections:

```text
timelineJson         <- plan.timeline
captionPlanJson      <- plan.captions
audioPlanJson        <- plan.audio
visualFocusJson      <- plan.productFocus
transitionPlanJson   <- plan.transitions
greenScreenPlanJson  <- plan.presenter
renderSettingsJson   <- plan.renderSettings
```

No unrelated JSON field receives hidden semantics.

## 3. READY invariant

A new AI-produced EditingPlan may become `READY` only when:

- `planSpecJson` parses as the canonical `EditingPlanSpec`;
- `modelInvocationId` points to a `SUCCEEDED` invocation;
- the invocation `outputHash` matches the canonical hash of `planSpecJson`;
- the invocation has been atomically consumed/applied;
- every persisted projection matches its exact slice of `planSpecJson`;
- the existing exact CreativePlan / TemplateVersion / EditingProfileVersion lineage remains valid.

The application hard validator still runs before persistence. The database-side READY guard
does not replace that validator; it prevents a different or partial payload from being promoted.

## 4. Compatibility

`planSpecJson` is nullable only for historical EditingPlanVersion rows created before this
amendment. No fake empty plan, rationale, asset selection, text layer or duration is backfilled.

The dedicated runtime migration is additive:

```text
20260921120000_phase5_editing_plan_spec
```

It adds one nullable JSONB column and performs no destructive data rewrite.

## 5. Canonical schema and history

For this field only, this amendment supersedes `spec-v1.0.2`.

Both canonical and runtime Prisma schemas contain the field after this amendment.
Historical manifests remain byte-for-byte immutable. Historical fidelity reconstructs older
schema bytes by removing only this declared field, just as earlier amendments reverse only
their declared additions.

`docs/spec-artifacts/spec-v1.0.3-manifest.json` is the current specification manifest.
No historical Git tag is moved or deleted.

ADR-0026 and D-187 record the same decision.

## 6. Validation

Release-blocking checks include:

```text
prisma format
prisma validate
prisma generate
frozen manifest fidelity
migration deployment on isolated PostgreSQL
Editing Intelligence valid/invalid persistence tests
full static/unit/contract suite
full PostgreSQL suite
storage tests
web build
browser regression
git diff --check
```

The amendment does not authorize Distribution or publication work.
