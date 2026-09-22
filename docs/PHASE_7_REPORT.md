# Phase 7 Report — Distribution

**Status:** closure candidate; the commit containing this report closes Phase 7 only after
`pnpm check:phase7` is green on the same worktree.

**Branch:** `phase/7-distribution`

**Baseline before Phase 7F:** `7de466db070499df7d9b92f03faef25b82d5b35e`

## Scope delivered

Phase 7 implements the V1 Distribution boundary while preserving PostgreSQL as canonical state and
keeping real provider activation outside this phase.

Delivered checkpoints:

- **Freeze** — `934606b9109ddc99e4c5f2c684e56cc83758ae2f`: Distribution runtime boundary frozen without a Prisma migration;
- **7A** — `2e2eab249e10d24e150233774904b7d3eb87d805`: scheduler/control, transactional outbox, BullMQ transport, publication attempts, fake publisher, retry classification and `PUBLISHING_UNKNOWN` safety;
- **7B** — `f3cd672d78d08748e21484c8c6fd8e4b84bbb794`: TikTok `MANUAL_HANDOFF`, private exact-media access, copyable metadata and explicit human completion without fake provider attempts;
- **7C** — `d6af49736002f6b24a39d6a8d892039588a2934e`: Instagram Reels adapter, short-lived exact-asset lease, bounded container polling, `media_publish` and ambiguity-safe reconciliation;
- **7D** — `36f9e19681f55827ca8fc420a3e9c121bfd2a5e8`: YouTube resumable upload adapter, exact private byte-range source, session resume/reconciliation and audit/capability fail-closed behavior;
- **7E** — `7de466db070499df7d9b92f03faef25b82d5b35e`: account health, `REAUTH_REQUIRED`, operator-safe reconciliation/reschedule/cancel controls and Needs Attention integration;
- **7F** — aggregate Phase 7 gate, closure contract and Phase 11 activation checklist.

## Canonical runtime guarantees

- PostgreSQL owns Publication lifecycle, due time, attempts and reconciliation truth.
- BullMQ transports secret-free identifiers only; OutboxEvent identity provides stable deduplication.
- A potentially successful remote side effect with a lost response becomes `PUBLISHING_UNKNOWN`; it is never retried blindly.
- `PUBLISHING_UNKNOWN` exposes reconciliation, not a generic retry action.
- TikTok V1 remains manual and creates no fake `PublicationAttempt` for the native TikTok action.
- Instagram and YouTube adapters resolve credentials only behind provider boundaries.
- Exact approved media lineage is preserved through publication and provider delivery.
- Explicit provider authentication loss marks the relevant PlatformAccount `REAUTH_REQUIRED`.
- React invokes guarded backend operations; it never performs provider calls or owns publication state.
- No Phase 7 Prisma migration was introduced.

## Live-provider boundary preserved

Phase 7 implements provider code and deterministic tests, but does not activate real production
publishing. The runtime configuration still makes `VCE_REAL_PROVIDERS_ENABLED=true` invalid and
`PAUSE_ALL_PUBLISHING` defaults to true.

No Phase 7 closure step changes that behavior. Enabling a real provider requires a separate,
reviewed Phase 11 change following `PHASE_11_DISTRIBUTION_ACTIVATION_CHECKLIST.md`.

TikTok remains `MANUAL_HANDOFF`; there is no TikTok Direct Post implementation in V1.

## Canonical closure check

Phase 7 adds:

```bash
pnpm check:phase7
```

The aggregate gate runs, in order:

```text
pnpm test:infra
pnpm check
pnpm test:postgres
pnpm test:storage
pnpm test:distribution:runtime
pnpm build:web
pnpm test:browser
```

This covers local PostgreSQL/Redis/private S3 readiness; formatting, lint, strict TypeScript,
secret scanning, Prisma validation, unit/contract/API tests; the full PostgreSQL suite; private
storage; BullMQ/outbox deduplication and secret-free payload smoke; production web build; and the
full Playwright control-room regression.

Fake/injected providers are used by normal provider tests. The closure gate must not make any live
Instagram, YouTube or TikTok provider call.

## Known non-blocking diagnostics

The existing PostgreSQL deprecation warning about calling `client.query()` while another query is
active remains known and is unrelated to Distribution correctness. The storage immutability test
may print its expected non-retryable streaming-request diagnostic while still passing.

## Phase boundary after closure

**Phase 8 does not start automatically.** Analytics ingestion, normalization, attribution,
comparison and analytics UI remain Phase 8 responsibilities.

Real production provider enablement remains Phase 11. Phase 7 closure authorizes neither credential
provisioning nor live remote posting.
