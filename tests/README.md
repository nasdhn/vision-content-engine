# Deterministic tests

`pnpm test` runs unit, frozen-spec, migration-contract and in-process API tests without a database
or external provider. The scripted provider and manual clock remain test utilities only.

`pnpm test:postgres` runs real PostgreSQL persistence tests in a uniquely named disposable local
database. It loads the ignored local environment, refuses remote hosts, creates its own database,
applies the reviewed migration and cleans up only that database. Requires local CREATEDB privileges.
No application data is truncated. No social, AI, capture, rendering or analytics provider is called.

The PostgreSQL suite checks migration replay/checksum/catalog, all manual constraints, atomic
rollback, immutable version allocation, human gates, exact lineage, typed cost/audit, NULL versus
zero, durable lease concurrency and fencing. Concurrent tests use separate connections. Expiry is
set explicitly in fixture rows and lock waits use barriers/catalog observations, without sleeps
or retries. Outbox redelivery is tested with an in-memory deduplicating transport stand-in.

`pnpm check:phase1` runs `check`, `test:postgres` and `build:web`. CI starts the pinned PostgreSQL
Compose service and runs both deterministic suites. Tests never silently skip when PostgreSQL is
required and unavailable.

`pnpm test:infra` remains the explicit local PostgreSQL/Redis/private-S3 canary. It requires
`pnpm infra:up`, refuses remote endpoints and never applies business migrations.

Phase 2 and provider integration remain unauthorized in this tranche.
