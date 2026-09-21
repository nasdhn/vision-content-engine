# 23 — Phase 5 Structured Editing Blocker Amendment

**Status:** ACCEPTED
**Specification version:** spec-v1.0.4
**Date:** 2026-09-21
**Scope:** Editing Intelligence only

---

## 1. Problem

The frozen Editing Intelligence specification already requires a structured blocker when the
real available assets make the accepted CreativePlan impossible without silently changing it.
The runtime 1.0.0 AI contract could only return `EditingPlanSpec`, so this state could not be
represented without either inventing a partial plan or treating a valid editorial conclusion as
a provider failure.

## 2. Versioning rule

The historical `editing-intelligence` prompt/contract `1.0.0` remains immutable.

`1.1.0` adds one discriminated output contract:

```text
PLAN    -> complete validated EditingPlanSpec
BLOCKED -> structured EditingBlockerSpec
```

The input context remains evidence-bound to the exact ConceptVersion, ScriptVersion,
CreativePlanVersion, EditingProfileVersion, TemplateVersion and available Assets supplied to
the invocation.

## 3. Blocker semantics

`BLOCKED` is a successful Editing Intelligence result, not a provider error. It is valid only
when producing a conforming EditingPlan would require inventing media, ignoring a hard
constraint or silently changing the CreativePlan.

A blocker contains:

```text
reasonCode
recoverability
summary
evidence.assetIds
evidence.scriptSegmentIds
evidence.constraintKeys
requiredAction
```

Evidence references are deterministically checked against the supplied context. An asset or
script segment outside that context is invalid. Reason-specific evidence is also validated.

## 4. No fake plan

A `BLOCKED` result MUST NOT create an `EditingPlanVersion`. It MUST NOT synthesize an empty,
partial or placeholder timeline.

The corresponding `ModelInvocation` completes as `SUCCEEDED` and is consumed exactly once.
Business/reference validation failures remain terminal validation failures and do not trigger
provider retry. JSON/schema repair behavior remains unchanged.

## 5. Canonical persistence

`EditingBlocker` is first-class canonical persistence with:

```text
creativePlanVersionId
modelInvocationId
status = OPEN | RESOLVED | SUPERSEDED
reasonCode
recoverability
blockerSpecJson
resolvedByEditingPlanVersionId?
createdAt
closedAt?
```

`blockerSpecJson` stores the exact validated `BLOCKED` result losslessly.

At most one `OPEN` blocker exists for a given immutable CreativePlanVersion. A newer blocker
for the same version supersedes the older blocker. A later valid EditingPlanVersion for that
CreativePlanVersion resolves the open blocker.

## 6. EditingPlan root behavior

If a previous EditingPlan root is `READY` and a newer Editing Intelligence evaluation for the
same CreativePlanVersion returns `BLOCKED`, the root is returned to `DRAFT`. Historical
EditingPlanVersions and already-created Render lineage remain immutable. New renders are
therefore blocked by the existing `EDITING_PLAN_NOT_READY` gate until a valid plan succeeds.

## 7. Retry semantics

A valid `BLOCKED` result performs exactly one successful provider attempt for that output. It
is not retried merely because production cannot continue.

Invalid blocker references or inconsistent blocker evidence are validation failures and are not
provider-transient retry conditions.

## 8. Migration safety

The migration is additive:

- three blocker enums;
- one `EditingBlocker` table;
- foreign keys to CreativePlanVersion, ModelInvocation and optional resolving EditingPlanVersion;
- one partial unique index for the canonical OPEN blocker;
- one state/closure CHECK.

No existing row is rewritten or backfilled.

## 9. Acceptance gates

- historical 1.0.0 Editing Intelligence contract remains available;
- runtime/frozen 1.1.0 schemas are identical;
- prompt 1.1.0 is pinned byte-for-byte;
- `PLAN` still passes the existing hard renderer validation;
- `BLOCKED` creates no EditingPlanVersion;
- valid blocker uses one provider attempt and leaves ModelInvocation `SUCCEEDED`;
- hallucinated evidence fails without retry;
- newer blocker supersedes the prior OPEN blocker;
- later valid plan resolves the blocker;
- previous READY EditingPlan root is demoted while blocked;
- Prisma validate/generate and full Phase 5 regression suite pass.
