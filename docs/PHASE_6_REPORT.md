# Phase 6 Report — Human-gate Dashboard

**Status:** closure candidate; commit containing this report closes Phase 6 once `pnpm check:phase6` is green.

**Branch:** `phase/6-human-gate-dashboard`

**Baseline before Phase 6E:** `a11604d5fbe73b80cd2c0fde2d82f7e470617e71`

## Scope delivered

Phase 6 turns existing canonical workflow state into an internal single-user control room without
creating a second workflow engine.

Delivered tranches:

- **6A** — shared local session/auth boundary, dashboard shell, Dashboard and Needs Attention reads;
- **6B** — exact ConceptVersion human gate with stale-version fail-closed semantics;
- **6C** — Production read model plus preserved Recording Pack upload/preview/selection behavior;
- **6D** — final Render human gate, exact server-resolved output approval, structured rejection and
  authenticated render-scoped private media;
- **6E** — Calendar/Published current-state reads, Assets/Patterns/Templates/Settings read surfaces,
  explicit Analytics deferral, supporting deep-link/mobile coverage and aggregate Phase 6 check.

Exactly two mandatory human gates exist:

1. ConceptVersion review;
2. final Render review.

Recording remains conditional human input, not a third approval gate.

## Runtime boundary preserved

- PostgreSQL remains canonical lifecycle state.
- React presents projections and invokes guarded backend operations; it does not own transitions.
- Needs Attention is derived at read time and is not persisted as a workflow state.
- Concept decisions target the exact shown ConceptVersion.
- Render approval resolves the exact eligible successful READY output Asset on the server.
- Private Render media remains lineage-authorized and does not expose bucket/object keys.
- Supporting asset reads expose technical metadata and usage only; storage identifiers remain private.
- Settings expose masked/reference-only operational state and never credentials or secret values.

## Phase boundaries preserved

Phase 6 does **not** implement Phase 7 distribution behavior. Calendar and Published are read-only
views over Publication rows that already exist. There is no scheduler mutation, remote upload,
platform adapter action, publication retry, reconciliation or manual TikTok handoff implementation.

Phase 6 does **not** implement Phase 8 analytics. `/analytics` is a stable route with an explicit
deferred state. No performance metrics, attribution or synthetic evidence are presented.

No Prisma migration is introduced by Phase 6.

## Canonical closure check

Phase 6 adds:

```bash
pnpm check:phase6
```

which runs:

```text
pnpm check
pnpm test:postgres
pnpm test:storage
pnpm build:web
pnpm test:browser
```

This covers formatting, lint, TypeScript, secret scanning, Prisma validation, static/unit/contract
and integration tests, PostgreSQL tests, private-storage tests, production web build and Playwright
browser regressions.

## Known non-blocking diagnostics

The existing PostgreSQL test warning about calling `client.query()` while another query is active
remains known and unrelated to Phase 6. The storage immutability test may also print the expected
non-retryable streaming-request diagnostic while still passing.

## Known Phase 6 limitations

- Dashboard authentication remains local/single-user by design.
- Calendar and Published are read-only until Phase 7.
- Platform publishing/reconciliation is not active in Phase 6.
- Analytics evidence/UI is intentionally deferred to Phase 8.
- Asset management is inspection-only; there is no destructive historical deletion surface.
- Patterns and Templates are inspection-only; there is no raw JSON editor or mutation engine.
- Settings are inspection-only and intentionally hide credentials and secret references.

## Next boundary

The next implementation phase is **Phase 7 — Distribution**. It owns publication scheduling,
platform adapters, remote upload/handoff, idempotence, retry/reconciliation and publication-side
effects. Phase 8 remains responsible for analytics ingestion, normalization, attribution and
comparison UI backed by real evidence.
