# 02 — System Architecture

**Status:** ACCEPTED  
**Specification version:** spec-v0.2  
**Scope:** Vision Content Engine V1  
**Accepted:** 2026-09-18

---

## 1. Purpose

This document defines the V1 system architecture of the Vision Content Engine.

The architecture must support the complete path:

`Brief → Concepts → Creative Production → Recording/Capture → Editing → Render → Review → Schedule → Publish → Measure → Learn`

The system is first an **internal tool for Vision**, not a generic multi-tenant SaaS.

The architecture must optimize for:

- high creative quality;
- reliability;
- traceability;
- modularity;
- safe automation;
- ability to scale individual workloads independently;
- simple operations at current volume;
- no coupling that would endanger the production Vision SaaS.

---

## 2. Architectural principles

### 2.1 PostgreSQL is the source of truth

Business state lives in PostgreSQL.

Redis/BullMQ is an execution mechanism, not the canonical business database.

If PostgreSQL says a publication is `SCHEDULED` and Redis loses a queued job, the system must be able to recover and enqueue the work again.

### 2.2 AI proposes; deterministic code executes

LLMs may:

- generate concepts;
- create hooks and scripts;
- propose creative plans;
- propose editing plans;
- analyze results;
- make recommendations.

LLMs may not directly:

- mutate arbitrary workflow states;
- publish content;
- handle OAuth credentials;
- decide whether a technical render is valid;
- manage retries;
- own scheduling;
- execute destructive browser actions;
- bypass human approval rules.

Every AI output that affects the pipeline must be validated against a versioned schema.

### 2.3 Long-running work is asynchronous

The public API must not perform long-running operations such as:

- AI batch generation;
- Playwright capture;
- video rendering;
- platform upload;
- analytics synchronization.

The API creates or modifies canonical state and requests asynchronous work.

### 2.4 Workers are replaceable executors

Workers do not own business truth.

A worker receives identifiers, reloads canonical state from PostgreSQL, verifies preconditions, performs one bounded responsibility, persists the result, and records the next transition.

### 2.5 Heavy media workloads are isolated

Rendering, Chromium capture and media processing must never block the user-facing API.

They run in separate processes/containers and may later move to dedicated machines without changing domain logic.

### 2.6 Everything important is traceable

A published post must remain traceable to:

- campaign / brief;
- source idea;
- selected pattern;
- concept version;
- script version;
- creative plan version;
- editing plan;
- template version;
- source assets;
- render;
- approval;
- publication;
- metrics;
- experiment hypothesis.

### 2.7 V1 stays operationally simple

V1 does not use:

- Kubernetes;
- Temporal;
- Kafka;
- independent microservices with separate databases;
- event sourcing;
- multi-region infrastructure.

The system is a modular monorepo with several independently deployable processes.

---

## 3. High-level topology

```text
                           ┌─────────────────────────┐
                           │      Web Dashboard      │
                           │     React / TypeScript  │
                           └────────────┬────────────┘
                                        │ HTTPS
                                        ▼
                           ┌─────────────────────────┐
                           │        NestJS API       │
                           │  auth / commands / read │
                           └────────────┬────────────┘
                                        │
                  ┌─────────────────────┼─────────────────────┐
                  │                     │                     │
                  ▼                     ▼                     ▼
        ┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐
        │   PostgreSQL    │   │ Redis / BullMQ  │   │ Object Storage  │
        │ source of truth │   │ execution queues│   │  S3-compatible  │
        └────────┬────────┘   └────────┬────────┘   └────────┬────────┘
                 │                     │                     │
                 │            ┌────────┼───────────────┐     │
                 │            │        │        │      │     │
                 │            ▼        ▼        ▼      ▼     │
                 │        AI Worker  Capture  Render  Publish │
                 │                    Worker   Worker  Worker │
                 │                       │        │       │   │
                 │                       ▼        ▼       ▼   │
                 │                  Playwright  Remotion Social APIs
                 │                              FFmpeg
                 │
                 │                                  ┌─────────────┐
                 └─────────────────────────────────►│ Analytics   │
                                                    │ Worker      │
                                                    └──────┬──────┘
                                                           │
                                                           ▼
                                                    Platform APIs
```

A small control process is also responsible for:

- transactional outbox dispatch;
- due-schedule scanning;
- reconciliation jobs;
- housekeeping.

---

## 4. Repository topology

The project uses one Git repository and one TypeScript monorepo.

Recommended package manager: **pnpm workspaces**.

No build orchestrator such as Turborepo is required for V1 unless build times justify it later.

Target structure:

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
│
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
│
├── prisma/
├── docs/
├── infra/
├── scripts/
└── tests/
```

### `packages/domain`

Pure domain rules and types.

Must not depend on:

- NestJS controllers;
- HTTP;
- Redis;
- platform SDKs;
- React.

### `packages/application`

Use cases and workflow transitions.

Examples:

- approve concept;
- request render;
- approve render;
- schedule publication;
- record publication success;
- record analytics snapshot.

Both the API and workers must reuse the same application-layer rules.

### `packages/contracts`

Versioned Zod contracts shared between:

- API;
- workers;
- AI outputs;
- queue payloads;
- frontend when appropriate.

### `packages/database`

Prisma client, repositories and transaction helpers.

### Specialized packages

`ai`, `media`, `publishing`, `analytics` contain provider interfaces and reusable implementations without putting business decisions in adapters.

---

## 5. Runtime components

## 5.1 Web Dashboard

Responsibilities:

- display campaigns and briefs;
- show concepts;
- upload recordings/assets;
- monitor production;
- review final videos;
- batch approve/reject;
- calendar;
- published content;
- analytics;
- operational errors.

The browser never:

- talks directly to Redis;
- talks directly to PostgreSQL;
- holds social platform secrets;
- publishes directly to platforms.

It communicates only with the API.

---

## 5.2 API

Technology target:

- Node.js 24 LTS;
- NestJS;
- TypeScript strict mode.

Responsibilities:

- authenticated HTTP API;
- synchronous validation;
- CRUD for human-facing objects;
- command handling;
- read models;
- approvals/rejections;
- asset upload initialization;
- workflow state transitions that are triggered by the user.

The API must return quickly.

It must not wait for media rendering, external social upload or long AI generation.

---

## 5.3 PostgreSQL

PostgreSQL owns canonical business state.

It stores:

- content lineage;
- immutable versions;
- workflow states;
- approvals;
- schedules;
- remote publication identifiers;
- analytics metadata;
- experiment metadata;
- AI invocation metadata;
- cost ledger;
- audit trail;
- outbox events.

Binary video/audio/image files do not live in PostgreSQL.

---

## 5.4 Redis + BullMQ

Redis is used for asynchronous execution.

BullMQ queues are execution queues, not business history.

Initial logical queues:

```text
ai
capture
render
publish
analytics
maintenance
```

Jobs should carry minimal data, normally identifiers and an operation key, not large business documents.

Example:

```json
{
  "operationId": "uuid",
  "workflowRunId": "uuid",
  "entityId": "uuid",
  "entityVersion": 4
}
```

The worker reloads the current canonical object from PostgreSQL before execution.

---

## 5.5 Control process

`apps/control` runs non-HTTP coordination responsibilities.

V1 responsibilities:

- transactional outbox dispatcher;
- publication schedule scanner;
- reconciliation scheduler;
- periodic analytics sync scheduling;
- stalled workflow detection;
- housekeeping.

It is a separate process so API restarts do not interrupt orchestration duties.

Multiple replicas must be safe through database locking / leases.

---

## 5.6 AI Worker

Responsibilities:

- Creator execution;
- Creative Director execution;
- Editing Intelligence planning where AI reasoning is used;
- Creative semantic QA where applicable;
- Analyst execution.

All calls go through a centralized `AIProviderGateway`.

Direct provider SDK calls from random feature modules are forbidden.

Every model invocation stores at minimum:

- purpose;
- provider;
- model;
- prompt/version;
- input schema version;
- output schema version;
- token usage when available;
- monetary cost when calculable;
- latency;
- success/failure;
- associated content identifiers.

---

## 5.7 Capture Worker

Runs Playwright in an isolated process/container.

Responsibilities:

- open the approved Vision demo/staging target;
- authenticate with a dedicated account;
- execute a whitelisted capture scenario;
- wait on deterministic assertions;
- capture screenshots and/or video;
- upload outputs to object storage;
- persist capture metadata.

It must not improvise navigation from free-form LLM commands at execution time.

The executable input is a validated `CaptureScenario`.

---

## 5.8 Render Worker

The render worker is CPU/RAM intensive and isolated from the API.

Responsibilities:

- fetch immutable input assets;
- validate the requested template/version;
- build a deterministic composition;
- render with Remotion;
- normalize/transcode with FFmpeg when required;
- inspect output with ffprobe;
- generate technical QA results;
- upload final and diagnostic artifacts;
- persist render metadata.

The same inputs and versions should be sufficient to reproduce a render as closely as practical.

---

## 5.9 Publish Worker

Responsibilities:

- platform-specific upload;
- platform metadata;
- publish/status polling;
- retryable platform failures;
- remote ID persistence;
- idempotency/reconciliation;
- platform/account rate-limit compliance.

Platform adapters:

```text
TikTokPublisher
InstagramPublisher
YouTubePublisher
```

No platform-specific behavior leaks into generic content-domain rules.

---

## 5.10 Analytics Worker

Responsibilities:

- poll supported platform analytics;
- store raw snapshots;
- normalize supported metrics;
- update measurement windows;
- trigger analysis eligibility when enough data exists.

It must preserve the distinction:

`unknown != 0`

---

## 6. Synchronous vs asynchronous boundaries

### Synchronous

Use synchronous HTTP/API execution for:

- login;
- reading dashboard data;
- creating/editing a brief;
- selecting concepts;
- editing metadata;
- human approval/rejection;
- requesting upload URLs;
- scheduling commands.

### Asynchronous

Always asynchronous:

- batch AI generation;
- product capture;
- rendering;
- large media processing;
- social publication;
- publication reconciliation;
- analytics polling;
- weekly analysis.

---

## 7. Transactional Outbox

A database commit and queue enqueue must not be treated as one atomic operation because PostgreSQL and Redis are different systems.

Therefore V1 uses a transactional outbox.

Example:

```text
BEGIN

update render request state
insert outbox_event(RENDER_REQUESTED)

COMMIT
```

The control process later dispatches `RENDER_REQUESTED` to BullMQ.

After a successful enqueue it marks the outbox event as dispatched.

Requirements:

- dispatcher can safely retry;
- duplicate dispatch is tolerated;
- consumers are idempotent;
- outbox rows retain enough audit data to diagnose failures.

The outbox makes PostgreSQL the authoritative recovery point.

---

## 8. Idempotency

The architecture assumes queue delivery and external calls can be retried.

Every side-effecting operation must have an application-level `operationId` or deterministic idempotency key.

Examples:

- render request;
- product capture;
- platform publication;
- analytics snapshot import.

A worker receiving the same operation twice must either:

1. return the already completed result; or
2. safely continue from canonical state.

For platform publication, if the remote result is uncertain, the system must use a reconciliation state rather than blindly retrying and risking duplicate posts.

Required publication state includes a form of:

```text
PUBLISHING_UNKNOWN
```

or equivalent domain representation.

---

## 9. Retry policy

Errors are classified.

### Transient

Examples:

- temporary network failure;
- provider 5xx;
- platform 429;
- temporary object-storage failure.

Policy:

- automatic retry;
- exponential/fixed backoff as appropriate;
- bounded attempts;
- rate-limit-aware delays.

### Permanent / validation

Examples:

- invalid platform permission;
- malformed creative plan;
- unavailable required asset;
- rejected media format after deterministic validation.

Policy:

- no blind retry;
- mark workflow as needing attention;
- expose actionable reason in dashboard.

### Unknown side-effect result

Example:

platform may have accepted upload but client lost the response.

Policy:

- do not immediately create a second post;
- reconcile remote state;
- require human attention if identity cannot be determined safely.

---

## 10. Rate limiting

BullMQ may enforce queue-level limits, but platform/account-specific policies belong to the publishing layer.

Do not design V1 around deprecated/removed per-group queue semantics.

Publisher rate limiting must support keys such as:

```text
platform + account
```

The implementation may use Redis counters/token buckets plus platform response data.

A `429` response may dynamically delay further jobs for that platform/account.

---

## 11. Scheduling

PostgreSQL stores the canonical schedule:

```text
scheduledAt
publicationState
platformAccountId
```

The system does not rely exclusively on a delayed Redis job as the only representation of a future publication.

The control process scans due scheduled publications using a lease/locking mechanism and emits publication requests.

Initial scheduling precision target:

- minute-level is sufficient for V1.

If the control process is down temporarily, due posts remain recoverable from PostgreSQL when it restarts.

---

## 12. Object storage

All large binary media uses an S3-compatible object-storage abstraction.

Development:

- local S3-compatible service such as MinIO is acceptable.

Production:

- provider remains replaceable;
- exact vendor is a deployment decision, not a domain dependency.

Stored media includes:

- uploaded voice recordings;
- raw green-screen clips;
- screenshots;
- screen recordings;
- music/sound assets;
- template assets;
- capture outputs;
- intermediate diagnostic artifacts when retained;
- rendered masters;
- platform-specific derivatives if required.

Database rows store metadata and object keys, not large binaries.

Uploads/downloads should use time-limited signed URLs where practical.

Assets required to reproduce published media must not be silently overwritten.

---

## 13. Media immutability and versioning

Once a media asset is referenced by an approved/published render, its identity is immutable.

A modified asset becomes a new asset/version.

The following are versioned:

- script;
- creative plan;
- editing plan;
- pattern;
- template;
- prompt;
- relevant AI contract;
- render configuration.

This allows historical analytics to refer to what was actually published.

---

## 14. AI provider boundary

A centralized provider gateway exposes capabilities such as:

```text
generateStructured()
analyzeStructured()
analyzeMedia()      # only if required later
```

The domain never depends on a provider-specific response object.

Provider selection is configuration/policy.

Fallback behavior must be explicit.

A fallback model may not silently produce an output using a different schema or quality mode.

---

## 15. Vision product integration

The Content Engine is a separate repository and deployment from the Vision SaaS.

V1 integration principles:

- no direct mutation of Vision production database;
- no Content Engine worker inside the Vision production backend;
- no shared filesystem;
- no production admin cookies copied into workers.

Product demonstrations should target:

1. a dedicated demo/staging environment when possible;
2. a dedicated demo account;
3. known scenario data;
4. safe, non-destructive workflows.

If a production environment must ever be used for a read-only capture, that exception requires a separate documented decision and stricter safeguards.

---

## 16. Playwright execution boundary

Playwright capture runs only from the capture worker.

The API can request a capture but cannot execute browser automation directly.

A capture scenario contains deterministic steps such as:

- navigate;
- click known selector;
- enter approved text;
- wait for known state;
- scroll;
- capture frame;
- begin/end recording.

The worker stores:

- scenario version;
- target environment;
- browser/runtime version;
- timestamps;
- screenshots/video;
- failure trace where useful.

This makes failed captures diagnosable and successful ones reproducible.

---

## 17. Rendering boundary

The renderer consumes validated structured input.

It must not ask a LLM arbitrary questions in the middle of frame rendering.

The rendering path is:

```text
CreativePlan
+ EditingPlan
+ TemplateVersion
+ Assets
      ↓
composition input validation
      ↓
Remotion render
      ↓
FFmpeg/ffprobe validation
      ↓
technical QA
      ↓
stored master
```

Any AI-assisted editing decision occurs before deterministic rendering and is persisted in the EditingPlan.

---

## 18. Publishing boundary

A publication record exists before a remote post is created.

It contains the canonical intended:

- platform;
- account;
- media;
- metadata;
- scheduled time;
- state;
- operation id.

A platform adapter translates the canonical publication into platform-specific calls.

The worker records:

- attempt;
- response classification;
- remote platform ID when known;
- timestamps;
- retry/reconciliation data.

---

## 19. Analytics boundary

Raw platform data is preserved separately from normalized data.

The system must not pretend platform metrics are equivalent when definitions differ.

Architecture:

```text
Platform response
      ↓
RawMetricSnapshot
      ↓
platform normalizer
      ↓
NormalizedMetricSnapshot
      ↓
analysis eligibility
      ↓
Analyst
```

The Analyst never rewrites raw measurement history.

---

## 20. Authentication and authorization boundary

V1 is single-operator/internal.

The architecture should still require authenticated access.

Multi-tenant RBAC is explicitly out of scope.

Platform OAuth credentials and refresh tokens are server-side secrets and are never exposed to the web client.

Exact V1 login mechanism is finalized in the security specification, not here.

---

## 21. Networking

Production principles:

- public internet exposes only reverse proxy / web / API endpoints;
- PostgreSQL is not publicly exposed;
- Redis is not publicly exposed;
- worker processes have no public inbound endpoint unless explicitly required;
- internal services communicate over private/container networking;
- capture/render workers have outbound network access only as needed;
- platform/AI credentials are injected at runtime.

---

## 22. Development topology

Initial local development on macOS:

```text
host:
  web
  api
  worker processes during development

docker compose:
  postgres
  redis
  minio (or compatible local object storage)
```

Media-heavy dependencies may run in containers when reproducibility requires it.

The project must not depend on a developer-specific absolute path.

Environment templates use `.env.example`; real `.env` files remain untracked.

---

## 23. Production topology V1

The Content Engine must not share the Vision production application host as a requirement.

Initial production may use one dedicated Content Engine machine with separate containers/processes:

```text
content-engine-host
  reverse-proxy
  web
  api
  control
  postgres
  redis
  ai-worker
  publish-worker
  analytics-worker
  capture-worker
  render-worker
```

This is acceptable at initial low volume because logical isolation already exists.

However:

- render and capture containers must have explicit resource limits;
- API must remain responsive during media work;
- database backups are mandatory;
- media lives in object storage, not only local disk.

---

## 24. Scale-out path

No architectural rewrite should be required for the first scale step.

Expected evolution:

### Stage A — current V1 volume

One dedicated Content Engine host.

### Stage B — media separation

Move:

- render worker;
- capture worker

to one or more dedicated compute hosts.

API/DB/Redis remain on the control host.

### Stage C — worker horizontal scaling

Run multiple instances of:

- render worker;
- capture worker;
- analytics worker;
- publish worker where safe.

BullMQ distributes jobs.

### Stage D — managed infrastructure if justified

Possible later changes:

- managed PostgreSQL;
- managed Redis;
- dedicated object store;
- autoscaled rendering infrastructure.

Kubernetes/Temporal are considered only after measured operational need.

---

## 25. Failure scenarios the architecture must survive

### API restarts

Queued/background work continues or is recoverable.

### Redis temporary outage

Canonical requested work remains represented in PostgreSQL/outbox and can be redispatched.

### Worker crash during render

Job can retry without corrupting canonical state or producing ambiguous duplicate records.

### Control process restart

Due schedules and pending outbox events are rediscovered.

### Object-storage temporary outage

Transient operation retries; no workflow is falsely marked successful.

### Social API timeout after upload

Publication enters reconciliation/unknown state instead of blind duplicate upload.

### Playwright scenario changes/breaks

Capture fails with diagnostics and does not silently produce invalid media.

### AI malformed output

Schema validation rejects it; no downstream state transition consumes malformed data.

---

## 26. Queue payload rules

Queue payloads must:

- be versioned;
- be small;
- contain identifiers instead of large documents;
- contain no secrets;
- contain no raw binary media;
- be safe to log after redaction policy.

Example envelope:

```json
{
  "schemaVersion": 1,
  "jobType": "RENDER_VIDEO",
  "operationId": "uuid",
  "workflowRunId": "uuid",
  "entityId": "uuid",
  "requestedAt": "ISO-8601"
}
```

---

## 27. Observability hooks

Every process emits structured logs.

Correlation fields where relevant:

```text
requestId
workflowRunId
campaignId
conceptId
captureRunId
renderId
publicationId
operationId
jobId
```

The architecture must make it possible to answer:

- Why was this video generated?
- Which inputs produced it?
- Which job failed?
- Was it retried?
- Which remote post corresponds to it?
- Which metrics came back?
- How much did the generation cost?

Detailed observability tools are finalized in the observability specification.

---

## 28. Technology baseline

V1 baseline:

```text
Runtime:        Node.js 24 LTS
Language:       TypeScript (strict)
Frontend:       React + Vite
Backend:        NestJS
ORM:            Prisma
Database:       PostgreSQL
Queue:          BullMQ
Queue backend:  Redis
Contracts:      Zod
Browser:        Playwright / Chromium
Video:          Remotion
Media tools:    FFmpeg + ffprobe
Storage:        S3-compatible object storage
Packaging:      pnpm workspaces
Deployment:     Docker / Docker Compose initially
```

Exact dependency versions are pinned by lockfile when implementation begins.

---

## 29. Explicit non-decisions

This architecture does **not** yet freeze:

- exact Prisma schema;
- exact table names;
- exact AI model/provider;
- production object-storage vendor;
- exact authentication UI/mechanism;
- exact reverse proxy;
- exact cloud/VPS provider;
- exact render concurrency values;
- exact retry counts;
- exact platform polling intervals.

Those belong to later specs or deployment configuration.

The architecture does freeze the boundaries that those choices must respect.

---

## 30. Architecture acceptance criteria

Final acceptance criteria — all satisfied:

- [x] Content Engine remains a separate repository from Vision.
- [x] PostgreSQL is canonical business state.
- [x] Redis/BullMQ is execution infrastructure, not source of truth.
- [x] Transactional outbox is part of V1.
- [x] Long-running work is asynchronous.
- [x] API, control process and heavy workers are logically separated.
- [x] Capture, render, publish and analytics have separate worker boundaries.
- [x] Rendering and capture can move to separate hosts without domain rewrite.
- [x] Object storage owns binary media.
- [x] AI calls are centralized behind a gateway.
- [x] AI outputs are schema validated.
- [x] Playwright executes validated scenarios, not free navigation.
- [x] Publication is idempotency/reconciliation aware.
- [x] Canonical schedules live in PostgreSQL.
- [x] Raw and normalized analytics are distinct.
- [x] Initial deployment may use Docker Compose on one dedicated Content Engine host.
- [x] No Kubernetes/Temporal/microservice-database split in V1.

Historical freeze actions — completed:

1. mark this document `ACCEPTED`;
2. record new ADRs where needed;
3. update `SPEC_FREEZE_CHECKLIST.md`;
4. commit as `docs: freeze V1 system architecture`;
5. start `03_DOMAIN_MODEL.md`.

---

## 31. Consequence for the next specification

The Domain Model must now define entities capable of representing:

- immutable lineage;
- workflow state;
- outbox events;
- operation/idempotency keys;
- schedules;
- capture runs;
- render attempts;
- publication attempts;
- raw/normalized metrics;
- AI invocations;
- audit events;
- costs.

No database schema should be created before that domain specification is validated.
