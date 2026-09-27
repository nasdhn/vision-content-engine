# Phase 11A-4B — Durable Concept Generation Worker Report

**Status:** COMPLETE

## Scope

11A-4B implements the minimum durable asynchronous Creator execution path
required before Phase 11 Capture activation.

The tranche includes:

- durable concept-generation request contract;
- immutable BriefVersion snapshot before every request;
- PostgreSQL planner and exact request reconstruction;
- validated Creator output checkpointing;
- checkpoint-first recovery after lease loss;
- atomic ConceptVersion / JobAttempt / WorkflowRun / Brief lifecycle;
- canonical `ai` / `AI` lease-backed worker;
- `worker-ai` polled runtime and heartbeat lifecycle.

## Canonical execution identity

The generation execution identity remains:

- queue name: `ai`;
- job type: `AI`;
- workflow type: `CONCEPT_GENERATION`;
- recovery policy: `SAFE_RETRY`;
- canonical state: PostgreSQL;
- execution fencing: JobAttempt lease token.

No new canonical BullMQ generation payload is introduced.

## Recovery guarantee

A successful validated provider output is durably checkpointed before
business result application.

If the worker loses its lease after provider success but before
ConceptVersion persistence, a later worker:

1. reclaims the expired safe-retry job;
2. reads and validates the durable checkpoint;
3. applies that checkpoint under the new lease;
4. does not call the provider again.

PostgreSQL integration evidence verifies:

- one provider call;
- one ModelInvocation;
- one ModelInvocationAttempt;
- no second cost;
- eventual ConceptVersion persistence;
- eventual JobAttempt success.

## Business lifecycle

Success atomically produces:

- ConceptVersion candidate(s);
- ModelInvocation application;
- JobAttempt `SUCCEEDED`;
- WorkflowRun `WAITING`;
- WorkflowRun step `concept_review`;
- Brief `ACTIVE`.

Terminal generation failure atomically produces:

- JobAttempt `FAILED`;
- WorkflowRun `FAILED`;
- Brief restored to `READY`.

The human concept review remains mandatory.

## Runtime lifecycle

The generation worker uses the existing polled-worker lifecycle for
`worker-ai`.

Shutdown drains active `processOne()` work before heartbeat removal and
rejects new work once closing has started.

## Schema and dependencies

11A-4B introduces:

- no Prisma schema change;
- no migration;
- no new package dependency;
- no lockfile change.

## Provider and cost side effects

No real provider call is executed by 11A-4B implementation or closure.

Persistent local state remains fail-closed:

- `VCE_ENV=LOCAL`;
- `VCE_REAL_PROVIDERS_ENABLED=false`;
- `PAUSE_AI_GENERATION=true`.

The earlier reviewed real Groq canary remains the only real-provider
evidence for Generation.

## Implementation lineage

11A generation lineage before this closure:

- `4fcb50a3bc1769fa3a2af33af9275dc5e46de864`
  — reviewed real-provider activation gate;
- `fbf742b9759454870b209e00a9380d2dc604b22b`
  — Groq generation adapter;
- `c1d6c78a830dcc3899d755d7c1ee34bba8f2e5e3`
  — explicit Groq canary harness;
- `4687c635ffc08e532fa876d02ef01de8a15accaf`
  — real canary evidence;
- `165a3f5d209fcc0d7c0b1a548de467f6e2fa8192`
  — fail-closed normal generation composition.

11A-4B is committed by the closure commit containing this report.

## Rollback

11A-4B is code-only.

Rollback is the Git revert of the closure commit. No database migration
or external provider rollback is required.

Existing durable rows created by tests are isolated test data and do not
change production schema.

## Next phase

Phase 11 Capture activation is **NOT STARTED** by this closure.

The frozen Phase 11 order remains:

1. generation — implemented through 11A-4B;
2. capture — next;
3. rendering;
4. human review;
5. TikTok manual handoff;
6. YouTube private/test upload;
7. controlled Instagram auto-publish;
8. YouTube public auto-publish after capability gate;
9. analytics automation;
10. weekly learning.
