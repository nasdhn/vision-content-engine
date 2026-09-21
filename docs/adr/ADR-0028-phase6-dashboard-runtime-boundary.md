# ADR-0028 — Phase 6 dashboard is a projection/action surface over canonical workflow state

## Status
Accepted for Phase 6 implementation

## Context

The Phase 5 baseline already owns content lifecycle transitions, approval persistence, media
lineage, Technical QA, Creative QA, Recording Pack state and audit history.

A dashboard implementation that duplicates those rules in React or introduces UI-specific workflow
states would create two sources of truth.

The existing local authentication state is currently private to RecordingController, which is safe
for one controller but unsuitable once Phase 6 adds dashboard controllers.

## Decision

1. Phase 6 introduces no dashboard workflow-state table.
2. Needs Attention is a derived read model.
3. Human writes delegate to existing guarded persistence/application operations.
4. Concept decisions target an exact ConceptVersion and fail closed when stale.
5. Render approval resolves exact successful READY output lineage on the server.
6. Render rejection persists the dashboard reason code and optional comment in Approval.
7. Render review media is exposed only through an authenticated render-scoped endpoint; object
   storage identifiers are never client-controlled.
8. The existing local cookie/CSRF/origin model becomes one shared API session service before
   multiple dashboard controllers are activated.
9. Phase 6 does not implement Phase 7 publication side effects or Phase 8 analytics evidence.

## Consequences

- no Prisma migration is expected;
- React remains replaceable and non-authoritative;
- stale tabs cannot approve a newer version accidentally;
- private media authorization is based on canonical lineage;
- current Recording Pack security semantics stay reusable;
- Calendar/Published/Analytics can expose only capabilities actually implemented at that point.
