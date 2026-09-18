# 12 — Analytics & Learning

**Status:** ACCEPTED  
**Specification version:** spec-v0.13  
**Scope:** Vision Content Engine V1  
**Depends on:** Distribution ACCEPTED  
**Accepted:** 2026-09-18

---

# 1. Purpose

Analytics & Learning answers one question:

```text
Which content decisions are producing useful commercial outcomes for Vision?
```

The system must distinguish:

```text
platform attention
website interest
signup
activation
customer
revenue
```

Views are useful signals, not the final objective.

---

# 2. Primary outcome hierarchy

Default business hierarchy:

```text
1. CUSTOMER
2. ACTIVATION
3. SIGNUP
4. QUALIFIED WEBSITE VISIT
5. PLATFORM ENGAGEMENT / RETENTION
6. RAW VIEWS
```

This is not a universal weighted score.

It is an interpretation priority.

---

# 3. Three analytics layers

```text
RAW
→ exact provider/manual observations

NORMALIZED
→ typed internal metrics

ATTRIBUTION
→ business events and links to content
```

These layers remain separate.

Never overwrite raw provider data with normalized interpretations.

---

# 4. Raw platform snapshots

Existing model:

```text
MetricSnapshotRaw
```

Each raw snapshot captures:

```text
Publication
platform
collection method
collection time
provider schema/version
immutable payload
payload hash
operation identity
```

Raw payload is evidence, not dashboard truth.

---

# 5. MetricCollectionMethod

```ts
type MetricCollectionMethod =
  | "PLATFORM_API"
  | "MANUAL_ENTRY";
```

V1:

```text
Instagram → PLATFORM_API
YouTube   → PLATFORM_API
TikTok    → MANUAL_ENTRY
```

TikTok Display API may be added later if the app obtains appropriate approved access.

No scraping is used to work around unavailable TikTok analytics access.

---

# 6. Raw idempotence

Every collection operation gets:

```text
collectionOperationId
```

Retry of the same logical collection must not create uncontrolled duplicate evidence.

Provider payload hash may also detect identical payloads.

---

# 7. Raw retention

Raw provider payload retention is controlled by a versioned provider retention policy.

Before implementation:

```text
re-check current provider terms
```

The system must not assume every provider allows indefinite raw response storage.

Normalized metrics and internal derived evidence are retained only to the extent permitted by applicable provider terms.

---

# 8. Normalized snapshots

Existing model:

```text
MetricSnapshotNormalized
```

Normalized fields use:

```text
NULL = unavailable / unsupported / not observed
0    = observed zero
```

This rule is mandatory.

---

# 9. Core normalized metrics

V1 canonical fields:

```text
views
engagedViews
reach
impressions

likes
comments
shares
saves

watchTimeMs
avgWatchDurationMs
avgWatchPercentage
completionRate

profileVisits
websiteClicks
follows
```

A platform may support only a subset.

Unsupported values remain NULL.

---

# 10. Metric semantics are platform-specific

A field called:

```text
views
```

does not imply identical platform definition.

Therefore every normalized snapshot pins:

```text
metricSemanticsVersion
```

and has optional:

```text
comparabilityJson
```

Cross-platform analysis must consult these definitions.

---

# 11. No fake universal engagement score

V1 does not create:

```text
engagementScore = 87
```

as authoritative truth.

Derived rates may be calculated for a specific analysis:

```text
likes / views
shares / views
website visits / views
signups / visits
```

but must retain denominator and measurement window.

---

# 12. Measurement age

Content is compared at similar ages.

Example windows:

```text
T+1h
T+6h
T+24h
T+72h
T+7d
T+30d
```

A 30-day-old video must not be compared directly with a 4-hour-old video using cumulative totals.

---

# 13. Automated collection schedule

Default automated collection policy for Instagram and YouTube:

```text
T+1h
T+6h
T+24h
T+72h
T+7d
T+30d
```

Exact schedule is configurable/versioned.

Provider freshness/delay is recorded.

---

# 14. TikTok manual collection

To minimize operator burden:

```text
T+24h
T+72h
T+7d
```

are the default manual prompts.

Optional:

```text
T+30d
```

The user may enter available native/public metrics.

Do not require unavailable metrics.

---

# 15. TikTok manual metric form

Potential fields:

```text
views
likes
comments
shares
saves if known
avg watch time if known
watched full video/completion if known
profile visits if known
website clicks if known
```

Unknown stays empty/NULL.

A manual snapshot records an AuditEvent.

---

# 16. Instagram analytics adapter

Instagram analytics is collected for owned Professional-account media through approved Instagram API capabilities.

The adapter stores raw response first.

It then maps supported fields into normalized metrics.

Do not hard-code provider field names throughout business logic.

All provider mapping lives in the adapter + versioned metric definitions.

---

# 17. YouTube Analytics adapter

YouTube Analytics uses authorized channel reports.

The adapter may query by:

```text
video
day
measurement range
```

and supported metrics.

Useful short-form metrics can include, where supported:

```text
views / engagedViews
likes
comments
shares
estimatedMinutesWatched
averageViewDuration
averageViewPercentage
subscriber changes
```

Provider-specific metrics remain in `otherMetricsJson` when no valid canonical field exists.

---

# 18. Analytics freshness

Platform analytics may be delayed or revised.

Therefore snapshots are cumulative observations at a point in time.

The system does not assume:

```text
latest snapshot == permanent final number
```

---

# 19. Website analytics source

Vision currently uses Umami.

V1 supports an Umami adapter for:

```text
pageviews
visits
visitors
referrers
query parameters
events
event data
```

The Content Engine reads via supported API access.

No direct DB coupling to Umami.

---

# 20. Tracking parameters

When a platform/location supports a usable link, generate:

```text
utm_source
utm_medium=organic_social
utm_campaign
utm_content
```

Recommended:

```text
utm_content = publication tracking code
```

Publication therefore has a stable opaque:

```text
trackingCode
```

Do not use title/caption as attribution identity.

---

# 21. Publication tracking code

Every Publication receives:

```text
trackingCode
```

Properties:

```text
unique
opaque
stable
safe for URLs
```

Example conceptual URL:

```text
https://urvision.fr/?utm_source=youtube
  &utm_medium=organic_social
  &utm_campaign=vision_organic
  &utm_content=<trackingCode>
```

---

# 22. Attribution reality

Direct publication-level attribution is not always possible.

Examples:

```text
YouTube description link with unique UTM
→ potentially DIRECT

generic TikTok/Instagram bio link
→ often platform-level only

typed domain / dark social
→ often UNKNOWN
```

The system must represent that uncertainty honestly.

---

# 23. Attribution confidence

Existing types remain:

```text
DIRECT
INFERRED
UNKNOWN
```

### DIRECT

Concrete identifier links event to Publication/Campaign.

Examples:

```text
utm_content trackingCode
explicit referral code
known click token
```

### INFERRED

Reasonable but non-deterministic association.

Example:

```text
Instagram-referrer visit during a publication window
without publication-specific identifier
```

### UNKNOWN

No defensible content-level association.

---

# 24. Attribution events

Existing business event types:

```text
WEBSITE_VISIT
SIGNUP
ACTIVATION
CUSTOMER
REVENUE
```

V1 adds event-source idempotence and first-class revenue value.

---

# 25. Attribution source systems

Examples:

```text
UMAMI
VISION_APP
STRIPE
MANUAL
```

The database stores:

```text
sourceSystem
externalEventId
```

for safe deduplication.

---

# 26. Revenue values

For `REVENUE`:

```text
valueAmountMinor
valueCurrency
```

Example:

```text
3900
EUR
```

Do not parse revenue from arbitrary text metadata when a typed value can exist.

---

# 27. Privacy-minimized identity

Attribution should not require emails/names in the Content Engine.

Preferred:

```text
opaque user ID
opaque visitor/session ID
```

If a stable ID is needed across Vision events, use a non-secret opaque identifier.

Avoid copying unnecessary PII into analytics.

---

# 28. Vision product event ingest

No direct database coupling.

Vision emits signed events to an internal Content Engine ingestion endpoint.

Conceptual contract:

```ts
type VisionAttributionEvent = {
  externalEventId: string;
  eventType:
    | "SIGNUP"
    | "ACTIVATION"
    | "CUSTOMER"
    | "REVENUE";

  occurredAt: string;

  userId?: string;
  trackingCode?: string;
  campaignTrackingCode?: string;

  valueAmountMinor?: number;
  valueCurrency?: string;

  metadata?: unknown;
};
```

---

# 29. Ingest authentication

Internal product events require:

```text
HTTPS
shared-secret/HMAC or equivalent service authentication
timestamp/replay protection
idempotent externalEventId
```

The exact secret transport is implementation/security work, not a JSON artifact.

---

# 30. Umami attribution

Umami can contribute:

```text
WEBSITE_VISIT
marketing event observations
referrer
query params / UTMs
session/visitor context where available
```

Umami is not authoritative for:

```text
customer
revenue
product activation
```

unless Vision explicitly emits equivalent verified events into it.

---

# 31. Attribution precedence

When multiple sources support the same event:

```text
first-party Vision product event
> deterministic tracked web event
> inferred web/session association
> manual assertion
```

Do not double count duplicates across sources.

---

# 32. Funnel metrics

For a defined window:

```text
visits
signups
activations
customers
revenue
```

Derived conversion examples:

```text
signupRate = signups / visits
activationRate = activations / signups
customerRate = customers / signups
revenuePerSignup = revenue / signups
```

Only compute when denominator is known and meaningful.

---

# 33. Qualified website visit

V1 does not automatically call every visit qualified.

A qualified visit may later require:

```text
minimum engagement
specific page/event
non-bot criteria
target geography/language
```

Until policy is configured, display:

```text
website visits
```

rather than inventing `qualifiedVisits`.

---

# 34. Bot/datacenter caution

Website analytics interpretation should support:

```text
bot/datacenter suspicion
country/language consistency
engagement
referrer
```

Suspicious traffic is excluded only by a deterministic policy with auditability.

Do not let the Analyst silently discard traffic.

---

# 35. Analysis grain

Primary analysis grains:

```text
Publication
Render
ConceptVersion
PatternVersion
EditingProfileVersion
TemplateVersion
Platform
Campaign
Experiment
```

Different questions use different grains.

---

# 36. Cross-post grouping

The same Render may produce:

```text
TikTok publication
Instagram publication
YouTube publication
```

These are separate Publication observations but share content lineage.

This allows:

```text
same content, different platform
```

analysis without pretending they are independent creative concepts.

---

# 37. Feature extraction

Deterministic analysis dimensions come from lineage and diagnostics:

```text
pattern
hook shape
angle
primary format
target audience
platform
duration
editing profile
template
CTA
presenter usage
product screen time
hook product reveal time
caption density
average visual segment duration
cut count
motion count
music present
SFX count
```

Do not ask an LLM to rediscover fields already stored structurally.

---

# 38. Comparable sample

A comparison is valid only when important conditions are compatible.

Potential comparability dimensions:

```text
platform
measurement age/window
metric definition version
content format
duration band
audience
campaign context
```

The comparison engine records limitations rather than silently mixing incompatible rows.

---

# 39. EvidencePolicy

Evidence confidence uses:

```text
INSUFFICIENT_DATA
WEAK_SIGNAL
INTERESTING_SIGNAL
FAIRLY_SOLID
```

This is evidence quality, not statistical certainty.

The policy is versioned.

---

# 40. Minimum confidence guardrails

V1 policy examples:

### Single Publication

Cannot exceed:

```text
WEAK_SIGNAL
```

for a general content rule.

### Pattern/format comparison

To exceed weak signal, require:

```text
multiple comparable Publications
multiple publish dates
same measurement window
no single outlier dominating the conclusion
```

### FAIRLY_SOLID

Requires all:

```text
meaningful sample under configured policy
consistent direction across multiple observations
important confounders documented
same/comparable metric semantics
no reliance on one viral outlier
```

Exact sample thresholds are versioned configuration, not universal truth.

---

# 41. No causal overclaim

Analytics can support:

```text
"Videos using X had higher 7-day signup rate in this sample."
```

It should not automatically state:

```text
"X causes more customers."
```

unless an experiment/evidence design genuinely supports that conclusion.

---

# 42. Experiment analysis

Existing:

```text
Experiment
ExperimentArm
```

An Experiment records:

```text
hypothesis
primary metric
what changes
what stays constant
measurement window
arms
```

Analyst compares only after configured evidence conditions are met.

---

# 43. Deliberate variants

Examples:

```text
same Pattern
same proof
same platform
change hook
```

or:

```text
same script
change EditingProfile
```

This gives stronger evidence than uncontrolled historical comparisons.

---

# 44. Experiment primary metric

Primary metric is declared before analysis where practical.

Examples:

```text
24h averageViewPercentage
7d website visits
7d signup rate
7d customers
```

Do not switch the primary metric after seeing results merely to produce a winner.

---

# 45. Learning output

The Analyst produces:

```text
Insight
Recommendation
```

It does not mutate:

```text
Pattern
Brief
EditingProfile
Template
strategy configuration
```

automatically.

---

# 46. Recommendation lifecycle

Existing states:

```text
PROPOSED
ACCEPTED
REJECTED
EXECUTED
```

Examples:

```text
Test result-first hooks for product demos
Reduce caption density in green-screen explainers
Retest manual-vs-Vision with earlier product reveal
```

---

# 47. Recommendation becomes experiment

Preferred flow:

```text
Insight
→ Recommendation
→ user ACCEPTS
→ Experiment proposal
→ Concepts
```

This makes learning testable instead of silently rewriting future prompts.

---

# 48. Pattern evidence

Pattern performance is derived, not stored in immutable PatternVersion.

Derived evidence uses:

```text
PatternVersion
← ConceptVersion
← Publication
← Metric snapshots
← Attribution events
```

This closes the Pattern Library design from spec-v0.7.

---

# 49. Editing evidence

Editing diagnostics are likewise analyzed contextually.

Examples:

```text
earlier product reveal
lower caption density
presenter screen time
average shot duration
```

Do not establish global rules from one platform or one topic.

---

# 50. Weekly analysis

Default weekly report sections:

```text
1. Business outcomes
2. Funnel
3. Platform performance
4. Content/pattern signals
5. Editing signals
6. Experiments
7. Anomalies/data-quality issues
8. Recommendations for next week
```

---

# 51. Weekly comparison

Weekly report distinguishes:

```text
newly published content
maturing older content
revised platform metrics
new business conversions
```

Do not attribute a customer this week to this week's post unless evidence supports it.

---

# 52. Data quality

Analytics pipeline tracks:

```text
freshness
missing source
auth failure
unsupported metric
manual snapshot overdue
normalization failure
duplicate event rejection
provider schema change
```

These feed Needs Attention when materially important.

---

# 53. Analytics collection jobs

Control process schedules:

```text
platform metric collection
website analytics import
weekly analysis
manual TikTok reminders
```

Workers execute.

PostgreSQL remains authoritative for job intent/state.

---

# 54. Manual TikTok reminder UX

At due window:

```text
TikTok analytics due — T+24h
```

Form pre-fills:

```text
publication
remote URL if known
publishedAt
```

User enters only metrics available in TikTok.

Target operator time:

```text
well under one minute per snapshot
```

---

# 55. Future TikTok Display API

If approved later:

```text
video.list / video.query
```

can provide public metadata/counts for authorized videos.

Adapter becomes:

```text
TIKTOK_DISPLAY_API_V1
```

This changes collection method for future snapshots, not historical manual evidence.

---

# 56. Platform metric drift

Platform metric names/definitions can change.

Therefore:

```text
raw payload preserved under retention policy
provider schema version recorded
normalizer version recorded
metric semantics version recorded
```

Re-normalization may create a new normalized snapshot/version without altering old evidence.

---

# 57. Data backfill

If a new normalizer adds a field:

```text
do not mutate old normalized row
```

Create new normalized representation/version from retained raw evidence if permitted.

---

# 58. Analyst input

Analyst receives:

```text
measurement window
normalized metrics
metric semantics
comparability notes
attribution events
experiment design
content lineage/features
minimum evidence policy
prior relevant insights
```

Not raw database dumps.

---

# 59. Analyst output rules

Every Insight includes:

```text
statement
confidence
evidence IDs
measurement window
sample size/context
limitations
```

Every Recommendation includes:

```text
hypothesis
change to test
constants to keep
primary metric
measurement window
```

---

# 60. No strategy autopilot in V1

The system does not automatically:

```text
change prompts
retire Patterns
change EditingProfile defaults
increase posting frequency
change CTA policy
```

based solely on Analyst output.

Human accepts important strategy changes.

---

# 61. Analytics dashboard

Default presentation:

```text
business outcomes first
platform attention second
confidence always visible
```

A high-view / zero-signup post should not be presented as an unqualified success.

---

# 62. Platform comparison

Platform dashboards may compare:

```text
publishing cadence
views
retention/engagement where comparable
website traffic
signups/customers
```

But platform-native metrics with different definitions remain labeled.

---

# 63. Cost-aware analytics

Where known, analysis may show:

```text
AI/content production cost
render cost
live provider capture cost
```

against:

```text
customer/revenue outcomes
```

Do not compute ROI when revenue attribution is UNKNOWN and present it as exact.

---

# 64. Retention and privacy

Analytics retention policy must define:

```text
raw provider payload duration
normalized metrics retention
diagnostics retention
opaque user/session identity retention
```

Do not store more user-identifying information than needed.

---

# 65. V1 anti-patterns

Do not:

```text
treat NULL as zero
rank all Patterns with one score
compare cumulative 30d vs 6h performance
pretend platform views mean the same thing
scrape TikTok because API access is unavailable
infer customers from views
claim causality from one successful post
double-count Umami and Vision events
store email addresses unnecessarily
silently discard suspected bot traffic
auto-change strategy from Analyst output
```

---

# 66. Prisma amendments

V1 Analytics adds:

```text
MetricCollectionMethod

MetricSnapshotRaw.collectionMethod
MetricSnapshotRaw.collectionOperationId

MetricSnapshotNormalized.engagedViews
MetricSnapshotNormalized.reach
MetricSnapshotNormalized.impressions
MetricSnapshotNormalized.follows
MetricSnapshotNormalized.metricSemanticsVersion
MetricSnapshotNormalized.comparabilityJson
MetricSnapshotNormalized.availabilityJson

Publication.trackingCode

AttributionEvent.sourceSystem
AttributionEvent.externalEventId
AttributionEvent.valueAmountMinor
AttributionEvent.valueCurrency
```

---

# 67. Spec artifacts

```text
docs/spec-artifacts/analytics-learning/
├── schema.ts
├── metric-definitions.json
├── collection-windows.json
├── evidence-policy.json
├── attribution-contract.json
├── README.md
└── adapters/
    ├── INSTAGRAM_ANALYTICS_V1.json
    ├── YOUTUBE_ANALYTICS_V1.json
    ├── TIKTOK_MANUAL_ANALYTICS_V1.json
    ├── UMAMI_V1.json
    └── VISION_EVENTS_V1.json
```

---

# 68. Acceptance checklist

- [x] business-outcome hierarchy accepted.
- [x] raw/normalized/attribution separation accepted.
- [x] collection methods accepted.
- [x] NULL semantics accepted.
- [x] canonical metric set accepted.
- [x] platform semantic differences accepted.
- [x] measurement-age comparison accepted.
- [x] automated collection windows accepted.
- [x] TikTok manual collection accepted.
- [x] Umami source accepted.
- [x] Publication trackingCode accepted.
- [x] DIRECT/INFERRED/UNKNOWN attribution accepted.
- [x] first-party Vision event ingest accepted.
- [x] source-event idempotence accepted.
- [x] typed revenue accepted.
- [x] privacy-minimized identity accepted.
- [x] deterministic feature extraction accepted.
- [x] comparability/evidence policy accepted.
- [x] experiment discipline accepted.
- [x] Analyst non-causal/non-autonomous policy accepted.
- [x] weekly report accepted.
- [x] data-quality/metric-drift policy accepted.

Next:

1. freeze Analytics & Learning;
2. proceed to Security / Observability / Operations.
