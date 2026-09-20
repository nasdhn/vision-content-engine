# Canonical persistence — Phase 1

`createDatabaseClient(connectionString)` creates the pinned Prisma 7.10.0 PostgreSQL adapter
with UTC sessions and no query logging. Application writes go through `Persistence.transaction`
and `Leases`. The raw Prisma export is a trusted infrastructure/fixture boundary, not an HTTP API.
Database credentials and SQL administrator access can bypass application rules; no extra immutable
triggers or changed deletion policies have been added to the frozen schema.

`Persistence.transaction(actor, callback)` provides a `UnitOfWork`. The callback must perform
only database work, never a provider call or enqueue. Errors roll back the complete transaction;
callbacks are not automatically retried. Creation of content versions and gate decisions records
AuditEvent and OutboxEvent rows in the same transaction. CostEntry preserves Decimal(18,8) amounts.

`unit.versions` appends Brief, Concept, Script, CreativePlan, EditingPlan, Pattern, Template,
EditingProfile and CaptureScenario versions. Root-row locks serialize version allocation;
existing versions have no update/delete/upsert API. Inputs accept scalar version data and exact
foreign keys only, never nested writes. A concept revision resets the root to DRAFT unless an
explicit exact-version selection is awaiting review. In that case the selected review stays pinned;
the new version still requires its own approval. Prior approved versions retain their historical evidence.
Phase 2 adds Knowledge/SourceReference curation, pattern seed import and AI invocation accounting.
See [the Phase 2 application boundary](../application/README.md) for usage and safety semantics.

`submitConcept(versionId)` and `decideConcept(versionId, decision)` remain implicit latest-version
flows: historical IDs fail with STALE_VERSION. A trusted USER can instead call
`selectConceptVersionForReview(versionId)` to deliberately submit an exact version, including a
historical one, from DRAFT or an existing implicit AWAITING_REVIEW. It returns a durable selectionId.
`decideSelectedConcept(selectionId, decision)` resolves that persisted subject without accepting a
replacement version ID. Pending explicit review cannot be overwritten by another selection or
decided through the implicit API. Creating newer versions never invalidates the pending selection.

Approval requires a terminal decision in the existing schema, so submission does not fabricate an
Approval. AuditEvent records `Concept.versionSelectedForReview` with the exact subjectVersionId.
The final decision creates the ordinary Approval bound to that same ConceptVersion and records
`ConceptReviewSelection.decided`, linked to the selection and approval IDs. Selection consumption,
Approval, root state, audit and outbox are atomic. Concept row locks serialize submissions, revisions
and decisions; competing/replayed decisions cannot consume a selection twice. Pending selection
lookup uses identity and consumption rather than transaction timestamps. No schema change or
generic stale-check bypass is involved. Raw SQL/admin access remains the trusted boundary above.

Only USER actors with a nonempty identity can decide ConceptVersion and Render approvals.
The caller must supply a trusted authenticated identity; authentication wiring belongs to a later
phase. There is no script or CreativePlan approval gate. Render approval binds a successful
attempt's exact output Asset. Publication creation persists DRAFT only and validates its approved
master or direct platform derivative. It performs no scheduling, upload or publication.

`Leases(client, config, policies)` takes explicit typed durations and per-job recovery policies.
QUEUED jobs can be claimed; expired RUNNING jobs are eligible for takeover only for job types
explicitly configured SAFE_RETRY. RECONCILE, MANUAL and unspecified policies do not automatically
recover. This layer does not decide whether a remote effect happened. In particular,
PUBLISHING_UNKNOWN still requires reconciliation, regardless of lease expiration.

Claims use transactional FOR UPDATE SKIP LOCKED and a fresh UUID. Heartbeats and job finalization
check current state, current token and unexpired PostgreSQL time after the row lock is acquired.
An old or missing owner receives STALE_LEASE. `finishJob` optionally persists the job result through
a UnitOfWork inside the same transaction; expiry is checked again at finalization, so rejection
rolls back the result, cost, audit and outbox together. Its callback is database-only.
Last lease metadata is retained on terminal rows. No polling worker or Redis dependency runs here.

Outbox heartbeat requires an unexpired current token. Outbox finalization requires the current
token and DISPATCHING state, exactly as amendment 21 specifies. Takeover rotates that token.
`outboxDelivery(event)` exposes the stable event ID as deduplicationKey for the future transport;
it is not a transport implementation or a promise of exactly-once social publishing.

The immutable canonical spec remains spec-v1.0.2. SQL contains the reviewed 50-table schema,
the six accepted CHECKs and the one ACTIVE KnowledgeSnapshot partial unique index. Raw Prisma
schema diff does not describe manual CHECKs; real PostgreSQL contract tests verify them.

## Local validation

Use Node 24.21.0 and pnpm 10.34.5, then:

```sh
pnpm install --frozen-lockfile
pnpm prisma:generate
pnpm infra:up
pnpm db:migrate:local
pnpm check:phase1
```

`db:migrate:local` permits only LOCAL loopback `vision_content_engine`, uses migrate deploy and
never resets data. Review SQL before executing it. `test:postgres` creates a uniquely named local
test database, deploys the migration, tests actual constraints/concurrency and drops only that owned
database. It needs local CREATEDB privileges. It never truncates the application database.

For code rollback, revert the Phase 1 commit. That does not undo the applied database migration.
No destructive down migration is provided. Preserve any later data and use an explicitly reviewed
forward migration or restore a pre-migration backup; never reset an occupied database automatically.
