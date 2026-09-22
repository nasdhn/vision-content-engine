# Phase 8 Report — Analytics & Attribution

**Status:** closure candidate; the commit containing this report closes Phase 8 only after
`pnpm check:phase8` is green on the same worktree.

**Branch:** `phase/8-analytics`

**Baseline before Phase 8H:** `51e698ce04a2f6f8084a6b09aebfd952e16cd172`

## Scope delivered

Phase 8 implements the V1 Analytics & Attribution evidence boundary while preserving PostgreSQL as
canonical state, keeping provider secrets server-side and leaving learning/strategy decisions to a
later phase.

Delivered checkpoints:

- **Freeze** — `f66f209008a22f2926d24278c10b516116f521b2`: Phase 8 runtime boundary frozen without a Prisma migration;
- **8A** — `1caef60f53846415db18464e50aaaf319299bc83`: versioned collection windows, canonical collection identity, raw-first persistence, normalization lineage, BullMQ transport and deterministic fake analytics provider;
- **8B** — `aceb02c6b3885bf51797f738e9acb8d980528a72`: TikTok manual metric prompts and sparse manual snapshots preserving `NULL` versus observed zero;
- **8C** — `2e7e36afcafe71d2fc25134ae6ce83b686d046b0`: YouTube Analytics adapter contract, header-driven response mapping, delayed-data handling and compliance hook;
- **8D** — `a4b50fa99b7dd42d26ffa8bcbd3c7cfac45f6fac`: Instagram Analytics adapter boundary with versioned capability/metric profile and fail-closed live activation;
- **8E** — `c728dbed3d4f9f5ea754c5a477c36c73bce42ae8`: signed Vision first-party attribution ingest with raw-body HMAC, replay protection, idempotent external event identity and typed revenue;
- **8F** — `1f1280113859432415fe8ac0abe761f96caec9fc`: Umami supported-API import, direct/inferred/unknown attribution and no silent bot exclusion;
- **8G** — `51e698ce04a2f6f8084a6b09aebfd952e16cd172`: authenticated Analytics read model/UI, source authority, freshness/data-quality presentation and explicit attribution confidence;
- **8H** — aggregate Phase 8 gate, closure contract, report and future activation/retention checklist.

## Canonical evidence guarantees

- PostgreSQL owns canonical analytics state.
- Provider/manual evidence is persisted raw before or atomically with normalization.
- Every normalized platform snapshot references canonical raw evidence.
- `NULL` means unavailable, unsupported, not observed or not yet available; it is never rewritten as `0`.
- An observed provider/manual zero remains the number `0`.
- Logical collection retries reuse a stable `collectionOperationId`; repeated delivery cannot create uncontrolled raw duplicates.
- Normalizer and metric-semantics versions remain explicit.
- Publication analytics collection is derived from canonical `Publication.publishedAt` and versioned collection windows.
- BullMQ transports secret-free identifiers only.
- TikTok V1 remains `MANUAL_ENTRY`; no scraping is introduced.
- YouTube and Instagram adapters isolate provider mapping/capabilities behind provider boundaries.
- Vision is authoritative for `SIGNUP`, `ACTIVATION`, `CUSTOMER` and `REVENUE`.
- Umami is authoritative for `WEBSITE_VISIT` in the Phase 8 business funnel.
- Attribution confidence remains visibly distinct as `DIRECT`, `INFERRED` or `UNKNOWN`.
- Repeated observations from multiple sources are not silently merged into authoritative business totals.
- The Analytics UI is read-only evidence presentation; it does not normalize, deduplicate or decide confidence in React.
- No Phase 8 Prisma migration was introduced.

## Provider and retention boundary preserved

Phase 8 implements deterministic provider adapters and tests but does not authorize real production
analytics collection.

The runtime configuration still rejects `VCE_REAL_PROVIDERS_ENABLED=true`. Phase 8H does not change
that behavior.

YouTube live collection still requires the configured authorization/deletion-compliance checks and
current-policy revalidation for the actual account.

Instagram live collection still requires current permission, capability, metric and retention terms
to be verified for the actual Meta app/account before credentials are wired.

TikTok remains manual.

Umami integration remains supported-API-only; direct Umami database coupling is not part of V1.

Vision signed ingest requires its server-side secret and exact signing contract. The secret is not a
browser credential and must not be placed in queue payloads, logs or client code.

The future activation checklist is recorded in
`docs/PHASE_11_ANALYTICS_ACTIVATION_CHECKLIST.md`.

## Canonical closure check

Phase 8 adds:

```bash
pnpm check:phase8
```

The aggregate gate runs, in order:

```text
pnpm test:infra
pnpm check
pnpm test:postgres
pnpm test:storage
pnpm test:analytics:runtime
pnpm test:distribution:runtime
pnpm build:web
pnpm test:browser
```

This covers local PostgreSQL/Redis/private S3 readiness; formatting, lint, strict TypeScript, secret
scanning, Prisma validation and all unit/contract/API tests; the full PostgreSQL suite; private
storage; Analytics BullMQ/outbox deduplication and secret-free transport; Distribution regression;
the production web build; and the full Playwright control-room regression.

Canonical provider tests use deterministic/injected providers. The closure gate must not make live
Meta, Google, TikTok or Umami calls.

## Phase 9 boundary

Phase 8 closes with trustworthy evidence and descriptive read models only.

The following are **not** Phase 8 outputs:

```text
EvidencePolicy scoring
Analyst model invocation
Insight generation
Recommendation generation
experiment winner declaration
cross-sample causal confidence
weekly learning report
next-test proposal automation
autonomous strategy mutation
```

Experiment metadata may be displayed, but Phase 8 does not declare a winner.

**Phase 9 does not start automatically.** Starting the learning layer is a separate implementation
decision after this closure commit.

## Known non-blocking diagnostics

The existing PostgreSQL deprecation warning about calling `client.query()` while another query is
active remains known and is unrelated to Analytics correctness.

The private-storage immutability test may print its expected non-retryable streaming-request
diagnostic while still passing.

## Boundary after closure

Phase 8 closure authorizes neither real-provider analytics credentials nor provider-policy
assumptions.

Real production provider enablement remains a separate reviewed activation step. Phase 9 remains
separate and must consume Phase 8 evidence without rewriting its provenance or uncertainty.
