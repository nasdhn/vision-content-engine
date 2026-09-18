# 03A — Prisma Schema Draft Review

**Status:** ACCEPTED  
**Specification version:** spec-v0.3  
**Scope:** relational translation of the accepted Domain Model  
**Implementation authorization:** NO
**Accepted:** 2026-09-18

---

## 1. Runtime/ORM decision

### Recommendation

Use **Prisma ORM 7**, explicitly pinned for the V1 implementation.

Do not use an unpinned `prisma@latest` installation while Prisma 8 is still release-candidate software.

Target package policy when implementation begins:

```json
{
  "devDependencies": {
    "prisma": "^7"
  },
  "dependencies": {
    "@prisma/client": "^7"
  }
}
```

Exact minor versions must be locked by the package lockfile at bootstrap.

### Prisma 7 shape

Use the modern Prisma 7 client generator:

```prisma
generator client {
  provider = "prisma-client"
  output   = "../packages/database/src/generated/prisma"
}

datasource db {
  provider = "postgresql"
}
```

Connection configuration belongs in `prisma.config.ts`, not in a `url = env(...)` line in the schema.

---

## 2. ID strategy

### Decision proposed

Use **UUID v7** for canonical database IDs.

Shape:

```prisma
id String @id @default(uuid(7)) @db.Uuid
```

Why:

- standard UUID format;
- globally unique;
- time-ordered compared with random UUID v4;
- useful for indexes and chronological locality;
- supported by Prisma 7;
- opaque enough for public/internal identifiers.

Do not mix CUID, UUID and auto-increment IDs across domain entities.

All canonical entities use UUID v7 unless an external platform ID is being stored.

---

## 3. Explicit capture output lineage

The current draft is incomplete because a `CaptureRun` can produce multiple media files with roles.

Add:

```text
CaptureRun
  └── CaptureRunAsset
        └── Asset
```

### Proposed model

```prisma
enum CaptureAssetRole {
  SCREENSHOT
  VIDEO
  FRAME
  TRACE
  LOG
  OTHER
}

model CaptureRunAsset {
  captureRunId String @db.Uuid
  assetId      String @db.Uuid
  role         CaptureAssetRole
  sequence     Int?
  createdAt    DateTime @default(now())

  captureRun   CaptureRun @relation(fields: [captureRunId], references: [id], onDelete: Restrict)
  asset        Asset      @relation(fields: [assetId], references: [id], onDelete: Restrict)

  @@id([captureRunId, assetId, role])
  @@index([assetId])
}
```

The dedicated `traceAssetId` shortcut on `CaptureRun` becomes unnecessary and should be removed.

---

## 4. Explicit render input lineage

The current draft knows which EditingPlan produced a Render but not the exact binary inputs actually consumed.

That is insufficient for reproducibility.

Add:

```text
Render
  └── RenderInputAsset
        └── Asset
```

### Proposed roles

```text
VOICE
GREEN_SCREEN_VIDEO
PRODUCT_CAPTURE
SCREENSHOT
BROLL
MUSIC
SFX
IMAGE
SUBTITLE_SOURCE
TEMPLATE_ASSET
OTHER
```

### Proposed model

```prisma
enum RenderInputRole {
  VOICE
  GREEN_SCREEN_VIDEO
  PRODUCT_CAPTURE
  SCREENSHOT
  BROLL
  MUSIC
  SFX
  IMAGE
  SUBTITLE_SOURCE
  TEMPLATE_ASSET
  OTHER
}

model RenderInputAsset {
  renderId  String @db.Uuid
  assetId   String @db.Uuid
  role      RenderInputRole
  slotKey   String?
  sequence  Int?
  createdAt DateTime @default(now())

  render Render @relation(fields: [renderId], references: [id], onDelete: Restrict)
  asset  Asset  @relation(fields: [assetId], references: [id], onDelete: Restrict)

  @@id([renderId, assetId, role])
  @@index([assetId])
}
```

This table is frozen when a render is requested so later asset-library changes cannot change history.

---

## 5. Template assets must be pinned

A `TemplateVersion` may depend on logos, icon packs, backgrounds, sounds, fonts or other assets.

Do not reference them only through mutable paths/config.

Add:

```text
TemplateVersion
  └── TemplateVersionAsset
        └── Asset
```

### Proposed model

```prisma
enum TemplateAssetRole {
  LOGO
  FONT
  ICON
  BACKGROUND
  MUSIC
  SFX
  IMAGE
  VIDEO
  OTHER
}

model TemplateVersionAsset {
  templateVersionId String @db.Uuid
  assetId           String @db.Uuid
  role              TemplateAssetRole
  slotKey           String?
  createdAt         DateTime @default(now())

  templateVersion TemplateVersion @relation(fields: [templateVersionId], references: [id], onDelete: Restrict)
  asset           Asset           @relation(fields: [assetId], references: [id], onDelete: Restrict)

  @@id([templateVersionId, assetId, role])
  @@index([assetId])
}
```

---

## 6. Approval model

### Problem in the first draft

The first draft contains both:

```text
subjectType
subjectId
subjectVersionId
```

and explicit optional FKs:

```text
conceptVersionId
renderId
```

These two representations could disagree.

### Proposed V1 decision

Keep **one Approval table**, but make the explicit foreign keys canonical.

Fields:

```text
subjectType
conceptVersionId?
renderId?
decision
reasonCode?
comment?
actorType
actorId?
createdAt
```

Remove generic:

```text
subjectId
subjectVersionId
```

### Integrity rule

Exactly one of:

```text
conceptVersionId
renderId
```

must be non-null, and it must match `subjectType`.

Prisma 7 cannot fully express the desired PostgreSQL CHECK constraint in ordinary schema syntax, so the application layer validates it and the initial migration adds a database CHECK manually.

This is an intentional raw-SQL migration, documented and tested.

---

## 7. Brief snapshot strategy

Keep both:

- relational mutable `Brief` fields for the current editing experience;
- immutable `BriefVersion.payloadJson` snapshots for reproducibility.

A ConceptVersion points to the exact BriefVersion used to produce it.

This duplication is intentional.

It avoids trying to reconstruct old generation context from current mutable Brief fields.

---

## 8. Delete policy

### General rule

Published lineage is protected by `Restrict`.

Use `SetNull` only for genuinely optional contextual references where deleting/archiving the source must not destroy historical data.

In practice, application-level deletion should mostly become archival.

### Never cascade-delete

Do not cascade-delete:

- versions used by downstream content;
- render inputs;
- published renders;
- publications;
- metric snapshots;
- cost entries;
- audit events.

---

## 9. Platform remote ID uniqueness

Keep:

```text
(platformAccountId, remotePostId)
```

unique when the remote ID is known.

PostgreSQL permits multiple rows with NULL `remotePostId`, which is correct before remote publication succeeds.

---

## 10. JSON policy validation

The current Domain Model policy remains correct.

Keep JSON for:

- versioned structured creative payloads;
- timeline plans;
- raw provider responses;
- provider capabilities.

Keep relational columns for:

- state;
- platform;
- schedule;
- canonical IDs;
- PatternVersion;
- TemplateVersion;
- EditingProfileVersion;
- publication and render relations.

---

## 11. Index strategy for V1

Required baseline indexes:

### Scheduler

```text
Publication(status, scheduledAt)
```

### Outbox

```text
OutboxEvent(status, availableAt)
```

### Review queues

```text
Concept(status, createdAt)
Render(status, createdAt)
RecordingRequest(status, createdAt)
```

### Publication analytics

```text
Publication(platformAccountId, publishedAt)
MetricSnapshotRaw(publicationId, collectedAt)
MetricSnapshotNormalized(publicationId, collectedAt)
```

### Operations

```text
WorkflowRun(status, workflowType)
JobAttempt(status, queueName, createdAt)
ModelInvocation(purpose, createdAt)
CostEntry(category, occurredAt)
```

Partial indexes may be considered later from measured query plans; V1 does not depend on preview-only index features.

---

## 12. Workflow-owned enums

Do not freeze placeholder lifecycle strings into the database yet.

The following must be finalized by `04_WORKFLOWS.md` before final Prisma acceptance:

- `BriefStatus`
- `IdeaStatus`
- `ScriptStatus`
- `CreativePlanStatus`
- `EditingPlanStatus`

After the workflow spec is accepted, these become real Prisma enums.

This prevents the schema from dictating workflows before we have designed them.

---

## 13. Relation additions to final draft

The final schema must include back-relations for:

```text
CaptureRunAsset
RenderInputAsset
TemplateVersionAsset
```

and must remove the obsolete direct capture trace shortcut if all capture artifacts are represented through `CaptureRunAsset`.

---

## 14. Prisma validation policy

When implementation bootstrap is eventually authorized:

1. pin Prisma 7;
2. create the real `schema.prisma`;
3. create `prisma.config.ts`;
4. run `prisma format`;
5. run `prisma validate`;
6. generate the first migration with `--create-only`;
7. add the Approval CHECK constraint manually;
8. inspect SQL;
9. only then apply migration to local PostgreSQL.

No `db push` should be used as the authoritative production schema workflow.

---

## 15. Decisions proposed for acceptance

- [x] Prisma 7 pinned for V1.
- [x] UUID v7 canonical IDs.
- [x] Explicit `CaptureRunAsset`.
- [x] Explicit `RenderInputAsset`.
- [x] Explicit `TemplateVersionAsset`.
- [x] Single Approval table with explicit nullable FKs.
- [x] Approval database CHECK added by manual migration.
- [x] Brief + BriefVersion snapshot duplication retained.
- [x] Restrict/archival policy protects historical lineage.
- [x] No preview-only partial-index dependency in V1.
- [x] Workflow spec owns remaining lifecycle enums.
- [x] Prisma Migrate, not `db push`, is authoritative.

Once these are accepted, `03A_PRISMA_SCHEMA_DRAFT.md` can be revised and frozen after the workflow-owned enums are supplied.
