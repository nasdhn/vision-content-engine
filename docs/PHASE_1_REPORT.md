# Phase 1 — Canonical Domain & Persistence

Status: implemented and locally validated; Phase 2 not started.

## Baseline and Git

- Initial branch: `main`; working tree clean.
- Initial HEAD and origin/main: `be3fab2480c1889efe78c09460af9808088cc9dd`.
- Annotated `spec-v1.0.2` resolves to that exact commit.
- Implementation branch: `phase/1-domain-persistence`.
- One local implementation commit: `feat(domain): implement Phase 1 canonical persistence`.
- The final response records the resulting commit hash and post-commit status.
- No push; no tag created, moved or deleted.
- All canonical spec documents, both schemas, three manifests and the raw migration preview remain unchanged.

## Delivered scope

`packages/domain` contains pure invariant errors, lineage/actor/UTC/config guards and explicit
WorkflowRun, JobAttempt, OutboxEvent, Concept and Render state machines. All their frozen states
remain represented. The publication retry guard retains PUBLISHING_UNKNOWN reconciliation.

`packages/database` provides a UTC Prisma client, transactional UnitOfWork, append-only version
services, approval gates, exact lineage validation, workflow/job persistence, transactional outbox,
AuditEvent and typed Decimal CostEntry persistence. Root-row locking serializes version allocation.
Nine version families have no update/delete/upsert API; exact version relationships remain pinned.

Durable job leases/outbox claims use persisted UUID tokens, PostgreSQL time and transactional
FOR UPDATE SKIP LOCKED. Heartbeats and job completion reject stale/expired ownership. Explicit
SAFE_RETRY policies permit technical takeover; unspecified, MANUAL and RECONCILE policies do not.
Result persistence can share the fenced job finalization transaction. Outbox delivery exposes
OutboxEvent.id as the stable deduplication key; there is no transport or publishing implementation.

Only a trusted USER identity can pass either human gate. A new ConceptVersion requires its own
approval. Final Render approval binds the exact successful output Asset. Publication draft creation
validates the approved master or its direct platform derivative and preserves TikTok manual handoff.
No script/CreativePlan approval gate was introduced.

## Migration review and local application

File: `prisma/migrations/20260919000000_initial_canonical/migration.sql`.
The entire SQL was read before any application, then tested on disposable PostgreSQL databases.
It contains the canonical generated preview unchanged, plus the accepted manual constraints,
inside BEGIN/COMMIT:

- 50 business tables; 49 enums; 72 foreign keys.
- 103 TIMESTAMPTZ(3) columns; no timestamp without time zone.
- 107 secondary indexes (36 unique including the partial index); 50 primary-key indexes.
- Six CHECKs: Approval subject, revenue completeness, two job lease checks, two outbox claim checks.
- One partial unique index: at most one ACTIVE KnowledgeSnapshot per key.
- No DROP, data conversion or new deletion cascade. Existing 48 RESTRICT / 24 SET NULL deletion rules retained.

SHA-256:

```text
3cbcdacecbd7c96b3030d2a92d9506adc427afa2636ba3f01b9504eb40892a1c
```

Applied with `pnpm db:migrate:local` only to local `vision_content_engine`, initially empty.
Final catalog: 51 public tables including `_prisma_migrations`; exactly one successful migration,
matching checksum; six CHECKs; UTC session timezone; zero business rows. No disposable test databases
remain. `prisma migrate status` reports up to date. Migration replay on a test DB is a no-op.

## Validation evidence

Using Node 24.21.0, pnpm 10.34.5 and Prisma 7.10.0:

| Gate                                   | Result                                                       |
| -------------------------------------- | ------------------------------------------------------------ |
| pnpm install --frozen-lockfile         | Pass                                                         |
| pnpm prisma:format                     | Pass; runtime schema unchanged                               |
| pnpm prisma:validate                   | Pass                                                         |
| pnpm prisma:generate                   | Pass                                                         |
| pnpm db:preview                        | Pass; frozen preview unchanged                               |
| Full SQL review before application     | Pass                                                         |
| pnpm db:migrate:local                  | Pass                                                         |
| pnpm check                             | Pass: formatting, lint, strict types, secrets, Prisma, tests |
| pnpm test                              | 28 tests in 8 files pass                                     |
| pnpm test:postgres                     | 24 tests in 1 file pass                                      |
| pnpm build:web                         | Pass                                                         |
| pnpm check:phase1                      | Pass: check + PostgreSQL tests + web build                   |
| pnpm exec prisma migrate status        | Up to date                                                   |
| git diff --check                       | Pass                                                         |
| Canonical spec/tag baseline comparison | No canonical file changes                                    |

Total: **52 tests**. PostgreSQL evidence covers deployed migration checksum/catalog and replay;
all manual constraints; transaction rollback of content/approvals/audit/outbox; concurrent version
allocation; human gate races; exact root/version/template/profile/media lineage; decimal cost and
attribution idempotence; NULL versus zero; concurrent claims and SKIP LOCKED; expiry, token rotation,
stale finalization; database time despite worker clock skew; expiry during a lock wait; atomic job
result rollback; stable outbox deduplication identity after enqueue/mark loss. No sleeps, automatic
reruns or external-provider tests are involved.

CI retains the pinned existing actions and adds the pinned local PostgreSQL Compose service,
local migration deployment and real PostgreSQL suite. Hosted CI itself has not run because no push
is authorized; its constituent gates passed locally.

The global shell still uses Node 22.23.2 / pnpm 11.19.0. All installation, Prisma and validation
commands used the isolated project-compatible Node 24.21.0 / pnpm 10.34.5 toolchain.

## Dependencies and external effects

Added direct dependency: `@prisma/adapter-pg` 7.10.0. Reused exact pinned `pg` 8.23.0 and
`@types/pg` 8.23.1 in the database package; `@vision/domain` is a workspace dependency.
New locked transitives: `@prisma/driver-adapter-utils` 7.10.0 and `postgres-array` 3.0.4.
Prisma adapter usage was checked against the [official Prisma 7 documentation](https://docs.prisma.io/docs/guides/upgrade-prisma-orm/v7)
and exact package metadata before installation.

No provider account, AI call, recording/capture, render, social publication or analytics import.
No BullMQ installed. No provider usage/cost incurred. Effects are local npm dependency installation,
local database schema creation and creation/removal of isolated test databases. No secrets added.

## Limits and rollback

No new specification contradiction was found. There is no Phase 2 implementation, scheduler,
queue dispatcher, polling worker, provider adapter, dashboard feature or automatic strategy change.
KnowledgeSnapshot/source provenance tables are migrated as part of the canonical schema, without
Phase 2 knowledge-management/AI services or production seeds.

Persistence APIs are the application write boundary. Raw Prisma/SQL administrator access remains
trusted and can bypass application-level immutability and cross-table checks; the migration adds
only accepted SQL constraints, not unapproved triggers. Actor identity must come from trusted future
authentication wiring. Media/technical QA execution and actual provider capability gates remain
later-phase responsibilities. Lease policies/configuration have no implicit production activation.

A code rollback is a revert of the single Phase 1 commit. It does not reverse the applied migration.
No destructive down/reset is provided. Before any later database rollback, preserve data and use a
reviewed forward migration or restore a pre-migration backup. Do not reset an occupied database.
The application database currently contains no business data.

## Exact changed files

- `.github/workflows/phase0.yml`
- `docs/PHASE_1_REPORT.md`
- `package.json`
- `packages/database/README.md`
- `packages/database/package.json`
- `packages/database/src/client.ts`
- `packages/database/src/index.ts`
- `packages/database/src/leases.ts`
- `packages/database/src/lineage.ts`
- `packages/database/src/persistence.ts`
- `packages/database/src/transaction.ts`
- `packages/database/src/versions.ts`
- `packages/database/test/support.ts`
- `packages/domain/src/index.ts`
- `pnpm-lock.yaml`
- `prisma/migrations/20260919000000_initial_canonical/migration.sql`
- `prisma/migrations/migration_lock.toml`
- `scripts/migrate-local.ts`
- `tests/README.md`
- `tests/contracts/migration.test.ts`
- `tests/postgres/persistence.test.ts`
- `tests/unit/domain.test.ts`
- `tsconfig.json`
- `vitest.config.ts`
- `vitest.postgres.config.ts`

**Phase 2 has NOT been started.**
