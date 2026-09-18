# 15 — Repository Conventions

**Status:** ACCEPTED  
**Specification version:** spec-v0.16 reconciled

## Repository

Separate repository:

```text
vision-content-engine
```

One TypeScript monorepo, managed with pnpm workspaces.

## Canonical structure

```text
vision-content-engine/
├── apps/
│   ├── web/
│   ├── api/
│   ├── control/
│   ├── worker-ai/
│   ├── worker-capture/
│   ├── worker-render/
│   ├── worker-publish/
│   └── worker-analytics/
├── packages/
│   ├── domain/
│   ├── application/
│   ├── contracts/
│   ├── database/
│   ├── ai/
│   ├── media/
│   ├── publishing/
│   ├── analytics/
│   ├── observability/
│   └── shared/
├── prisma/
├── docs/
├── infra/
├── scripts/
└── tests/
```

This document is aligned with `02_SYSTEM_ARCHITECTURE.md`; the older `workers/` top-level proposal is superseded.

## Dependency direction

```text
domain
↑
application
↑
API / workers
```

Adapters depend on contracts/application boundaries, not the reverse.

Controllers/routes do not contain business orchestration.

## Rules

- TypeScript strict.
- Zod at external/AI/config boundaries.
- Prisma Migrate is authoritative for DB changes.
- No business logic hidden in NestJS controllers.
- No scattered direct LLM calls: all through AIProviderGateway.
- No publication directly from web UI.
- No direct PostgreSQL/Redis access from browser.
- No raw shell interpolation from user/AI data.
- No committed secrets or auth state.
- No mutable historical version rows.
- Jobs carry identifiers/version IDs, not authoritative object snapshots.
- Every high-risk external side effect has idempotence/reconciliation behavior.
- Application packages import generated Prisma only through `packages/database`.
- Spec artifacts under `docs/spec-artifacts/` are implementation contracts until promoted into runtime packages.

## Naming

- stable roots: singular domain names;
- immutable versions: `<Root>Version`;
- technical executions: `<Thing>Attempt`;
- external intended side effect: `Publication`;
- binary/object identity: `Asset`;
- IDs: UUIDv7 for canonical DB identities.

## Historical design docs

`03A_*` and `03B_*` are retained for design history.

Implementation authority is:

```text
docs/18_FINAL_RECONCILIATION.md
docs/spec-artifacts/schema.prisma
accepted domain-specific specs
```

when a historical draft differs.
