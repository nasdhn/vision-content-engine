# 20 — Time Semantics Amendment

**Status:** ACCEPTED — validated on 2026-09-19; current baseline `spec-v1.0.1`.

**Specification:** `spec-v1.0.1`

**Amends:** `spec-v1.0`, time persistence types only.

**Decision date:** 2026-09-19

**Implementation authorization:** NO — Phase 1 remains unauthorized.

## 1. Problem discovered in Phase 0

`docs/11_DISTRIBUTION.md` requires timezone-aware scheduling timestamps.
`docs/13_SECURITY_OBSERVABILITY_OPERATIONS.md` requires UTC instants in the database and application.
The canonical Prisma schema used unannotated `DateTime` / `DateTime?` fields.
Prisma 7.10.0 generated 97 PostgreSQL `TIMESTAMP(3)` columns in the Phase 0 preview,
confirming the mismatch. No migration was applied; the local public schema remains empty.

The Phase 0 report and SQL review remain historical evidence at commit
`f256c182672c9d50e55da96ec6927d5da040a585`. Their open time-semantics issue is resolved by
this amendment; their original preview hash describes the pre-amendment SQL only.

## 2. Accepted time semantics

Every V1 `DateTime` field represents an **instant**, never a local civil date or wall-clock
value. This includes creation, update, scheduling, observation, collection, start, end,
expiry and effective timestamps. Each field must declare `@db.Timestamptz(3)`.

`timestamp(3)` has no time-zone semantics. `timestamptz(3)` represents an instant normalized
internally to UTC, with millisecond precision. It does not retain the original zone name
or offset. PostgreSQL display and interpretation of offset-free input depend on the session
TimeZone setting. Reference: [PostgreSQL date/time types](https://www.postgresql.org/docs/18/datatype-datetime.html).

UTC remains canonical in the database and application. Application timestamps exchanged
as text must identify an unambiguous instant and use UTC (`Z`) for canonical output;
database/application sessions use UTC. The native type alone does not configure session
TimeZone or implement input validation.

`Europe/Paris` is only the default UI presentation and local-input interpretation zone.
The UI converts local input to an instant before persistence and converts instants for display;
it does not persist an offset-free Paris wall-clock timestamp. Ambiguous or nonexistent local
times at daylight-saving transitions require explicit resolution or rejection before conversion.
This is a specification clarification; no UI, conversion service or session configuration is implemented here.

Examples (attribute ordering is not semantic):

```prisma
createdAt   DateTime  @db.Timestamptz(3) @default(now())
scheduledAt DateTime? @db.Timestamptz(3)
startedAt   DateTime? @db.Timestamptz(3)
```

## 3. Exact amendment boundary

Only the PostgreSQL native type is added to all 97 temporal fields in
`docs/spec-artifacts/schema.prisma` and its Phase 0 copy `prisma/schema.prisma`.
There are 73 required and 24 nullable fields. Names, nullability, defaults, `@updatedAt`,
relations, enums, indexes and deletion policies are unchanged. Runtime formatting is permitted.
No duration, counter, JSON payload or other field type is changed.

For time semantics only, this accepted amendment takes precedence over the historical
validation/reconciliation documents and schema. All other precedence and product decisions
remain unchanged. ADR-0024 and D-184 record the same decision.

## 4. Validation and current SQL review

Use project Node 24.21.0, pnpm 10.34.5 and Prisma 7.10.0:

```text
pnpm prisma:format
pnpm prisma:validate
pnpm prisma:generate
pnpm db:preview
pnpm check
pnpm test
pnpm build:web
git diff --check
```

The gates above pass: Prisma format/validate/generate, preview inspection, checks, 18 tests,
web build and whitespace validation. `spec-v1.0.1` is therefore the current canonical baseline.
This baseline name is a specification version, not a newly created Git tag.
No implementation phase is activated.

The regenerated preview contains exactly 97 `TIMESTAMPTZ(3)` columns and no `TIMESTAMP(3)`
columns. Compared with the Phase 0 preview, replacing those 97 type tokens is the entire SQL
difference, byte for byte. The 50 tables, 49 enums, 104 secondary indexes and 72 foreign keys
are unchanged. The new preview SHA-256 is:

```text
5f54430f1e4eb644663c847beadd03c6d31e457a3f566563032d295dff19d7d5
```

The SQL is an **unapplied preview**, not an approved executable migration. The three manual
SQL constraints specified in Master Prompt §20 and their persistence tests remain for a
separately authorized Phase 1. No data conversion or migration is performed by this amendment.

## 5. Historical baseline and manifests

The existing annotated Git tag `spec-v1.0` stays on
`f2450f34d7f55a4ce4cf950b5c7557d03c7e3549`; it must not be moved or deleted.
`docs/spec-artifacts/spec-v1.0-manifest.json` remains byte-for-byte unchanged, describing
that historical revision rather than amended working-tree contents.

`docs/spec-artifacts/spec-v1.0.1-manifest.json` describes the current canonical specification.
It covers the original 146 paths, this amendment, ADR-0024 and the historical manifest itself
(149 files). It excludes itself and Phase 0 implementation/report artifacts to avoid circular
hashes and preserve the original canonical scope. Entries use sorted paths, byte sizes and SHA-256.

Fidelity tests preserve the historical manifest hash and verify its original bytes by reversing
only the native-type addition in the schema and removing only appendices from the three
status/decision documents. They also verify all current manifest entries and runtime schema fidelity.
Historical checks therefore work without fetching Git history or accessing the network in CI.

**Phase 1 has NOT been started.** No migration application, Git tag creation/movement or push is authorized.
