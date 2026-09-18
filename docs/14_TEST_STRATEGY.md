# 14 — Test Strategy & Acceptance

**Status:** ACCEPTED  
**Specification version:** spec-v0.15  
**Scope:** Vision Content Engine V1  
**Depends on:** Security / Observability / Operations ACCEPTED  
**Accepted:** 2026-09-18

---

# 1. Purpose

The objective of testing is not merely:

```text
"the code compiles"
```

It is to prove that the Content Engine can safely move content through:

```text
Brief
→ Concept
→ Production
→ Capture/Recording
→ Editing
→ Render
→ Review
→ Distribution
→ Analytics
→ Learning
```

without:

```text
silent lineage corruption
duplicate external side effects
unsafe retries
untraceable media
platform-policy drift
unbounded cost
regressions in media quality
```

---

# 2. Test philosophy

V1 uses a layered strategy:

```text
static validation
unit tests
domain/state-machine tests
contract tests
database tests
integration tests
media tests
workflow/E2E tests
failure/recovery tests
provider sandbox tests
operational acceptance drills
```

No single layer is sufficient.

---

# 3. Testing pyramid

Preferred order by volume:

```text
many:
  pure unit/domain tests

moderate:
  DB/integration/contract tests

few but critical:
  workflow E2E
  real-provider smoke tests
  restore/recovery drills
```

Do not move business logic into E2E tests merely because it is easier to observe there.

---

# 4. CI execution tiers

## Tier 0 — Static

Every change:

```text
format/lint
TypeScript
schema/spec artifact validation
Prisma validation
forbidden-secret scan
```

## Tier 1 — Fast deterministic

Every PR/change:

```text
unit
domain
state machines
AI contract validation
normalizers
mappers
selector logic
timeline validators
publisher retry classifiers
```

## Tier 2 — Integration

Every PR/change when affected:

```text
Postgres
Redis/BullMQ
S3-compatible test storage
fake AI
fake publishers
fake analytics
Remotion fixture render
Playwright fixture capture
```

## Tier 3 — Full workflow

Required before production release of material workflow changes.

## Tier 4 — External/provider smoke

Explicit/manual or scheduled, never required for every local run.

## Tier 5 — Operational drills

Periodic:

```text
backup restore
queue recovery
publishing reconciliation
secret rotation
kill switch
```

---

# 5. Determinism principle

Tests should control:

```text
clock
UUID/operation ID generation where needed
randomness
provider fixtures
AI responses
browser fixtures
media assets
configuration
timezone
```

The default test suite must not depend on:

```text
real social feeds
real AI creativity
live third-party search
internet timing
uncontrolled production data
```

---

# 6. Time control

Scheduling, analytics windows and retry/backoff require a controllable clock.

Application code should depend on an injectable:

```ts
interface Clock {
  now(): Date;
}
```

Tests advance virtual/fake time.

Do not scatter direct `new Date()` business decisions throughout the codebase.

---

# 7. ID control

Production uses UUIDv7.

Tests normally assert:

```text
identity uniqueness
reference integrity
ordering semantics only where actually guaranteed
```

Do not snapshot random UUID values.

Where deterministic fixture IDs improve readability, use fixed valid UUID fixture constants.

---

# 8. Randomness

Any exploration policy/randomized selection must accept a deterministic RNG/seed in tests.

Example:

```text
Pattern exploration
→ deterministic test seed
```

Do not make CI flaky because creative exploration uses uncontrolled randomness.

---

# 9. Schema/spec artifact tests

All canonical spec artifacts must be machine-validated.

Examples:

```text
JSON parses
required files exist
seed keys unique
profile references exist
motion keys exist
template-supported keys exist
CaptureScenario locators conform
distribution adapter schemas conform
analytics metric definitions conform
```

This catches documentation/spec drift before app code exists.

---

# 10. Zod contract tests

For every production-facing Zod contract:

```text
valid canonical fixture passes
missing required field fails
unknown forbidden field fails where strict
invalid enum fails
invalid reference fails at business-validation layer
boundary values tested
```

Do not only test happy-path parsing.

---

# 11. Domain model tests

Critical invariants include:

```text
immutable version lineage
no hard-delete of published lineage
Approval targets exactly one allowed entity
Publication exact media Asset
Experiment arms reference intended versions
AssetDerivation source/derived integrity
Attribution uniqueness
```

---

# 12. State-machine tests

Every accepted state machine gets exhaustive transition tests.

At minimum:

```text
all allowed transitions succeed
all forbidden transitions fail
terminal states stay terminal where required
recovery paths are explicit
human gates cannot be bypassed accidentally
```

---

# 13. Workflow tests

High-value workflow examples:

### Happy path

```text
Brief
→ Concepts
→ Concept approval
→ Script/CreativePlan
→ Capture/Recording
→ EditingPlan
→ Render
→ technical QA
→ creative QA
→ final approval
→ schedule
→ publication
→ analytics
```

### Human recording path

```text
Concept approval
→ WAITING_FOR_INPUTS
→ RecordingRequest
→ upload valid take
→ accepted recording
→ production resumes
```

### Failure path

```text
render fails transiently
→ new attempt
→ same Render
→ succeeds
```

---

# 14. Database tests

Use real PostgreSQL for persistence tests.

Must cover:

```text
FK constraints
unique constraints
partial/compound uniqueness
Restrict deletes
nullable lifecycle FKs
outbox transaction atomicity
Publication.mediaAssetId
AssetDerivation uniqueness
AttributionEvent source idempotence
trackingCode uniqueness
```

Do not rely on SQLite as a substitute.

---

# 15. Migration tests

Every migration is tested against:

```text
empty DB
representative previous schema state
representative seeded data
```

Checks:

```text
migration applies
Prisma client/schema valid
critical data remains readable
new constraints do not invalidate expected data
```

Destructive migrations require an explicit data-migration test.

---

# 16. Transactional outbox tests

Critical cases:

```text
business transaction commits + outbox commits
business transaction rollback → no outbox
dispatcher crash after send before mark
stuck DISPATCHING recovery
duplicate dispatch idempotence
```

---

# 17. Job lease tests

Cases:

```text
normal heartbeat
worker dies
lease expires
safe job recovered
unsafe side-effect job requires reconciliation
cancelled job not resurrected
```

---

# 18. AI gateway tests

Default tests use a fake deterministic AI provider.

Cover:

```text
valid structured response
invalid JSON/schema
reference to nonexistent ID
forbidden claim
timeout
provider error
fallback model
retry budget exhausted
cost budget block
ModelInvocation persisted correctly
```

Do not assert exact prose unless prose is itself the fixture under test.

---

# 19. AI contract golden fixtures

Each AI capability maintains representative input/output fixture pairs.

Purpose:

```text
contract compatibility
reference validation
business-rule validation
claim validation
```

Not:

```text
"this exact wording is always best"
```

Golden fixtures evolve through explicit review.

---

# 20. Claim safety tests

Examples:

```text
unsourced numerical claim rejected
forbidden claim rejected
verified claim ID accepted
claim references preserved into output lineage
```

---

# 21. Pattern selector tests

Cover:

```text
hard incompatibility exclusion
requires proof but no proof available
human-presenter requirement
fatigue/repetition constraints
exploration mode with deterministic seed
no opaque universal pattern score
```

---

# 22. EditingPlan validation tests

Hard invariants:

```text
all Asset IDs exist
timing inside master
end > start
source trim valid
normalized rectangle valid
motion preset exists
chroma profile exists
template slot supported
caption timing valid
presenter/product collision detected
caption/proof collision policy enforced
```

---

# 23. Editing Intelligence fixture tests

Use controlled:

```text
script
asset summaries
transcript timing
visual moments
EditingProfile
Template
```

Assert structural/editorial requirements such as:

```text
hook begins early
proof appears within allowed policy
voice is not cut mid-word
unknown Asset not referenced
```

Do not require one unique "perfect edit".

---

# 24. Media fixture library

Maintain tiny deterministic fixtures:

```text
SDR portrait video
HDR/HLG fixture where practical
green-screen presenter
voice-only audio
music
silent audio
black video
rotated phone video
corrupt file
short product capture
```

Keep fixtures small enough for CI.

---

# 25. Media technical tests

Cover:

```text
ffprobe parsing
rotation normalization
HDR detection
SDR conversion policy
codec profile
audio profile
chroma profile
source trim
caption render
font resolution
missing Asset
checksum mismatch
```

---

# 26. Render reproducibility test

The renderer reproducibility acceptance target is functional, not byte-for-byte across all environments.

For the same pinned fixture:

```text
duration within frame tolerance
same dimensions/fps
same key layout positions
same major scene boundaries
same text/captions
same media references
same color/audio profile
```

---

# 27. Visual regression

Use selected frame snapshots or perceptual comparison.

Rules:

```text
fixed renderer build
fixed fonts
fixed fixture media
fixed frame timestamps
```

Use tolerances for anti-aliasing/codec differences.

Do not make pixel-perfect video encode bytes the acceptance criterion.

---

# 28. Audio regression

Check:

```text
audio exists where required
voice audible
duration aligned
loudness profile within tolerance
true peak ceiling
no catastrophic silence
music ducking where applicable
```

---

# 29. Technical QA tests

Each stable failure code gets a fixture where practical:

```text
INPUT_ASSET_MISSING
INPUT_PROBE_FAILED
INPUT_COLOR_PROFILE_UNSUPPORTED
HDR_NORMALIZATION_FAILED
TEMPLATE_CONTRACT_FAILED
ASSET_TRIM_INVALID
PRESET_UNKNOWN
COLLISION_VALIDATION_FAILED
REMOTION_RENDER_FAILED
FFMPEG_FAILED
OUTPUT_PROBE_FAILED
TECHNICAL_QA_FAILED
```

Stable code is asserted, not fragile free-text wording.

---

# 30. Product Capture tests

Playwright tests use a controlled fixture app/environment.

Cover:

```text
fresh BrowserContext
auth state load
allowed origin
blocked origin
stable locator
semantic wait
screenshot
video
mark moment timestamp
trace-on-failure
timeout
popup/download restrictions
```

---

# 31. Capture scenario contract tests

Every seed CaptureScenario:

```text
parses
references known browser/safety profiles
uses allowed DSL steps
contains required output specs
does not contain secret values
does not use arbitrary JS/CSS unless explicitly allowed
```

---

# 32. Capture end-to-end fixture

At least one CI path:

```text
open fixture Vision-like page
fill query
start deterministic mock mission
wait semantic done state
capture screenshot/video
probe output
assert marked moment
```

No real provider cost.

---

# 33. Dashboard tests

Critical UI behavior:

```text
Concept approval
Concept rejection
Render review
structured rejection
Recording Pack upload
Needs Attention action
PUBLISHING_UNKNOWN has reconcile, no naive retry
NULL analytics displays unavailable, not 0
refresh/deep link preserves object context
```

---

# 34. Accessibility tests

Automated baseline plus manual spot checks:

```text
semantic buttons
labels
focus visibility
keyboard navigation
review actions
status not color-only
video controls reachable
```

Playwright locators should benefit from the same accessible contracts.

---

# 35. Distribution adapter contract tests

Use fake provider servers.

Instagram:

```text
create container
poll processing
publish
remote ID
timeout before publish
ambiguous after publish
auth expired
rate limit
```

YouTube:

```text
start resumable upload
resume after interruption
remote video ID
processing state
audit/public-capability blocked
ambiguous final response
```

TikTok:

```text
manual package generated
READY_FOR_MANUAL_PUBLISH
manual confirmation
remotePostId optional
```

---

# 36. No duplicate publication acceptance

Critical safety test:

Simulate:

```text
provider accepts publish
worker loses response
```

Expected:

```text
Publication → PUBLISHING_UNKNOWN
no second create/upload call
reconcile
```

This is a release-blocking invariant.

---

# 37. Scheduler tests

Cover:

```text
due publication exactly once
future publication not dispatched
cancelled publication not dispatched
kill switch prevents dispatch
DST boundary
Europe/Paris UI display vs UTC canonical timestamp
resume after pause
```

---

# 38. Platform-account tests

Cover:

```text
ACTIVE
REAUTH_REQUIRED
DISABLED
ERROR
scope/capability loss
token refresh
credential missing
```

Secrets never appear in snapshot/log assertions.

---

# 39. Analytics normalizer tests

For each provider fixture:

```text
raw preserved
known field mapped
unsupported field → NULL
observed zero → 0
semantic version attached
provider-specific extra metric preserved where allowed
```

---

# 40. Attribution tests

Cover:

```text
DIRECT trackingCode
INFERRED platform/referrer
UNKNOWN
duplicate externalEventId rejected
REVENUE typed amount/currency
no double count across repeated ingest
```

---

# 41. EvidencePolicy tests

Examples:

```text
single publication cannot yield general FAIRLY_SOLID
incompatible measurement windows rejected for direct comparison
incompatible metric semantics flagged
outlier dominance lowers confidence/raises limitation
```

Do not test "AI agrees with the recommendation"; test the enforced evidence inputs/limits.

---

# 42. Analyst tests

Use deterministic fake Analyst output + validator.

Verify every Insight has:

```text
confidence
evidence IDs
window
limitations
```

Verify every Recommendation has:

```text
testable hypothesis
change
constants
metric
window
```

---

# 43. Security tests

At minimum:

```text
unauthenticated dashboard/API denied
internal signed event bad signature denied
replayed signed event denied
expired signed event denied
forbidden origin capture denied
path traversal denied
secret redaction
signed URL bounded
shell injection impossible through structured process args
```

---

# 44. Secret scanning

CI scans:

```text
repository
generated fixtures
docs/spec artifacts
```

for common credential patterns.

False-positive suppression is explicit/reviewed.

---

# 45. Logging tests

Representative tests ensure:

```text
Authorization header redacted
OAuth token redacted
signed URL secret redacted
correlation IDs present
stable error code present
```

---

# 46. Cost-budget tests

Simulate:

```text
under budget
near budget
hard budget exceeded
reservation released after failure
retry cannot bypass budget
```

---

# 47. Kill-switch tests

For each switch:

```text
new affected work blocked
unaffected workflow still operates
canonical state unchanged
resume works safely
```

---

# 48. Recovery tests

High-value failure injection:

```text
API crash after DB commit
worker crash during render
worker crash after object upload
Redis flush
outbox dispatcher crash
publish response lost
analytics provider outage
```

Expected recovery comes from canonical DB/object state.

---

# 49. Redis-loss acceptance

Test:

```text
create canonical queued intent
lose Redis
restart Redis/control
recover/re-dispatch safe work from Postgres
```

No workflow is considered irretrievably lost merely because Redis was lost.

---

# 50. Object-storage failure tests

Cover:

```text
temporary read failure
temporary upload failure
missing canonical object
checksum mismatch
orphan temp object
```

Missing approved canonical object is CRITICAL / release-blocking operational issue.

---

# 51. Backup restore acceptance

Periodic drill:

```text
restore DB to isolated environment
connect copied/test object storage
validate schema
sample lineage
sample approved Asset reference
recover control state without external side effects
```

Record:

```text
duration
backup age
errors
result
```

---

# 52. Performance targets

Initial V1 performance tests focus on bottlenecks, not arbitrary benchmark vanity.

Measure:

```text
dashboard/API common reads
Concept review list
Review queue
queue dispatch overhead
AI workflow orchestration
capture execution
render execution
analytics import
```

Heavy media throughput target is derived from expected ~3 original videos/day, not mass-scale SaaS assumptions.

---

# 53. Load safety

Test that bursty creation does not result in:

```text
unbounded render concurrency
unbounded capture concurrency
unbounded AI calls
provider hammering
disk exhaustion
```

Queue depth may grow; resource bounds must hold.

---

# 54. Expected V1 throughput acceptance

The architecture should comfortably support:

```text
~3 original videos/day
~9 publication events/day
~90 originals/month
~270 publication events/month
```

with headroom on the intended host.

This is not a promise of real-time rendering.

---

# 55. Test data principle

Use clearly synthetic fixture data.

Do not place:

```text
real customer names
real emails
real OAuth tokens
real analytics identities
```

inside repository test fixtures.

---

# 56. Golden fixture review

When a golden media/UI/contract fixture changes:

```text
generate diff/report
review intended change
update fixture explicitly
```

Do not auto-accept snapshots in CI.

---

# 57. Provider real-smoke policy

Real external provider smoke tests:

```text
disabled by default
explicit credentials
explicit environment flag
non-destructive where possible
documented rate/cost
```

Publishing smoke tests should prefer:

```text
private/test account
private YouTube upload
Instagram test capability where available
```

TikTok remains manual V1.

---

# 58. Production smoke tests

After deploy:

```text
API/DB/Redis/S3 canary
worker heartbeat
fake queue job
provider auth/capability check without posting
analytics auth check
small render fixture if renderer changed
capture canary if capture changed
```

---

# 59. Release-blocking invariants

A release is blocked if any of these fail:

```text
Prisma validation/migrations
workflow state-machine tests
human approval gate enforcement
Publication exact-media lineage
PUBLISHING_UNKNOWN duplicate-prevention
transactional outbox atomicity
render technical QA
capture origin/safety contract
secret redaction/auth
kill switches
analytics NULL semantics
attribution deduplication
```

---

# 60. Release acceptance matrix

Every release categorizes affected subsystems:

```text
DOMAIN
AI
MEDIA
CAPTURE
DASHBOARD
DISTRIBUTION
ANALYTICS
OPERATIONS
```

Only required gates for affected subsystems run at heavyweight levels, while universal safety gates always run.

---

# 61. Manual acceptance checklist

Before first production enablement:

```text
Concept review feels usable
Recording Pack instructions are understandable
render quality acceptable on real phone
captions readable
product proof readable
Instagram auth connected
YouTube capability known
TikTok handoff understandable
schedule timezone correct
Needs Attention actionable
backup success visible
kill switches operable
```

---

# 62. First-production shadow mode

Recommended first deployment phase:

```text
generate
capture
render
review
schedule
```

but:

```text
Instagram auto-publish OFF
YouTube public auto-publish OFF
```

Use manual/controlled confirmation until:

```text
provider adapters
media
schedules
reconciliation
```

are proven.

Then enable platform automation via feature flags.

---

# 63. Progressive enablement

Recommended order:

```text
1. internal content generation
2. product capture
3. render
4. human review
5. TikTok manual handoff
6. YouTube private/test uploads
7. Instagram controlled auto-publish
8. YouTube public auto-publish after capability gate
9. analytics automation
10. weekly learning
```

This reduces blast radius.

---

# 64. Definition of Done — feature

A feature is done when:

```text
code implemented
contract tests pass
failure modes covered
observability exists
secrets handled
migration included if needed
docs/runbook updated where needed
acceptance criteria demonstrated
```

Not merely when the happy path works locally.

---

# 65. Definition of Done — workflow

A workflow is done when:

```text
success path works
safe retry works
permanent failure is visible
crash recovery works
operator action is clear
no duplicate external side effect
lineage is reconstructable
```

---

# 66. Definition of Done — media

Media path is done when:

```text
input probe
normalization
render
output probe
technical QA
object upload
lineage
review
```

are covered by deterministic fixtures and at least one real-device visual review.

---

# 67. Definition of Done — provider adapter

Adapter is done when:

```text
auth
capability
happy path
rate limit
transient error
permanent error
ambiguous response
reconciliation
token expiry
logging/redaction
```

are demonstrated.

---

# 68. Spec conformance tests

Implementation must include a test that verifies canonical seed/spec artifacts can be loaded by the implementation contracts.

This detects drift between:

```text
docs/spec-artifacts
and
application schemas
```

until spec artifacts are promoted/copied into runtime packages during implementation.

---

# 69. Test repository structure

Recommended:

```text
tests/
├── unit/
├── domain/
├── contracts/
├── database/
├── integration/
├── workflows/
├── media/
├── capture/
├── distribution/
├── analytics/
├── security/
├── e2e/
└── fixtures/
```

Package-local unit tests may also live next to source.

---

# 70. CI artifact retention

On failed heavyweight tests, retain bounded artifacts:

```text
test logs
Playwright trace
failure screenshot
render QA report
sample failed output where safe
```

Do not publish secrets or unrestricted media publicly from CI.

---

# 71. Flaky test policy

A flaky test is a defect.

Allowed temporary quarantine requires:

```text
owner
reason
issue reference
expiry/review date
```

Do not normalize rerunning CI until it passes.

---

# 72. Test timeout policy

Every async/integration/E2E test has explicit timeout.

No infinite polling.

Use semantic waits and fake clocks where possible.

---

# 73. Test cost policy

Default CI must not incur significant provider cost.

Real provider/AI paid tests are:

```text
explicit
budgeted
tagged
off by default
```

---

# 74. Acceptance evidence

For first V1 production readiness, preserve an acceptance report containing:

```text
commit/build
migration version
test matrix result
provider capability state
backup/restore status
known limitations
feature flags
manual acceptance notes
```

---

# 75. Known V1 acceptance limitations

The following remain intentionally limited:

```text
TikTok posting manual
TikTok analytics manual
YouTube public automation gated by API project capability/audit
single-user dashboard
no autonomous strategy mutation
no generic external trend crawler
```

They are not test failures.

---

# 76. Spec artifacts

```text
docs/spec-artifacts/test-strategy/
├── test-tiers.json
├── release-blocking-invariants.json
├── acceptance-matrix.json
├── fixture-policy.json
├── provider-smoke-policy.json
├── README.md
└── fixtures/
    └── FIXTURE_CATALOG.md
```

---

# 77. Acceptance checklist

- [x] layered test strategy accepted.
- [x] deterministic clock/ID/randomness policy accepted.
- [x] spec artifact validation accepted.
- [x] domain/state-machine/database testing accepted.
- [x] transactional outbox and lease recovery testing accepted.
- [x] AI gateway/contract fixtures accepted.
- [x] EditingPlan/media regression policy accepted.
- [x] capture safety/E2E fixture accepted.
- [x] dashboard/accessibility testing accepted.
- [x] distribution ambiguity/duplicate-prevention testing accepted.
- [x] analytics/attribution/evidence tests accepted.
- [x] security/redaction/cost/kill-switch testing accepted.
- [x] Redis/object-storage/recovery testing accepted.
- [x] backup restore drill accepted.
- [x] throughput/load-safety target accepted.
- [x] real-provider smoke-test policy accepted.
- [x] release-blocking invariant list accepted.
- [x] shadow mode/progressive enablement accepted.
- [x] Definitions of Done accepted.
- [x] acceptance report accepted.

Next:

1. freeze Test Strategy & Acceptance;
2. perform final specification reconciliation;
3. resolve remaining schema/contract debt;
4. freeze `spec-v1.0`;
5. produce Codex Master Handoff.
