# 26 — Phase 8 Analytics & Attribution Implementation Freeze

**Status:** IMPLEMENTATION FREEZE — PHASE 8 AUTHORIZED SEQUENTIALLY
**Baseline HEAD:** `754487d5b9d1ee5e2a39c8a355b00b9b647da883`
**Branch:** `phase/8-analytics`
**Frozen V1 specification:** `spec-v1.0.4` + accepted Analytics/Operations ADRs
**Date:** 2026-09-22

---

# 1. Purpose

Phase 8 implements Analytics & Attribution without weakening the lineage, human gates, Distribution safety or provider activation boundaries already proven through Phase 7.

Canonical data flow remains:

```text
PUBLISHED Publication
→ raw observation
→ normalized snapshot
→ attribution events
→ read models / Analytics UI
```

The business hierarchy remains:

```text
CUSTOMER
> ACTIVATION
> SIGNUP
> WEBSITE VISIT
> PLATFORM ATTENTION
```

This is interpretation priority, not a universal weighted score.

Phase 8 does **not** implement the Phase 9 learning loop. It does not create autonomous Insights, Recommendations, strategy mutations or an Analyst-driven winner system.

---

# 2. Inspection result at the Phase 8 baseline

The baseline already contains the canonical persistence required for Phase 8:

- `Publication.trackingCode`;
- `MetricSnapshotRaw`;
- `MetricSnapshotNormalized`;
- `AttributionEvent`;
- `MetricCollectionMethod`;
- `AttributionConfidenceType`;
- `AttributionSourceSystem`;
- `WorkflowRun` / `JobAttempt`;
- `OutboxEvent` with durable claims/fencing;
- `Experiment` / `ExperimentArm` for later analysis lineage;
- stable `/analytics` navigation destination;
- `apps/worker-analytics` and `@vision/analytics` scaffolds.

The accepted Analytics spec artifacts already define:

```text
metric definitions
collection windows
attribution contract
Instagram adapter contract
YouTube adapter contract
TikTok manual adapter contract
Umami adapter contract
Vision event ingest contract
```

No Prisma migration is expected for Phase 8 based on the inspected baseline.

A Phase 8 migration is a **STOP CONDITION** unless an accepted Phase 8 invariant is proven impossible with the current schema.

---

# 3. Current external-policy recheck — 2026-09-22

## 3.1 YouTube Analytics

Current YouTube Analytics documentation confirms:

- channel/video analytics are OAuth-authorized;
- `reports.query` is the canonical targeted reporting API;
- response columns must be interpreted from the returned headers rather than positional assumptions;
- analytics data is not real-time and typically has roughly 48–72 hours of processing latency;
- authorized YouTube Analytics data may be retained while the active-user authorization conditions are satisfied, with ongoing authorization/deletion checks required by YouTube policy;
- current YouTube policy places additional restrictions on creating/storing derived metrics from YouTube API Data.

Implementation consequence:

```text
T+1h / T+6h collection may legitimately produce NOT_YET_AVAILABLE
NULL is preserved
0 is never substituted for unavailable data
Phase 8 does not invent YouTube-derived composite scores/rates
```

The existing frozen adapter remains `YOUTUBE_ANALYTICS_V1` using `reports.query`.

## 3.2 Umami

Current Umami documentation exposes supported API endpoints for website stats, pageviews, metrics, events and event-data.

Phase 8 uses supported API access only. It does not couple directly to Umami's database.

## 3.3 Instagram

The frozen V1 strategy remains owned-media analytics for the connected Professional account through approved Instagram API capabilities.

Provider metric names, availability, permissions and retention terms are activation-time facts. The Instagram adapter must isolate provider-field mapping behind a versioned adapter and fake-provider tests.

**Live Instagram analytics collection remains disabled until current Meta data-retention/permission requirements are explicitly verified for the configured app/account.**

## 3.4 TikTok

TikTok V1 Analytics remains `MANUAL_ENTRY`.

No scraping is introduced to bypass unavailable/unapproved API access.

---

# 4. Non-negotiable Analytics invariants

## 4.1 Raw → normalized lineage

Every normalized platform snapshot references exactly one raw snapshot:

```text
MetricSnapshotRaw
→ MetricSnapshotNormalized.rawSnapshotId
```

Provider/manual evidence is persisted before or atomically with normalization.

Normalization never replaces raw evidence.

## 4.2 NULL is not zero

Canonical rule:

```text
NULL = unavailable / unsupported / not observed / not yet available
0    = provider/manual source explicitly observed zero
```

UI, APIs and tests must preserve this distinction.

## 4.3 Provider semantics remain explicit

Every normalized snapshot pins:

```text
normalizerVersion
metricSemanticsVersion
availabilityJson
comparabilityJson
```

where applicable.

Cross-platform field names do not imply identical definitions.

## 4.4 Raw idempotence

Every logical collection has one stable:

```text
collectionOperationId
```

`MetricSnapshotRaw.collectionOperationId` is the final idempotency fence.

Repeated queue delivery or worker retry for the same logical collection may not create uncontrolled duplicate raw evidence.

## 4.5 Scheduling authority

The `control` process owns collection intent.

Collection due time is derived from:

```text
Publication.publishedAt
+ versioned collection window
```

Only `Publication.status = PUBLISHED` is eligible for publication analytics collection.

Redis/BullMQ remains transport only.

## 4.6 Secrets

Analytics jobs may carry non-secret identifiers such as:

```text
publicationId
platformAccountId
collectionOperationId
windowKey
jobAttemptId
outboxEventId
```

Jobs must not carry provider access tokens, API keys, HMAC secrets or resolved credential values.

## 4.7 Provider calls are fail-closed

Phase 8 implementation/tests use fake analytics providers by default.

Real provider collection remains separately gated and is not required by the canonical local gate.

No Phase 8 test may depend on live Meta, Google, TikTok or Umami production data.

---

# 5. Collection identity and retries

A logical platform observation is identified by at least:

```text
Publication
adapter/version
collection window
collection method
```

The control layer creates/reuses one stable collection operation for that logical observation.

Safe retry rules:

```text
network/provider failure before evidence is accepted
→ retry same logical collectionOperationId

same logical operation redelivered after raw snapshot exists
→ return existing evidence / no duplicate row

normalizer code version changes
→ may create a new normalized snapshot for the same raw snapshot
```

`MetricSnapshotNormalized` already fences this with:

```text
@@unique([rawSnapshotId, normalizerVersion])
```

---

# 6. Collection windows

The frozen automated windows remain:

```text
T+1h
T+6h
T+24h
T+72h
T+7d
T+30d
```

TikTok manual windows remain:

```text
T+24h
T+72h
T+7d
optional T+30d
```

Window identity is versioned configuration, not inferred from arbitrary elapsed time.

A provider may report delayed data at an early window. The observation is still valid evidence of provider freshness/availability and must not be rewritten as zero.

---

# 7. Phase 8A — Analytics Runtime Foundation

8A implements provider-independent foundations only:

1. runtime contracts derived from frozen Analytics artifacts;
2. canonical metric/null validation;
3. payload hashing and raw snapshot persistence;
4. atomic/raw-first normalization persistence;
5. collectionOperationId idempotence;
6. versioned collection-window registry;
7. due collection intent from `Publication.publishedAt`;
8. `WorkflowRun` / `JobAttempt` / transactional outbox integration;
9. BullMQ transport boundary for `worker-analytics`;
10. deterministic fake analytics provider;
11. data-quality failure codes;
12. tests proving duplicate delivery cannot duplicate raw evidence.

8A performs **zero real provider analytics calls**.

---

# 8. Later Phase 8 tranches

## 8B — TikTok manual metrics

Implement:

```text
manual due prompts
T+24h / T+72h / T+7d
optional fields only
raw MANUAL_ENTRY snapshot
normalized snapshot
AuditEvent
Needs Attention for materially overdue prompts
operator flow under one minute
```

No TikTok scraping or Direct API dependency.

## 8C — YouTube Analytics adapter

Implement:

```text
OAuth credential resolver boundary
reports.query
channel ownership scope
video filter
response-header-driven mapping
48–72h delay awareness
provider-schema version
raw-first persistence
NULL for not-yet-available metrics
30-day authorization/deletion compliance check hook
```

Do not create unsupported derived YouTube metrics in Phase 8.

## 8D — Instagram Analytics adapter

Implement:

```text
owned Professional-account media only
versioned media-insights mapping
raw-first persistence
metric availability/permission handling
auth/capability failure classification
provider-schema drift detection
```

Live collection remains disabled until current Meta permission/retention requirements are verified and recorded for the actual app/account.

## 8E — Signed Vision attribution ingest

Implement:

```text
HTTPS service endpoint
HMAC-SHA256 or equivalent shared-secret authentication
bounded timestamp/replay window
constant-time signature verification
externalEventId idempotence
trackingCode direct attribution
typed REVENUE amount/currency
opaque user identity only where needed
```

Vision remains authoritative for:

```text
SIGNUP
ACTIVATION
CUSTOMER
REVENUE
```

No direct Vision-database coupling.

## 8F — Umami import + attribution

Implement through supported Umami API only:

```text
website visits/pageviews/events
UTM/query/referrer observations
DIRECT when trackingCode is deterministic
INFERRED only when policy explicitly supports it
UNKNOWN otherwise
source-event idempotence
no silent bot exclusion
```

Umami is not authoritative for customer/revenue unless equivalent verified Vision events exist.

## 8G — Analytics read models + UI

Implement:

```text
business funnel first
publication/content performance
platform breakdown
metric freshness/data quality
NULL displayed as unavailable, never 0
direct vs inferred attribution visibly distinct
measurement age/window labels
platform-semantics warnings
```

Phase 8 UI may expose Experiment metadata already persisted, but does not declare experiment winners or create learning Insights/Recommendations. Those are Phase 9.

## 8H — Phase closure

Implement:

```text
check:phase8
Analytics report
full API/PostgreSQL/BullMQ/browser/fake-provider regression
provider-retention/activation checklist
Phase 9 handoff boundary
```

Phase 9 does not start automatically.

---

# 9. Attribution boundary

Attribution confidence remains exactly:

```text
DIRECT
INFERRED
UNKNOWN
```

Examples:

```text
trackingCode / deterministic UTM
→ DIRECT

platform/referrer + configured temporal rule without publication identifier
→ INFERRED

no defensible publication-level link
→ UNKNOWN
```

The UI may not silently merge inferred events into deterministic publication totals.

Attribution source precedence remains:

```text
VISION_APP
> deterministic tracked web event
> inferred web/session association
> manual assertion
```

Repeated observations from multiple systems must not double count the same business event.

---

# 10. Vision signed-ingest security boundary

The Phase 8 implementation may define the exact internal signing format, but it must satisfy:

```text
secret resolved server-side only
signature covers exact request bytes + timestamp
bounded replay window
constant-time comparison
idempotent externalEventId
body size limit
strict schema
no browser-exposed secret
no PII requirement
```

Authentication failure is fail-closed and does not create `AttributionEvent` evidence.

---

# 11. Raw retention and deletion

Retention is a provider-policy concern, not an assumption.

Phase 8 must define a versioned retention policy per source:

```text
raw payload retention
normalized metric retention
diagnostics retention
opaque user/session identity retention
```

When provider/user deletion is required, dependent normalized rows may be removed before the raw row according to the canonical foreign-key constraints, with an `AuditEvent` recording the internal deletion operation where appropriate.

No code may silently mutate an immutable raw payload to simulate deletion/refresh.

YouTube-specific implementation must include the required ongoing authorization/deletion verification behavior before live activation.

Instagram live raw retention remains blocked until current Meta terms are verified for the actual integration.

---

# 12. Data-quality states

Phase 8 must distinguish at least:

```text
NOT_YET_AVAILABLE
UNSUPPORTED_METRIC
AUTH_REQUIRED
SOURCE_UNAVAILABLE
SCHEMA_DRIFT
NORMALIZATION_FAILED
DUPLICATE_REJECTED
MANUAL_SNAPSHOT_OVERDUE
```

These are evidence-quality/operational states, not metric values.

Material issues may feed Needs Attention through a read projection; no new generic `NEEDS_ATTENTION` persistence is introduced.

---

# 13. Dashboard boundary during Phase 8

React owns presentation only.

React does not:

```text
normalize provider payloads
decide attribution confidence
invent missing metrics
deduplicate business events
schedule collection jobs
classify provider auth failures
```

All Analytics data shown by the UI comes from authenticated backend read models over canonical PostgreSQL state.

---

# 14. Phase 9 boundary

The following remain explicitly outside Phase 8:

```text
EvidencePolicy scoring engine
cross-sample confidence assignment
Analyst model invocation
Insight generation
Recommendation generation
weekly learning report
pattern/editing causal claims
next-test proposal flow
autonomous strategy mutation
```

Phase 8 stores and presents trustworthy evidence so Phase 9 can reason over it later.

---

# 15. No Prisma migration expected

The inspected schema already contains the accepted Phase 8 persistence.

Before proposing any migration, implementation must prove that the current models cannot represent an accepted Phase 8 invariant.

A convenience field, denormalized counter or UI preference is not sufficient justification for a Phase 8 migration.

---

# 16. Canonical test requirements

Phase 8 tests must cover at minimum:

```text
raw payload preserved exactly
known provider field mapped
unsupported/not-yet-available → NULL
observed zero → 0
metric semantics version attached
provider-specific extras preserved only where allowed
same collectionOperationId cannot duplicate raw evidence
same raw + same normalizerVersion cannot duplicate normalized evidence
TikTok manual optional fields
DIRECT trackingCode attribution
INFERRED explicitly labeled
UNKNOWN preserved
externalEventId duplicate rejected
REVENUE typed amount/currency
signed ingest replay rejected
no provider secrets in queue payloads
no live provider dependency in canonical gate
Analytics UI renders NULL as unavailable
```

Existing Phase 7 regression remains mandatory.

---

# 17. Stop conditions

Stop rather than inventing behavior if:

- a Prisma migration appears necessary;
- current provider terms prohibit the planned retention/use;
- a real provider credential would need to be committed or exposed;
- a provider metric meaning cannot be mapped defensibly;
- code would need to treat unavailable data as zero;
- attribution would require claiming certainty not supported by identifiers;
- Vision/Umami double counting cannot be ruled out;
- a live third-party dependency is required for deterministic tests;
- a YouTube-derived metric would require policy acceptance that has not been established.

---

# 18. Git checkpoints

Expected sequence:

```text
Phase 8 freeze
→ 8A runtime foundation
→ 8B TikTok manual metrics
→ 8C YouTube Analytics adapter
→ 8D Instagram Analytics adapter
→ 8E signed Vision attribution ingest
→ 8F Umami import + attribution
→ 8G Analytics UI/read models
→ 8H closure
```
