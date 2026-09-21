# 16 — Implementation Plan

**Status:** ACCEPTED FOR HANDOFF PREPARATION  
**Specification version:** spec-v0.16 reconciled  
**Implementation authorization:** NOT YET — wait for spec-v1.0

## Operating rule

Each phase is a bounded implementation tranche:

```text
INSPECT
→ compare code/repo state with canonical spec
→ propose exact plan
→ implement only current phase
→ tests
→ diff / migration / evidence summary
→ STOP
```

Codex must not silently begin the next phase.

## Phase 0 — Bootstrap & repository

- pnpm workspace;
- exact canonical apps/packages structure;
- TypeScript strict;
- config schema;
- Docker Compose local dependencies;
- lint/typecheck/test harness;
- Prisma format/validate/generate;
- inspect initial migration SQL before applying;
- fake provider infrastructure.

## Phase 1 — Canonical domain & persistence

- final Prisma schema;
- manual SQL constraints from final reconciliation;
- migrations;
- repositories/transactions;
- immutable-version services;
- approval gates;
- outbox;
- workflow/job attempts;
- audit/cost;
- domain/state-machine tests.

## Phase 2 — Knowledge, Pattern Library & AI gateway

- DB-backed KnowledgeSnapshot;
- SourceReference;
- repository Prompt Registry;
- Pattern seeds/selector;
- AIProviderGateway;
- ModelInvocation + ModelInvocationAttempt;
- Creator;
- Creative Director;
- claims/reference validation;
- deterministic fixtures and budgets.

## Phase 3 — Assets & Recording Pack

- private object storage;
- Asset ingest/probe/checksum;
- RecordingRequest/Recording;
- upload flows;
- Recording Pack UI;
- technical validation.

## Phase 4 — Product Capture

- controlled capture account/environment;
- scenario registry;
- Playwright worker;
- fixture manager;
- five seed scenarios;
- trace/failure diagnostics;
- safety tests.

## Phase 5 — Editing Intelligence & Video Engine

- EditingProfile seeds;
- EditingPlan validation;
- exact asset selection;
- renderer abstraction;
- Remotion templates;
- FFmpeg/ffprobe;
- HDR→SDR;
- captions/audio/chroma;
- technical QA;
- Creative QA invocation linkage;
- media regression fixtures.

## Phase 6 — Human-gate Dashboard

Implement in this order:

```text
shell + Needs Attention
Concept review
Production + Recording Pack
Final Review
Calendar / Published
Assets / Patterns / Templates
Settings
```

No extra mandatory script gate.

## Phase 7 — Distribution

- Publication scheduler/control;
- exact mediaAssetId;
- AssetDerivation;
- Instagram automated adapter;
- YouTube resumable adapter + public capability gate;
- TikTok manual handoff;
- PUBLISHING_UNKNOWN reconciliation;
- token/account health;
- fake-provider safety tests.

## Phase 8 — Analytics & Attribution

- raw snapshots;
- normalizers;
- collection windows;
- TikTok manual metrics;
- Umami adapter;
- signed Vision event ingest;
- trackingCode;
- DIRECT/INFERRED/UNKNOWN attribution;
- typed revenue;
- analytics UI.

## Phase 9 — Learning loop

- evidence/comparability engine;
- Experiment analysis;
- Analyst;
- Insight/Recommendation;
- weekly report;
- next-test proposal flow.

No autonomous strategy mutation.

## Phase 10 — Security / Operations hardening

- auth;
- secret resolver;
- structured/redacted logs;
- heartbeats/queue age;
- cost/disk/concurrency limits;
- backups;
- restore drill;
- kill switches;
- runbooks;
- release smoke tests.

## Phase 11 — Progressive production enablement

Enable in order:

```text
1. generation
2. capture
3. rendering
4. human review
5. TikTok manual handoff
6. YouTube private/test upload
7. controlled Instagram auto-publish
8. YouTube public auto-publish after capability gate
9. analytics automation
10. weekly learning
```

## Inspection-first rules

Before modifying a phase, Codex must:

1. inspect current Git status/HEAD;
2. read canonical spec files for that phase;
3. inspect existing code/tests/migrations;
4. identify conflicts or pre-existing implementation;
5. state exact files expected to change;
6. preserve unrelated behavior.

No speculative refactor outside current phase.

## Stop conditions

STOP and report instead of inventing a decision when:

- code contradicts canonical spec in a way not safely resolvable;
- a destructive migration/data loss risk appears;
- a required provider capability/policy/licence is unavailable or changed;
- a secret/credential would need to be exposed or committed;
- a remote side effect is ambiguous;
- a release-blocking invariant fails unexpectedly;
- required fixture/test evidence cannot be produced;
- implementation would require changing an accepted product decision.

## Phase completion report

Every phase ends with:

```text
Git status / HEAD
files changed
schema/migrations
tests run + results
known limitations
provider/cost side effects
rollback notes
next phase NOT started
```

---

## Phase 5 amendment — structured blocker closure

Before Phase 5 is considered complete, Editing Intelligence must represent an impossible edit as
a first-class `BLOCKED` result, persist it without creating a fake EditingPlanVersion, preserve
exact ModelInvocation lineage, and resolve/supersede blocker state deterministically.
