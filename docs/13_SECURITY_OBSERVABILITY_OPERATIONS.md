# 13 — Security, Observability & Operations

**Status:** ACCEPTED  
**Specification version:** spec-v0.14  
**Scope:** Vision Content Engine V1  
**Depends on:** Analytics & Learning ACCEPTED  
**Accepted:** 2026-09-18

---

# 1. Purpose

The Content Engine automates:

```text
AI generation
browser capture
media processing
publishing
analytics collection
```

That means operational correctness matters as much as feature correctness.

V1 must be:

```text
safe to operate
recoverable
observable
auditable
bounded in cost
bounded in side effects
```

---

# 2. Operating model

V1 remains an internal single-user system.

Initial production topology:

```text
Dedicated Content Engine host

containers:
  web
  api
  control
  worker-ai
  worker-capture
  worker-render
  worker-publish
  worker-analytics
  postgres
  redis

external:
  S3-compatible object storage
  AI/provider APIs
  Instagram
  YouTube
  Umami
  Vision event ingest
```

A local Docker Compose environment mirrors the major services for development.

---

# 3. Trust boundaries

Primary trust boundaries:

```text
browser/user
→ web/API

API/workers
→ Postgres

workers/control
→ Redis/BullMQ

workers
→ object storage

AI worker
→ AI providers

capture worker
→ controlled Vision capture environment

publish worker
→ platform APIs

analytics worker
→ platform/Umami APIs

Vision SaaS
→ signed attribution ingest
```

Every external boundary has:

```text
authentication
validation
timeouts
bounded retries
redaction
```

---

# 4. Secrets principle

Secrets are not application data.

Do not store raw secrets in:

```text
Git
docs
job payloads
workflow JSON
logs
AuditEvent metadata
AI prompts
render payloads
CaptureScenario JSON
```

Examples:

```text
OAuth refresh/access tokens
AI API keys
S3 credentials
Vision ingest secret
capture account auth state
database password
Redis password
```

---

# 5. Secret references

Application records store:

```text
credentialsRef
secretRef
authProfileKey
```

where appropriate.

Workers resolve the actual secret at execution time from the configured secret backend/environment.

V1 may use deployment-managed environment secrets / mounted secret files.

The domain must not depend on a specific secrets vendor.

---

# 6. Secret rotation

Every externally scoped credential should support rotation without recreating business entities.

Rotation policy records:

```text
owner
credential purpose
rotation method
lastRotatedAt where known
expiry where known
recovery procedure
```

OAuth token refresh is handled by adapters.

Long-lived static secrets should be rotated on compromise and periodically according to policy.

---

# 7. Environment separation

At minimum:

```text
LOCAL
PRODUCTION
```

Recommended:

```text
LOCAL
STAGING/CAPTURE
PRODUCTION
```

Rules:

```text
separate databases
separate Redis
separate object-storage prefixes/buckets
separate credentials
separate OAuth redirect configuration where possible
```

Never use production customer data as development fixtures.

---

# 8. Single-user authentication

V1 dashboard still requires authentication.

Do not expose the internal dashboard publicly without access control.

Minimum:

```text
authenticated session
secure cookies
CSRF-safe state-changing requests
rate limiting on auth endpoints
```

Exact identity provider remains implementation choice.

No multi-role authorization system is required V1.

---

# 9. Internal service authentication

Sensitive internal endpoints include:

```text
Vision attribution ingest
internal webhook/callback endpoints
possible worker callbacks
```

Use:

```text
HTTPS
HMAC/shared-secret or equivalent service auth
timestamp
replay window
request ID
body hash/signature
```

Reject stale/replayed signed requests.

---

# 10. Input validation

All externally supplied inputs pass:

```text
transport parsing
schema validation
business validation
reference validation
authorization/capability validation
```

Never pass unvalidated user/provider payloads directly into:

```text
Prisma
shell
FFmpeg command construction
browser steps
render components
platform publisher calls
```

---

# 11. Command execution safety

Media/capture workers may launch system processes.

Rules:

```text
no user-controlled shell interpolation
no AI-generated shell
argument arrays instead of shell strings
whitelisted binaries
bounded process timeout
bounded output capture
attempt-scoped working directory
```

FFmpeg/ffprobe execution accepts validated structured parameters only.

---

# 12. Browser automation safety

Capture worker already restricts origins/scenarios.

Operationally also enforce:

```text
dedicated capture credentials
fresh BrowserContext
no arbitrary downloads
no arbitrary file paths
bounded pages
browser process timeout
network restrictions where practical
```

A compromised capture page should not gain host-level access.

---

# 13. Renderer isolation

Render jobs use:

```text
unique temp directory
bounded CPU
bounded memory
bounded disk
bounded render time
```

Worker cleans temporary data after:

```text
success
failure retention window
cancellation
```

No render attempt should be able to consume unbounded disk until the host fails.

---

# 14. Object storage security

Object storage defaults private.

Access patterns:

```text
backend/worker credentials
short-lived signed download/upload URL when needed
temporary Instagram delivery URL lease
```

Rules:

```text
no public bucket
no stable secret URL
no filename-as-authorization
immutable canonical object keys
```

---

# 15. Object integrity

Where practical, Assets store:

```text
size
mime/container
checksumSha256
```

Workers verify checksum for high-value materialization paths.

Do not silently replace bytes under an existing canonical Asset identity.

---

# 16. Database integrity

PostgreSQL is authoritative.

V1 requires:

```text
foreign keys
unique operation identities
restrict historical lineage
transactional outbox
transactions for state transition + outbox enqueue
```

Direct manual production DB edits are exceptional and audit-documented.

---

# 17. Redis/BullMQ role

Redis is not authoritative business storage.

If Redis is lost:

```text
rebuild/requeue recoverable work from Postgres/control process
```

Do not store the only copy of:

```text
schedule
workflow state
publication intent
approved content
```

in Redis.

---

# 18. Transactional outbox operations

Control process repeatedly:

```text
claims pending outbox events
dispatches safely
marks dispatch result
recovers abandoned DISPATCHING state
```

An outbox sweeper detects stuck/failed events.

A failed outbox event feeds Needs Attention after policy threshold.

---

# 19. Job leases and crash recovery

Long-running jobs need recoverable execution ownership.

Conceptual:

```text
JobAttempt RUNNING
worker heartbeat/lease
lease expires
control determines safe recovery
```

Recovery respects side-effect semantics.

Examples:

```text
render → normally safe new attempt
AI call → bounded retry based on invocation state
publish → reconcile before retry if ambiguous
capture mission launch → reconcile before duplicate
```

---

# 20. Health endpoints

API exposes:

```text
/healthz
/readyz
```

### healthz

Process alive.

### readyz

Critical dependencies needed for serving intended API functions are usable.

Worker health is observed separately.

Do not make API readiness depend on every optional external platform API being online.

---

# 21. Worker heartbeat

Each worker runtime emits periodic heartbeat:

```text
workerId
workerType
version
startedAt
lastHeartbeatAt
capacity
activeJobs
```

A missing worker heartbeat is operational state, not a content workflow failure.

---

# 22. Structured logs

All runtime logs are structured JSON in production.

Common fields:

```text
timestamp
level
service
environment
version
requestId
workflowRunId
jobAttemptId
entityType
entityId
operationId
message
errorCode
```

Not every field exists on every log.

---

# 23. Log redaction

Never log:

```text
OAuth token
API key
cookie
storageState
signed delivery URL query secret
database URL/password
raw Authorization header
full secret-bearing provider request
```

Known secret patterns are redacted centrally.

---

# 24. PII minimization in logs

Avoid logging:

```text
email
full user names
raw customer data
arbitrary website form contents
```

unless essential for a diagnostic and explicitly bounded.

Prefer internal IDs.

---

# 25. Correlation identifiers

Critical cross-service IDs:

```text
requestId
workflowRunId
jobAttemptId
modelInvocationId
renderAttemptId
captureRunId
publicationId
publicationAttemptId
operationId
```

Logs should make end-to-end reconstruction possible without searching by human titles.

---

# 26. Metrics

Operational metrics include:

```text
API request latency/error rate
queue depth
oldest queued job age
job success/failure
worker active capacity
outbox pending/failed count
render duration
capture duration
AI invocation latency/cost
publish success/failure/unknown
analytics freshness
object storage failures
DB/Redis connectivity
```

---

# 27. Business-operational metrics

Useful non-infrastructure signals:

```text
concepts awaiting review
recordings waiting
renders awaiting review
publications overdue
TikTok manual handoffs overdue
platform account reauth required
analytics snapshots overdue
```

These feed Dashboard / Needs Attention.

---

# 28. Alert philosophy

Alert only when action is useful.

Avoid:

```text
alert for every failed first attempt
alert for every provider 429
alert on noisy transient issue
```

Alert on:

```text
persistent failure
data loss risk
publication ambiguity
auth broken
backup failure
storage capacity risk
DB unavailable
queue stalled
cost budget breach
```

---

# 29. Severity

Recommended:

```text
INFO
WARNING
CRITICAL
```

### CRITICAL

Examples:

```text
database unavailable
restore integrity risk
object storage inaccessible for approved media
suspected secret compromise
unbounded disk risk
```

### WARNING

Examples:

```text
platform reauth required
repeated render failure
analytics stale
TikTok manual handoff overdue
```

---

# 30. Sentry / error tracking

V1 should use centralized error tracking or equivalent structured exception aggregation.

Required capabilities:

```text
stack traces
release/version
service tag
environment
correlation IDs
breadcrumbs where safe
PII/secrets redaction
```

Exact vendor is implementation choice.

---

# 31. Tracing

Full distributed tracing is optional V1.

Correlation IDs + structured logs are mandatory.

If OpenTelemetry is introduced:

```text
API request
queue dispatch
worker execution
external provider request
```

are useful spans.

Do not delay implementation solely to build perfect tracing.

---

# 32. AuditEvent

AuditEvent is for high-value state/history, not every debug log.

Examples:

```text
Concept approved/rejected
Render approved/rejected
Publication manually confirmed
Platform account connected/reauthorized
Knowledge Snapshot activated
manual analytics snapshot submitted
settings/cost-policy changed
```

---

# 33. Audit immutability

Audit events are append-only.

Corrections create new audit events.

Do not update old audit rows to rewrite operator history.

---

# 34. Cost budgets

AI/provider/render costs are bounded.

V1 configurable budgets:

```text
per AI invocation
per workflow/content item
daily AI budget
daily provider/live-capture budget
optional monthly warning threshold
```

Crossing hard budget may block new expensive work.

Already-approved publishing should not be silently cancelled because unrelated AI budget was reached.

---

# 35. Cost enforcement

Budget check occurs:

```text
before expensive call/job
```

with reservation where needed.

Examples:

```text
AI invocation
live provider capture
large render operation if externally billed
```

CostEntry records observed/estimated actual after completion.

---

# 36. Disk budget

Render/capture host monitors:

```text
free disk
temp workspace total
object cache total
```

Policies:

```text
warning threshold
critical threshold
cleanup
stop accepting heavy jobs before full disk
```

Full disk must not corrupt canonical state.

---

# 37. CPU/memory concurrency

Each worker type has explicit concurrency.

Do not globally run:

```text
all jobs as fast as possible
```

Example policy:

```text
render: low concurrency
capture: low/moderate
AI: moderate, provider-bound
publish: low, side-effect sensitive
analytics: moderate
```

Exact counts depend on host benchmarks.

---

# 38. Backup scope

Canonical backup includes:

```text
PostgreSQL
object storage Assets
configuration/spec repository
secret-recovery documentation
```

Redis is not a canonical backup requirement.

---

# 39. PostgreSQL backup

V1 requires automated database backups.

Minimum conceptual policy:

```text
daily logical/physical backup
off-host copy
retention window
backup success monitoring
periodic restore test
```

Exact tool depends on hosting.

A backup never tested by restore is not considered proven recovery.

---

# 40. Object storage durability

Use provider durability/versioning/backup options appropriate to the chosen S3-compatible backend.

At minimum:

```text
canonical Assets must survive application-host loss
```

Local worker disk is never the only copy of an approved Asset.

---

# 41. Backup encryption

Backups containing:

```text
database
provider metadata
internal analytics
```

should be encrypted in transit and at rest.

Backup credentials are separate from ordinary application credentials where feasible.

---

# 42. Recovery objectives

V1 target objectives are operational goals, not guarantees.

Initial targets:

```text
RPO: <= 24h for database if only daily backup exists
RTO: <= 4h for service restoration under ordinary host failure
```

If stronger backup cadence is configured, actual RPO improves.

These targets must be tested before being advertised internally as achieved.

---

# 43. Restore runbook

Restore order:

```text
1. provision clean host/environment
2. restore Postgres
3. validate schema/version
4. reconnect object storage
5. restore secrets/config
6. start Redis/workers/control/API
7. reconcile outbox/jobs
8. reconcile PUBLISHING_UNKNOWN
9. validate critical Assets
10. resume schedules
```

Do not blindly replay all queues after restore.

---

# 44. Deployment

Initial production uses:

```text
Docker Compose on dedicated host
```

Deployments use pinned images/build versions.

Do not:

```text
git pull && npm install latest && restart
```

as production strategy.

---

# 45. Image/build pinning

Each deployed component records:

```text
git commit
build ID
image digest/tag
Node version
major runtime dependency versions where relevant
```

Render/capture workers additionally pin:

```text
FFmpeg version
Chromium/Playwright version
renderer version
```

---

# 46. Deployment sequence

Recommended:

```text
preflight
DB backup/checkpoint where warranted
pull/build pinned images
run migration step once
start API/control
start workers
health/readiness checks
smoke tests
resume schedules if paused
```

Migrations do not run independently in every replica.

---

# 47. Database migrations

Prisma Migrate remains authoritative.

Production migrations:

```text
reviewed
backward-aware
single controlled execution
logged
```

Destructive migrations require explicit data-migration/backout plan.

---

# 48. Rollback

Application rollback must distinguish:

```text
code rollback
DB rollback
schema forward-fix
```

Do not automatically roll back database migration if newer code wrote data incompatible with old schema.

Preferred:

```text
backward-compatible migrations
then code deploy
```

---

# 49. Release gate

Before production deploy:

```text
tests green
schema migration reviewed
spec compatibility checked
secrets/config present
backup healthy
disk healthy
required external auth capability known
```

---

# 50. Feature flags

Use feature flags for risky integrations/features:

```text
instagram auto-publish
youtube public publish
live-provider capture
new renderer/template version
new analytics adapter
```

A feature flag does not replace versioned domain state.

---

# 51. Kill switches

V1 requires global/operator kill switches:

```text
PAUSE_ALL_PUBLISHING
PAUSE_AI_GENERATION
PAUSE_CAPTURE
PAUSE_RENDERING
PAUSE_ANALYTICS_COLLECTION
```

They block new work of that class.

They do not corrupt or rewrite existing state.

---

# 52. Publishing kill switch

`PAUSE_ALL_PUBLISHING` prevents:

```text
new remote publication attempts
manual handoff readiness dispatch if configured
```

but preserves scheduled Publications.

When re-enabled:

```text
control process recalculates due work safely
```

---

# 53. Incident response

Incident lifecycle:

```text
detect
contain
preserve evidence
recover
reconcile side effects
document
prevent recurrence
```

High-risk incidents:

```text
credential compromise
duplicate publication
database corruption/loss
object loss
runaway cost
wrong account publication
```

---

# 54. Secret compromise runbook

If credential suspected compromised:

```text
pause affected integration
revoke/rotate credential
invalidate sessions/tokens
inspect logs/audit
re-auth platform account
reconcile recent side effects
document incident
```

Do not keep using a suspect token because publishing still works.

---

# 55. Duplicate publication runbook

If duplicate content appears remotely:

```text
pause affected publisher
identify Publication/Attempts
preserve remote IDs
determine ambiguity/retry path
manually remove remote duplicate only if intended
reconcile DB state
fix idempotence/reconciliation bug
```

No automatic mass deletion.

---

# 56. PUBLISHING_UNKNOWN runbook

```text
pause retry for Publication
inspect known remote identifiers
query adapter reconciliation path
classify PUBLISHED / FAILED / still UNKNOWN
only then allow further action
```

---

# 57. Runaway cost runbook

```text
pause AI/live-provider features
inspect CostEntry by workflow/provider
invalidate runaway scheduled jobs if safe
fix policy
resume with lowered caps
```

Do not stop already-started publication side effects blindly.

---

# 58. Queue stall runbook

Detect:

```text
queue depth grows
oldest job age exceeds threshold
workers heartbeat healthy/unhealthy
```

Actions:

```text
inspect worker errors
inspect Redis
inspect dependency
restart worker if safe
recover expired leases
requeue only from canonical DB state
```

---

# 59. Data retention categories

Categories:

```text
business/domain history
approved media
raw provider analytics
diagnostics/logs/traces
temporary render/capture files
AI invocation payloads
audit events
```

Each category has separate retention.

---

# 60. Suggested V1 retention policy

Initial policy:

```text
business/domain lineage:
  indefinite while product active

approved final media:
  indefinite while useful

source recordings/captures:
  180 days default, extend if reused

raw provider analytics:
  provider-policy bounded

normalized analytics:
  long-term if permitted

application logs:
  30 days

error diagnostics:
  30–90 days

Playwright traces:
  failure traces 14 days
  success traces off/short

render/capture temp:
  <= 24h after terminal state

AI raw provider response:
  bounded/configured; minimum metadata retained long-term

AuditEvent:
  long-term
```

Exact retention must respect provider terms and storage budget.

---

# 61. Deletion and archive

Historical published lineage uses archive/restrict semantics.

Deletion tooling must refuse destructive removal when it would invalidate:

```text
published lineage
audit history
exact uploaded media provenance
```

Storage cleanup should understand references before deleting object bytes.

---

# 62. Dependency failure behavior

External providers fail independently.

The system should degrade by capability.

Examples:

```text
Instagram down
→ YouTube/TikTok handoff can still progress

AI provider down
→ existing approved renders/publications continue

Umami down
→ publishing continues, analytics becomes stale

capture environment down
→ affected production waits
```

Avoid one global "system failed" state.

---

# 63. External timeout policy

Every external request has:

```text
connect timeout
request timeout
bounded retry policy
classification
```

Do not use unbounded HTTP waits.

---

# 64. External circuit breaking

Simple V1 circuit-break behavior may be implemented through:

```text
provider failure counters
temporary backoff
kill switch/feature flag
```

A sophisticated service mesh is unnecessary.

---

# 65. Rate limits

Adapters centralize provider rate-limit interpretation.

Use:

```text
provider response headers/data
local request budgets
backoff
queue pacing
```

Do not let each job independently hammer a provider.

---

# 66. Clock correctness

Host time synchronization matters for:

```text
scheduling
signed events
OAuth expiry
analytics windows
audit timestamps
```

Production host must run reliable time synchronization.

All DB/application timestamps are UTC; UI converts for presentation.

---

# 67. Configuration

Non-secret runtime configuration is explicit and validated at startup.

Examples:

```text
environment
base URLs
queue concurrency
budget caps
retention durations
feature flags
provider capability toggles
```

Unknown/missing critical config fails startup.

---

# 68. Configuration schema

Config gets one typed schema.

Do not read arbitrary environment variables throughout the codebase.

Flow:

```text
process env/files
→ config parser
→ validated Config object
→ dependency injection
```

---

# 69. Startup preflight

Each service verifies only what it requires.

Example render worker:

```text
object storage config
FFmpeg/ffprobe
renderer build
temp directory writable
DB/Redis
```

Publish worker:

```text
DB/Redis
secret resolver
enabled platform adapters
```

---

# 70. Maintenance tasks

Control/maintenance includes:

```text
outbox recovery
expired job lease recovery
temp cleanup
orphan Asset detection
analytics freshness scheduling
manual TikTok reminder scheduling
backup health reminder/check
token/account health checks
```

---

# 71. Orphan detection

Detect:

```text
DB Asset without object
object without DB Asset after safety window
temporary object abandoned by crashed attempt
```

Never auto-delete questionable canonical objects immediately.

Quarantine/report first.

---

# 72. Storage lifecycle

Temporary/intermediate objects may use lifecycle expiration.

Canonical approved assets do not rely on blind bucket expiration.

Lifecycle rules must use prefixes/tags that cannot match canonical final media accidentally.

---

# 73. Operational dashboard

System view can show:

```text
DB
Redis
object storage
worker heartbeat
queue depth/age
outbox state
disk
backup health
platform account health
analytics freshness
cost budget
kill switches
```

This remains secondary to creative workflow UX.

---

# 74. Release smoke tests

After deploy:

```text
API health
DB query
Redis enqueue/consume canary
object storage read/write canary
AI gateway schema canary without expensive full workflow
render tiny fixture canary when renderer changed
capture login/navigation canary when capture changed
publisher auth/capability checks without posting
analytics auth checks
```

---

# 75. Backup restore drill

At least periodically:

```text
restore latest backup into isolated environment
run schema checks
run representative reads
verify Asset references
record duration/outcome
```

A failed drill becomes Needs Attention / operational issue.

---

# 76. Production data access

Direct production DB/object access is restricted.

Operator actions should prefer:

```text
dashboard/admin-safe tooling
documented scripts
read-only queries
```

Emergency writes require explicit documentation/audit.

---

# 77. Local developer safety

Local environment:

```text
uses local/staging services
never production publishing credentials by default
publishing adapters disabled by default
capture points to controlled demo environment
```

A developer running tests should not accidentally publish real content.

---

# 78. Test-mode platform adapters

Provide:

```text
fake publisher
fake analytics provider
fake AI provider
fixture capture
fake object storage/local S3
```

for deterministic tests.

Integration tests against real provider APIs are explicitly marked and disabled by default.

---

# 79. Security update discipline

Dependencies with security impact include:

```text
Node
Playwright/Chromium
FFmpeg
Remotion
NestJS
Prisma
Redis/BullMQ
Postgres
```

Updates are deliberate:

```text
review changelog/security impact
test
deploy pinned version
```

Do not auto-update production runtime blindly.

---

# 80. Compliance/third-party terms registry

Maintain operational notes for external dependencies that materially constrain behavior:

```text
TikTok Content Posting policy
YouTube API audit/capability
Instagram permissions/API
AI provider retention
analytics provider terms
Remotion licensing
```

Before activating an integration after a long pause, re-check the current terms.

---

# 81. V1 anti-patterns

Do not:

```text
store secrets in DB JSON/logs/jobs
make S3 bucket public
treat Redis as authoritative
retry ambiguous side effects blindly
deploy latest unpinned dependencies
run all heavy workers at unlimited concurrency
skip restore testing
hide backup failures
use production customer data as fixtures
let local dev have real publishing enabled by default
auto-delete orphan objects immediately
treat logs as audit history
treat AuditEvent as debug log storage
```

---

# 82. Spec artifacts

```text
docs/spec-artifacts/security-operations/
├── deployment-topology.json
├── environment-contract.json
├── backup-policy.json
├── retention-policy.json
├── observability-contract.json
├── kill-switches.json
├── README.md
└── runbooks/
    ├── RESTORE.md
    ├── SECRET_COMPROMISE.md
    ├── PUBLISHING_UNKNOWN.md
    ├── DUPLICATE_PUBLICATION.md
    ├── RUNAWAY_COST.md
    └── QUEUE_STALL.md
```

---

# 83. Acceptance checklist

- [x] production topology accepted.
- [x] trust boundaries accepted.
- [x] secret-reference model accepted.
- [x] environment separation accepted.
- [x] dashboard/internal-service auth accepted.
- [x] command/browser/render isolation accepted.
- [x] private object-storage policy accepted.
- [x] Postgres authoritative / Redis ephemeral accepted.
- [x] outbox/job crash recovery accepted.
- [x] health/readiness/worker heartbeat accepted.
- [x] structured logging/redaction accepted.
- [x] operational metrics/alerts accepted.
- [x] AuditEvent scope accepted.
- [x] cost/disk/concurrency controls accepted.
- [x] backup/RPO/RTO/restore policy accepted.
- [x] pinned Docker Compose deployment accepted.
- [x] migration/rollback policy accepted.
- [x] feature flags/kill switches accepted.
- [x] incident runbooks accepted.
- [x] retention/deletion policy accepted.
- [x] graceful provider degradation accepted.
- [x] startup/config preflight accepted.
- [x] maintenance/orphan detection accepted.
- [x] release smoke/restore drill accepted.
- [x] local developer safety accepted.
- [x] dependency/licensing/terms discipline accepted.

Historical spec-sequencing note — completed:

1. freeze Security / Observability / Operations;
2. proceed to Test Strategy & Acceptance.
