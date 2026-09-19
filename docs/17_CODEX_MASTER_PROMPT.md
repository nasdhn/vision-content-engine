# 17 — Codex Master Prompt

**Status:** FINAL — `spec-v1.0`  
**Purpose:** implementation handoff for Vision Content Engine V1  
**Default authorization:** Phase 0 only  
**Do not silently continue into Phase 1 or later.**

---

# 1. Mission

You are implementing the **Vision Content Engine**, an internal proprietary organic-content operating system for Vision.

Vision Content Engine transforms:

```text
Brief / ideas / reusable marketing patterns
→ concepts
→ scripts + creative plans
→ recordings / controlled product captures
→ editing plans
→ rendered short-form videos
→ human final review
→ Instagram / YouTube distribution
→ TikTok manual handoff
→ analytics
→ business attribution
→ learning / recommendations
```

The system is **not** a generic social-media SaaS in V1.

The user is the creative director / final reviewer, not the manual operator of every queue/job.

---

# 2. First rule: inspect before coding

Before modifying anything:

```text
1. git status
2. git rev-parse --short HEAD
3. git describe --tags --exact-match HEAD if available
4. inspect repository tree
5. read the canonical V1 spec files listed below
6. inspect any existing source/config/tests/migrations
7. compare current repo state with the requested Phase 0 scope
8. report conflicts before implementation
```

Do not assume the repository is empty.

Do not overwrite existing valid work merely because the spec contains a preferred structure.

Do not begin implementation until the inspection is complete.

---

# 3. Canonical specification precedence

When two documents appear to disagree, use this order:

```text
1. docs/19_SPEC_V1_FINAL_VALIDATION.md
2. docs/18_FINAL_RECONCILIATION.md
3. docs/spec-artifacts/schema.prisma
4. current accepted domain-specific specs
5. docs/DECISIONS.md + accepted ADRs
6. historical 03A/03B Prisma design records
```

Historical `03A_*` and `03B_*` documents explain design evolution but are not final field-level implementation authority.

Process notes such as:

```text
"After acceptance"
"Next"
"proceed to..."
```

inside older accepted specs are historical sequencing notes, not instructions for you to ignore this prompt.

---

# 4. Read these files before Phase 0 implementation

At minimum read:

```text
docs/00_PROJECT_CHARTER.md
docs/01_PRODUCT_SCOPE_V1.md
docs/02_SYSTEM_ARCHITECTURE.md
docs/03_DOMAIN_MODEL.md
docs/04_WORKFLOWS.md
docs/05_AI_CONTRACTS.md
docs/06_PATTERN_LIBRARY_SPEC.md
docs/07_EDITING_INTELLIGENCE.md
docs/08_VIDEO_ENGINE.md
docs/09_PRODUCT_CAPTURE_PLAYWRIGHT.md
docs/10_DASHBOARD_UX.md
docs/11_DISTRIBUTION.md
docs/12_ANALYTICS_LEARNING.md
docs/13_SECURITY_OBSERVABILITY_OPERATIONS.md
docs/14_TEST_STRATEGY.md
docs/15_REPOSITORY_CONVENTIONS.md
docs/16_IMPLEMENTATION_PLAN.md
docs/18_FINAL_RECONCILIATION.md
docs/19_SPEC_V1_FINAL_VALIDATION.md
docs/DECISIONS.md
docs/SPEC_FREEZE_CHECKLIST.md
docs/SPEC_STATUS.md
```

Also inspect:

```text
docs/spec-artifacts/
docs/adr/
```

Do not cherry-pick one spec and ignore the others.

---

# 5. Product decisions you may not silently change

V1 remains:

```text
internal mono-user Vision tool
France-first
~3 original videos/day
TikTok + Instagram Reels + YouTube Shorts
real human voice preferred
human raw recordings when useful
no generic AI avatar
no default AI voice
two mandatory human gates:
  1. ConceptVersion approval
  2. final Render approval
```

No mandatory script approval gate.

No mandatory CreativePlan approval gate.

No automatic strategy mutation from analytics.

No multi-user/team/billing system.

No Kubernetes, Temporal or Kafka in V1.

---

# 6. Architecture you must preserve

Canonical topology:

```text
apps/
  web
  api
  control
  worker-ai
  worker-capture
  worker-render
  worker-publish
  worker-analytics

packages/
  domain
  application
  contracts
  database
  ai
  media
  publishing
  analytics
  observability
  shared
```

Core stack:

```text
Node.js 24 LTS target
TypeScript strict
React + Vite
NestJS
Prisma / PostgreSQL
Redis + BullMQ
Zod
Playwright / Chromium
Remotion
FFmpeg / ffprobe
S3-compatible object storage
pnpm workspaces
Docker / Docker Compose
```

Important:

```text
PostgreSQL = authoritative business state
Redis/BullMQ = execution infrastructure only
S3-compatible object storage = canonical binary media
transactional outbox = V1 requirement
```

---

# 7. Deterministic workflow rule

The product is not:

```text
"many autonomous agents deciding everything"
```

It is:

```text
deterministic workflow engine
+ specialized AI capabilities
+ explicit human gates
```

Use AI where ambiguity/creativity exists.

Use deterministic software where a rule exists.

No free-roaming AI browser.

No LLM call during Remotion frame rendering.

No AI-generated shell / FFmpeg command strings.

---

# 8. Canonical immutable content lineage

Preserve exact version lineage:

```text
Publication
→ Render
→ EditingPlanVersion
→ CreativePlanVersion
→ ScriptVersion
→ ConceptVersion
→ PatternVersion? / BriefVersion
→ Campaign
```

Important final reconciliation decisions:

```text
ScriptVersion.conceptVersionId
CreativePlanVersion.templateVersionId
CreativePlanVersion.editingProfileVersionId
```

are required exact relationships.

Do not replace them with root IDs, names, keys, JSON hints or "latest version".

---

# 9. Knowledge / AI provenance

Production AI calls use:

```text
KnowledgeSnapshot
→ immutable DB-backed snapshot
```

Every ModelInvocation pins the exact KnowledgeSnapshot.

Prompt Registry V1 is:

```text
immutable repository artifacts
```

Every ModelInvocation stores exact:

```text
promptKey
promptVersion
promptContentHash
input/output schema versions
```

AI execution model:

```text
ModelInvocation
  └── ModelInvocationAttempt 1
  └── ModelInvocationAttempt 2
  └── ...
```

Do not collapse retries/fallbacks into one fake provider/model record.

---

# 10. Claims / SourceReference

`SourceReference` is first-class V1 provenance.

Verified claims must reference valid SourceReference IDs.

Automatic web Researcher/crawler is **not** part of V1.

Do not invent external claims because a content idea would sound stronger with them.

---

# 11. Media rules

Editing Intelligence decides **how to edit**.

Renderer executes a persisted EditingPlan deterministically.

Master media:

```text
1080x1920
9:16
clean/no platform watermark
SDR BT.709 social master
```

HDR / HLG / Dolby Vision source handling:

```text
safe deterministic tone-map to SDR
or
explicit failure
```

Never strip HDR signaling while leaving HDR pixels untreated.

Exact fonts/template assets/profile versions are pinned.

---

# 12. Product capture rules

Playwright executes known immutable CaptureScenarioVersion definitions.

It must not:

```text
freely explore Vision
use customer data
rely on long sleeps as readiness
use networkidle as business readiness
navigate arbitrary third-party origins
```

Use:

```text
fresh BrowserContext per run
controlled capture account/environment
stable locators
semantic assertions
bounded DSL
fixture-first demos
```

---

# 13. Distribution policy — do not "improve" this silently

V1:

```text
Instagram Reels
→ API_AUTOMATED

YouTube Shorts
→ API_AUTOMATED only when account/API capability gate permits public publishing

TikTok
→ MANUAL_HANDOFF
```

Do **not** implement TikTok browser automation as a workaround.

Do **not** turn TikTok Direct Post on for the private internal tool unless the specification is explicitly amended after a fresh platform-policy review.

Every Publication has explicit:

```text
deliveryMode
mediaAssetId
trackingCode
```

No default delivery mode.

---

# 14. Publication safety

Never blindly retry an ambiguous external side effect.

Critical state:

```text
PUBLISHING_UNKNOWN
```

means:

```text
remote side effect may have happened
→ reconcile
→ only retry when absence/safety is established
```

A lost HTTP response after successful remote publish must never produce a duplicate post.

This is release-blocking.

---

# 15. Analytics rules

Separate:

```text
raw provider/manual observation
→ normalized metrics
→ attribution events
```

Mandatory semantics:

```text
NULL = unavailable / unsupported / not observed
0    = observed zero
```

Do not silently treat platform metrics as universally comparable.

Canonical units:

```text
avgWatchPercentage = 0..100
completionRate      = 0..1
```

Business interpretation priority:

```text
customer
activation
signup
website visit
platform retention/engagement
views
```

Do not produce one fake universal engagement score.

---

# 16. Attribution rules

Confidence:

```text
DIRECT
INFERRED
UNKNOWN
```

Do not turn INFERRED into deterministic truth.

Attribution events use:

```text
AttributionSourceSystem
externalEventId
```

for idempotence.

Revenue uses typed:

```text
valueAmountMinor
valueCurrency
```

Prefer opaque identity IDs; do not copy unnecessary PII.

---

# 17. Learning rules

Analyst may create:

```text
Insight
Recommendation
```

but does not autonomously mutate:

```text
Pattern
EditingProfile
Template
prompt defaults
publishing cadence
CTA policy
strategy
```

Recommendations should become explicit experiments/tests.

Do not claim causality from uncontrolled correlations.

---

# 18. Security / operations non-negotiables

Never put secrets in:

```text
Git
docs
job payloads
business JSON
logs
AI prompts
render payloads
CaptureScenario JSON
```

Object storage is private.

Production deployments use pinned builds/images.

Local development must not publish to real social accounts by default.

Required kill switches include:

```text
PAUSE_ALL_PUBLISHING
PAUSE_AI_GENERATION
PAUSE_CAPTURE
PAUSE_RENDERING
PAUSE_ANALYTICS_COLLECTION
```

---

# 19. Tests are part of implementation, not later cleanup

Default CI must be deterministic.

Real external-provider tests are explicit/off by default.

Critical release-blocking invariants include:

```text
Prisma/migration validity
workflow state-machine integrity
human approval gates
exact publication media lineage
PUBLISHING_UNKNOWN duplicate prevention
transactional outbox atomicity
render technical QA
capture origin/safety
secret redaction/auth
kill switches
analytics NULL semantics
attribution idempotence
```

A flaky test is a defect, not something to solve with endless reruns.

---

# 20. PostgreSQL constraints Prisma cannot fully express

When Phase 1 begins, the initial migration must include/test manual SQL constraints for:

### Approval subject

```text
CONCEPT:
  conceptVersionId NOT NULL
  renderId NULL

RENDER:
  renderId NOT NULL
  conceptVersionId NULL
```

### KnowledgeSnapshot ACTIVE uniqueness

```text
UNIQUE(key)
WHERE status = 'ACTIVE'
```

### Revenue completeness

```text
eventType != 'REVENUE'
OR (
  valueAmountMinor IS NOT NULL
  AND valueCurrency IS NOT NULL
)
```

Cross-table consistency also requires application validation/tests.

Do not "simplify away" these invariants.

---

# 21. Current authorization: Phase 0 ONLY

This handoff authorizes only:

```text
Phase 0 — Bootstrap & repository
```

Phase 0 scope:

```text
pnpm workspace
canonical apps/packages folders
TypeScript strict base config
shared lint/format/test harness
typed runtime config foundation
Docker Compose local dependencies
PostgreSQL
Redis
S3-compatible local storage
Prisma bootstrap
Prisma schema placement
Prisma validate/format/generate
inspect generated initial migration SQL
fake-provider/test infrastructure skeleton
basic health/readiness skeleton
```

You may create only the minimum application scaffolding needed for this phase.

Do **not** begin:

```text
real AI capabilities
real Playwright capture
real Remotion editing
social publishing
analytics import
dashboard feature implementation
```

during Phase 0.

---

# 22. Important Phase 0 clarification

The specification pack was validated structurally before implementation, but the final Prisma schema has **not** yet been validated by an installed project-local Prisma CLI.

Therefore Phase 0 must explicitly run, with the pinned Prisma version:

```text
prisma format
prisma validate
prisma generate
```

If Prisma reports a schema issue:

```text
STOP
report exact error
propose the smallest spec-consistent correction
do not silently redesign the domain
```

The generated initial migration SQL must be inspected before applying it.

---

# 23. Node / dependency discipline

The architecture targets Node.js 24 LTS.

If the developer machine currently runs another Node version:

```text
do not silently change the product decision
```

Add the appropriate version-manager/project metadata and report the local mismatch.

Pin dependencies and commit the lockfile.

Do not install `latest` blindly for critical runtime components.

For fast-moving external tools/APIs, verify current compatibility before pinning.

---

# 24. Git safety

Before editing:

```text
git status must be understood
```

Do not:

```text
git reset --hard
git clean -fd
force push
rewrite existing history
delete unrelated work
```

unless the user explicitly instructs it.

Keep Phase 0 changes focused.

One phase should produce one reviewable implementation tranche.

---

# 25. No speculative refactors

Do not refactor unrelated files "while here".

Do not rename domain concepts because another name feels cleaner.

Do not merge aggregates or remove version tables for convenience.

Do not simplify workflow states because the first implementation path does not use them yet.

The specification intentionally preserves future-safe lineage.

---

# 26. Stop conditions

STOP and report instead of inventing a decision when:

```text
the current code contradicts canonical spec materially
a destructive migration/data-loss risk appears
a required provider capability/policy/licence changed
a secret/credential would need exposure or commit
a remote side effect is ambiguous
a release-blocking invariant cannot be met
implementation requires changing an accepted product decision
Prisma cannot represent the canonical model as specified
a required test cannot be made deterministic without architecture change
```

A stop report should contain:

```text
what was found
why it matters
exact affected files/entities
smallest safe options
recommended option
no implementation of the disputed change yet
```

---

# 27. Phase 0 acceptance criteria

Phase 0 is complete only when:

```text
canonical monorepo structure exists
pnpm workspace resolves
Node/TypeScript strict config exists
config parser skeleton exists
Docker Compose local dependencies are defined
Postgres starts/health checks
Redis starts/health checks
local S3-compatible store starts/health checks
Prisma schema is in canonical runtime location
prisma format passes
prisma validate passes
prisma generate passes
initial migration SQL is generated and reviewed
test harness runs
fake-provider/test skeleton exists
no secrets committed
git diff is focused
```

Do not mark Phase 0 complete merely because packages installed.

---

# 28. Required report before stopping

At the end of Phase 0, report:

```text
1. starting HEAD/tag
2. final git status
3. files created/modified
4. exact dependency versions pinned
5. Docker services created
6. Prisma validation/generation result
7. migration SQL summary
8. tests/commands run and results
9. local Node-version note
10. known limitations
11. rollback/revert notes
12. explicit statement:
    "Phase 1 has NOT been started."
```

Then STOP.

Wait for explicit user authorization before Phase 1.

---

# 29. Do not optimize for speed over correctness

This project exists because prior long coding efforts caused regressions.

The implementation process must therefore favor:

```text
small phase
inspection first
exact lineage
deterministic tests
clear diff
stop point
```

over:

```text
large autonomous rewrite
```

The goal is not to produce the most code in one session.

The goal is to implement the frozen V1 safely.
