# 03B — Prisma Concrete Schema Review

**Status:** ACCEPTED  
**Specification version:** spec-v0.5  
**Implementation authorization:** NO
**Accepted:** 2026-09-18

## 1. Concrete artifacts

This review is based on:

- `schema.prisma.proposed`
- `prisma7.config.ts.proposed`

The schema now contains every accepted V1 entity, workflow-owned lifecycle enum, explicit media-lineage join model, baseline index and relation.

## 2. Important consistency correction discovered

While translating the accepted workflow into a single relational enum, one inconsistency became visible:

The accepted workflow used both:

- `BLOCKED_ON_RECORDING`
- `BLOCKED_ON_CAPTURE`

but a CreativePlan can require **recording and capture at the same time**.

A single enum cannot truthfully represent both blockers simultaneously.

### Proposed correction

Replace those two states with:

```text
WAITING_FOR_INPUTS
```

The exact outstanding dependencies are derived from:

- RecordingRequest statuses;
- required CaptureRuns;
- required Assets.

Final proposed lifecycle:

```text
DRAFT
READY
WAITING_FOR_INPUTS
READY_FOR_EDITING
SUPERSEDED
ARCHIVED
```

This is a small workflow correction, not a product change.

## 3. Concrete schema decisions now represented

- Prisma 7 `prisma-client` generator.
- Database URL in Prisma config.
- UUID v7 canonical IDs.
- All canonical foreign keys use PostgreSQL UUID type.
- Explicit CaptureRunAsset.
- Explicit RenderInputAsset.
- Explicit TemplateVersionAsset.
- Workflow lifecycle enums.
- Approval with explicit ConceptVersion/Render foreign keys.
- Append-only raw/normalized analytics.
- Transactional Outbox model.
- Workflow/JobAttempt separation.
- ModelInvocation and CostEntry.
- Protected historical lineage using Restrict by default.

## 4. Approval CHECK migration

Prisma cannot represent the full polymorphic integrity requirement directly in the schema.

The initial migration must add a PostgreSQL CHECK enforcing:

- CONCEPT => conceptVersionId non-null and renderId null
- RENDER => renderId non-null and conceptVersionId null

The generated migration SQL must be inspected before this CHECK is added because physical column naming depends on generated SQL.

## 5. Schema sanity review

### Good

- no binary media stored in PostgreSQL;
- versioned content is relational;
- rendering can pin exact input assets;
- template versions pin exact media dependencies;
- capture output provenance is explicit;
- scheduled publications are indexable;
- remote post uniqueness is scoped to account;
- unknown analytics remain nullable;
- no cascade-delete path through published lineage.

### Deferred intentionally

The schema still does not introduce:

- users/workspaces/RBAC;
- billing;
- automated Researcher entities;
- prompt registry tables;
- detailed platform-specific metrics tables.

Those remain outside current accepted scope or belong to later specs.

## 6. One Prisma implementation detail

For Prisma 7, use the `prisma-client` generator with explicit output. The datasource URL belongs in Prisma config.

When implementation is authorized, exact package minor versions are pinned in `pnpm-lock.yaml`.

## 7. Acceptance checklist

- [x] Accept `WAITING_FOR_INPUTS` workflow correction.
- [x] Accept the concrete `schema.prisma` structure.
- [x] Accept UUID v7 on all canonical DB IDs.
- [x] Accept explicit media-lineage join tables.
- [x] Accept Approval manual CHECK migration.
- [x] Accept Prisma 7 config shape.
- [x] Confirm no V1 entity is missing.
- [x] Confirm no out-of-scope multi-tenant/billing model leaked in.

After acceptance:

1. amend `04_WORKFLOWS.md` with `WAITING_FOR_INPUTS`;
2. store the concrete schema as the canonical schema specification artifact;
3. mark `Prisma schema draft` `[x]`;
4. bump specification status to `spec-v0.5`;
5. begin `05_AI_CONTRACTS.md`.

## 8. Bootstrap verification later

Because implementation is still forbidden, we are not creating a Node workspace merely to run Prisma.

The first authorized bootstrap phase must run:

```bash
pnpm prisma format
pnpm prisma validate
pnpm prisma generate
pnpm prisma migrate dev --create-only --name init
```

Then inspect the migration SQL, add the Approval CHECK, and only then apply it to local PostgreSQL.
