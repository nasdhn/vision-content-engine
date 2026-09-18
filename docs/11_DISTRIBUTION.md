# 11 — Distribution

**Status:** ACCEPTED  
**Specification version:** spec-v0.12  
**Scope:** Vision Content Engine V1  
**Depends on:** Dashboard UX ACCEPTED  
**Accepted:** 2026-09-18

---

# 1. Purpose

Distribution takes an approved Render and turns it into a platform publication while preserving:

- exact media lineage;
- platform-specific metadata;
- scheduling intent;
- token/account health;
- retry semantics;
- ambiguous-side-effect safety;
- reconciliation;
- auditability.

V1 target platforms:

```text
Instagram Reels
YouTube Shorts
TikTok
```

The three platforms do **not** use the same delivery mode in V1.

---

# 2. V1 delivery matrix

```text
Instagram Reels
→ API_AUTOMATED

YouTube Shorts
→ API_AUTOMATED when API project/account capability is ready
→ otherwise capability-blocked until resolved

TikTok
→ MANUAL_HANDOFF
```

TikTok Direct Post is intentionally excluded from internal V1 because current TikTok Content Sharing Guidelines state that API clients should be intended for a wide audience rather than internal/private use, and explicitly list a utility that uploads content to accounts managed by the developer/team as not acceptable.

This is treated as a platform-policy constraint, not a temporary implementation omission.

---

# 3. PublicationDeliveryMode

```ts
type PublicationDeliveryMode =
  | "API_AUTOMATED"
  | "MANUAL_HANDOFF";
```

Every Publication stores its delivery mode explicitly.

Do not infer delivery mode from platform name at runtime.

Reason:

- platform policy may change;
- future TikTok public product may enable API mode;
- account-specific capability may differ.

---

# 4. Publication status

V1 Publication statuses:

```text
DRAFT
SCHEDULED
READY_FOR_MANUAL_PUBLISH
PUBLISHING
PUBLISHING_UNKNOWN
PUBLISHED
FAILED
CANCELLED
```

`READY_FOR_MANUAL_PUBLISH` is only used when human platform completion is required.

---

# 5. State transitions — automated

```text
DRAFT
→ SCHEDULED
→ PUBLISHING
→ PUBLISHED
```

Failure branches:

```text
PUBLISHING
→ FAILED
```

or:

```text
PUBLISHING
→ PUBLISHING_UNKNOWN
→ reconcile
→ PUBLISHED | FAILED | PUBLISHING
```

---

# 6. State transitions — manual handoff

```text
DRAFT
→ SCHEDULED
→ READY_FOR_MANUAL_PUBLISH
→ PUBLISHED
```

Operator may also:

```text
READY_FOR_MANUAL_PUBLISH
→ CANCELLED
```

The operator explicitly confirms completion after publishing in the native platform UI.

`publishedAt` is recorded from the confirmed publication event/time.

---

# 7. Publication readiness

A Publication may not leave `DRAFT` unless:

```text
approved Render exists
exact mediaAssetId resolved
platform account exists
metadata contract valid
delivery mode resolved
scheduledAt valid if scheduling is used
required capability checks pass
```

Manual TikTok does not require API credentials.

---

# 8. Exact uploaded media

The accepted invariant remains:

```text
Publication.mediaAssetId
→ exact Asset uploaded or handed off
```

If no platform derivative is required:

```text
mediaAssetId = Render.approvedAssetId
```

If a derivative is required:

```text
mediaAssetId = derived Asset
```

Never hide the final uploaded file identity inside JSON.

---

# 9. AssetDerivation

V1 closes derivative provenance explicitly.

```ts
type AssetDerivation = {
  id: string;

  sourceAssetId: string;
  derivedAssetId: string;

  type:
    | "PLATFORM_DERIVATIVE";

  platform?: "TIKTOK" | "INSTAGRAM" | "YOUTUBE";

  transformationProfileKey: string;
  transformationProfileVersion: string;

  metadata?: unknown;

  createdAt: string;
};
```

One derived Asset has one immediate derivation parent in V1.

Chains remain possible through repeated derivations.

---

# 10. Platform derivative policy

Default:

```text
use clean master
```

Generate a derivative only when required by:

```text
platform technical constraint
platform safe-zone requirement
platform-specific duration/codec need
validated editorial requirement
```

Do not create three independent edits for three platforms.

---

# 11. Distribution scheduler

PostgreSQL remains authoritative.

Canonical due time:

```text
Publication.scheduledAt
```

The `control` process:

```text
finds due publications
claims/locks them
dispatches publish jobs
```

Workers do not own scheduling.

---

# 12. Time semantics

Store schedule timestamps as timezone-aware database timestamps.

UI displays the intended account/operator timezone.

For Vision V1, default operator presentation timezone:

```text
Europe/Paris
```

Do not reinterpret historical scheduled instants when daylight saving changes.

---

# 13. Claiming due work

The control process must prevent duplicate dispatch.

Conceptual rule:

```text
one due Publication
→ one active publish execution claim
```

Implementation may use:

- DB row locking;
- lease field;
- idempotent outbox event;
- equivalent safe transactional mechanism.

---

# 14. Publisher abstraction

```ts
interface PlatformPublisher {
  prepare(
    publication: PublicationSnapshot
  ): Promise<PublishPreparation>;

  publish(
    publication: PublicationSnapshot,
    preparation: PublishPreparation
  ): Promise<PublishResult>;

  reconcile(
    publication: PublicationSnapshot
  ): Promise<ReconcileResult>;
}
```

TikTok manual handoff implements the same conceptual boundary through a manual-handoff adapter rather than a remote publish call.

---

# 15. Adapter responsibilities

Adapter owns:

```text
platform auth semantics
platform metadata mapping
media transfer strategy
remote request identifiers
status interpretation
rate-limit classification
error classification
reconciliation
```

Adapter does not own:

```text
business scheduling
render selection
analytics normalization
content strategy
```

---

# 16. Instagram V1 auth choice

V1 prefers:

```text
Instagram API with Instagram Login
```

for a Professional Instagram account.

Required capability permissions include:

```text
instagram_business_basic
instagram_business_content_publish
```

The account must be Business or Creator / Professional.

If capability/permission is absent:

```text
PlatformAccount.REAUTH_REQUIRED
or
Needs Attention capability issue
```

---

# 17. Instagram Reel flow

V1 flow:

```text
approved media Asset
↓
temporary fetchable delivery URL
↓
create REELS media container
↓
poll container status
↓
status FINISHED
↓
media_publish
↓
remote Instagram media ID
↓
PUBLISHED
```

The exact remote container ID is stored in PublicationAttempt metadata / request identifier.

---

# 18. Instagram media URL

Instagram's Reels publishing flow fetches `video_url` from the server.

Vision binary Assets remain private by default.

Therefore the publisher creates a temporary delivery URL that:

```text
maps to exact mediaAssetId
is read-only
has bounded expiry
does not reveal storage credentials
remains valid long enough for Instagram ingestion
is never canonical identity
```

Do not make the whole bucket public.

---

# 19. Instagram delivery URL lease

Conceptual:

```ts
type DeliveryUrlLease = {
  assetId: string;
  platform: "INSTAGRAM";
  url: string;
  expiresAt: string;
};
```

The URL itself is secret-like ephemeral data.

Do not store it in permanent public logs.

---

# 20. Instagram container polling

After container creation:

```text
poll boundedly
```

until:

```text
FINISHED
ERROR/FAILED
timeout
```

Do not call `media_publish` before the container is ready.

A timeout before `media_publish` has no remote published-post ambiguity.

---

# 21. Instagram publish ambiguity

If the worker loses certainty after `media_publish` may have reached Meta:

```text
PUBLISHING_UNKNOWN
```

Do not create a second Reel blindly.

Reconciliation checks known remote identifiers/status before retry.

---

# 22. Instagram metadata

V1 supported metadata:

```text
caption
share_to_feed
```

Metadata is schema-versioned in `metadataJson`.

No arbitrary Graph API parameters from AI output.

---

# 23. YouTube upload

YouTube publishing uses the YouTube Data API:

```text
videos.insert
```

with media upload.

V1 should use resumable upload for robustness.

The worker materializes the exact `mediaAssetId` and uploads that binary.

---

# 24. YouTube Shorts

V1 does not depend on a separate Shorts upload endpoint.

The adapter uploads a normal YouTube video resource through `videos.insert`.

Vision short-form output remains 9:16 and within Vision's own short-form duration policy.

YouTube classification/display as a Short is treated as a platform behavior, not a separate internal publication entity.

---

# 25. YouTube metadata

V1 supports:

```text
title
description
tags
categoryId
defaultLanguage
privacyStatus
publishAt when used
selfDeclaredMadeForKids
containsSyntheticMedia when policy requires
```

AI-generated metadata must still pass deterministic platform schema validation.

---

# 26. YouTube scheduling

Canonical scheduling remains:

```text
Publication.scheduledAt
```

V1 may use YouTube native `status.publishAt` where beneficial.

When native scheduling is used:

```text
privacyStatus = private
publishAt = Publication.scheduledAt
```

The Content Engine still retains the canonical schedule and reconciles the remote state.

---

# 27. YouTube API audit gate

Current YouTube documentation states that uploads from unverified API projects created after July 28, 2020 are restricted to private viewing until the project passes an audit.

Therefore automated **public** YouTube publication has an explicit capability gate:

```text
YOUTUBE_PUBLIC_UPLOAD_READY
```

If false:

```text
do not pretend public auto-publish is ready
surface Needs Attention
```

Testing with private uploads remains possible.

---

# 28. YouTube processing state

A successful HTTP upload does not necessarily mean the video is fully processed.

Reconciliation/monitoring may observe:

```text
uploaded
processed
failed
rejected
```

and failure/rejection reasons.

Publication becomes `PUBLISHED` only according to the accepted remote-state policy for the selected scheduling flow.

---

# 29. YouTube ambiguity

If resumable upload status is recoverable:

```text
resume/reconcile session
```

If the system knows a remote video ID:

```text
query that video before retrying upload
```

Never create duplicate videos because a client lost the final response.

---

# 30. TikTok V1 mode

TikTok V1 is:

```text
MANUAL_HANDOFF
```

The engine creates a ready-to-publish package but does not send content through Content Posting API.

---

# 31. TikTok manual package

Dashboard package includes:

```text
exact final video Asset
caption
hashtags
CTA notes
cover recommendation
scheduled target time
commercial-content reminder
platform-specific checklist
```

Primary action:

```text
Download/Open media
Copy caption
Open TikTok
```

After native publication:

```text
Mark as published
```

Optional:

```text
paste remote TikTok URL
```

---

# 32. TikTok policy note

For content promoting Vision / the user's own business, the handoff UI should remind the operator to review TikTok's current commercial-content disclosure controls in the native posting UI.

The Content Engine does not silently decide platform disclosure settings on the user's behalf.

---

# 33. TikTok future upgrade

If Content Engine later becomes a public product intended for a wider creator audience:

```text
re-evaluate TikTok Direct Post
→ app review/audit
→ compliant posting UX
→ user consent
→ creator_info
→ API_AUTOMATED possible
```

That future change creates a new adapter capability/version.

Do not reinterpret historical manual Publications.

---

# 34. PublicationAttempt

PublicationAttempt records API execution attempts.

For:

```text
Instagram API
YouTube API
```

it captures:

```text
attempt number
remote request/container/upload ID
response class
bounded response metadata
failure code/message
timestamps
```

Manual TikTok handoff does not create fake API attempts.

---

# 35. Response classes

Existing classes remain:

```text
SUCCESS
TRANSIENT_FAILURE
PERMANENT_FAILURE
RATE_LIMITED
UNKNOWN_SIDE_EFFECT
```

`UNKNOWN_SIDE_EFFECT` normally drives:

```text
PUBLISHING_UNKNOWN
```

---

# 36. Retry policy

Retry automatically only when the adapter can prove the failure is safe to retry.

Examples:

```text
network failure before remote request accepted
429 with retry window
temporary 5xx with no ambiguous side effect
resumable-upload continuation
```

Do not automatically retry:

```text
auth revoked
invalid metadata
unsupported media
policy rejection
ambiguous completed publish
```

---

# 37. Backoff

Use bounded exponential backoff with jitter for retryable API failures.

Respect provider retry/rate-limit information when available.

Global maximum attempts are configuration, not infinite.

---

# 38. PUBLISHING_UNKNOWN

This state means:

```text
remote side effect may have happened
but local system cannot prove final state
```

UI actions:

```text
Reconcile now
Open diagnostics
```

No ordinary Retry button.

---

# 39. Reconciliation

Reconciliation sources may include:

```text
known remote post/video ID
known container/upload ID
provider status endpoint
remote account media list where safe/available
stored operation metadata
```

Result:

```text
PUBLISHED
FAILED
still PUBLISHING_UNKNOWN
```

---

# 40. Operation idempotence

`Publication.operationId` is internal stable operation identity.

When provider supports external idempotency/client tokens, adapter should use them.

When provider does not, local operation identity still powers:

```text
duplicate suppression
attempt correlation
reconciliation
audit
```

---

# 41. PlatformAccount capability model

`PlatformAccount.capabilitiesJson` stores versioned discovered/verified capabilities.

Example:

```json
{
  "schemaVersion": "v1",
  "canPublishVideo": true,
  "canPublishPublic": true,
  "supportsNativeScheduling": false
}
```

Capabilities are not inferred forever from platform name.

They are refreshed during auth/capability checks.

---

# 42. Token lifecycle

Credentials are referenced through:

```text
PlatformAccount.credentialsRef
```

Secret tokens are not stored directly in ordinary DB JSON.

The adapter handles:

```text
refresh
expiry
revocation
scope loss
```

If refresh cannot recover:

```text
PlatformAccount.REAUTH_REQUIRED
```

---

# 43. Account health checks

Periodic control task checks:

```text
credentials present
token not irrecoverably expired
required scopes/capabilities
remote account identity
```

Avoid publishing first just to discover obvious auth failure.

---

# 44. Metadata versioning

`Publication.metadataJson` must contain:

```text
schemaVersion
platform
validated platform metadata
```

Example:

```json
{
  "schemaVersion": "instagram-reel-v1",
  "platform": "INSTAGRAM",
  "caption": "...",
  "shareToFeed": true
}
```

Do not store unbounded provider response blobs here.

Provider response diagnostics belong to attempts.

---

# 45. Platform metadata editing

Before final Render approval / scheduling, user may edit platform copy.

Editing platform metadata does not create a new Render.

It changes Publication metadata while still mutable.

After remote publication, metadata history is audit-preserved.

---

# 46. Hashtags

Hashtags are platform metadata/text.

The engine may generate platform-specific suggestions.

Do not assume the same hashtag set is optimal/valid on all platforms.

V1 does not need a standalone Hashtag aggregate.

---

# 47. Clean master / no watermark

Distribution starts from the clean master or explicit derivative.

Never use a downloaded TikTok/Instagram/YouTube copy as the source for another platform.

This prevents cross-platform watermarks and unnecessary recompression.

---

# 48. Manual-handoff file access

TikTok handoff may use a short-lived signed download URL or authenticated dashboard download.

Do not expose the media bucket publicly.

---

# 49. Upload-time validation

Immediately before remote/API delivery, revalidate:

```text
Asset READY
checksum if available
file exists
mime/container compatible
duration/geometry compatible
metadata contract valid
account capability valid
```

This is a fast preflight, not a new creative QA.

---

# 50. Instagram technical compatibility

The accepted social master is designed to satisfy typical Reels requirements.

Nevertheless the adapter checks the current platform constraints before creating a container.

If the master is not accepted:

```text
generate explicit platform derivative
→ AssetDerivation
→ Publication.mediaAssetId
```

---

# 51. YouTube technical compatibility

Same rule:

```text
clean master by default
derivative only if required
```

Do not transcode again without need.

---

# 52. Manual completion

For TikTok:

```text
operator clicks Mark as published
```

Required confirmation:

```text
publication happened
published time
```

Optional:

```text
remote URL
notes
```

The system records an AuditEvent.

---

# 53. Manual completion honesty

Do not fabricate:

```text
remotePostId
remote metrics
platform confirmation
```

until independently known.

A manually confirmed Publication can be `PUBLISHED` with:

```text
remotePostId = null
remoteUrl = optional
```

Analytics collection may have reduced capability until a remote identity is known.

---

# 54. Cancellation

Before remote side effect:

```text
SCHEDULED
→ CANCELLED
```

For manual handoff:

```text
READY_FOR_MANUAL_PUBLISH
→ CANCELLED
```

After API publish may have occurred:

```text
do not call it CANCELLED
```

Use reconciliation / platform-specific deletion feature later if explicitly designed.

V1 does not require remote deletion.

---

# 55. Rescheduling

Rescheduling is allowed while safe.

For local scheduler-only publications:

```text
update scheduledAt
```

For YouTube native scheduled upload:

```text
remote schedule may also require update
```

Adapter owns synchronization.

Any ambiguity moves to Needs Attention rather than silently diverging.

---

# 56. Security

Distribution workers:

```text
receive secret references, not secrets in jobs
materialize only exact media Asset
never log access/refresh tokens
redact signed delivery URLs
bound provider response logging
```

---

# 57. Observability

Every automated publish log correlates:

```text
publicationId
publicationAttemptId
operationId
platformAccountId
workflowRunId
jobAttemptId
```

Provider remote identifiers are captured when safe.

---

# 58. Cost

Distribution cost may include:

```text
egress
provider-specific fees if any
derivative render/transcode
```

Record measurable cost only.

Do not invent a cost for free provider endpoints.

---

# 59. Alerts

High-value Needs Attention events:

```text
Instagram reauth required
Instagram container repeatedly failing
YouTube capability/audit not ready
YouTube token revoked
PUBLISHING_UNKNOWN
manual TikTok due/overdue
permanent provider rejection
```

---

# 60. Manual TikTok overdue

A manual handoff becomes visibly overdue when:

```text
status = READY_FOR_MANUAL_PUBLISH
and scheduledAt is materially in the past
```

This is a UI-derived condition, not a new workflow enum.

---

# 61. Distribution anti-patterns

Do not:

```text
automate TikTok browser clicks as a policy workaround
claim TikTok Direct Post is valid for this private internal tool
blindly retry ambiguous publishes
make storage bucket public for Instagram
lose the exact uploaded Asset identity
use one generic metadata JSON with no schema version
put OAuth tokens in job payloads
duplicate YouTube uploads after lost responses
treat HTTP 200 upload as complete processing
mark manual TikTok publication as remote-confirmed when only user-confirmed
```

---

# 62. Prisma amendments

V1 Distribution adds:

```text
PublicationDeliveryMode
Publication.deliveryMode
PublicationStatus.READY_FOR_MANUAL_PUBLISH
AssetDerivation
AssetDerivationType
```

`Publication.mediaAssetId` from Video Engine remains the exact delivered media FK.

---

# 63. Distribution spec artifacts

Accepted artifacts:

```text
docs/spec-artifacts/distribution/
├── schema.ts
├── publication-state-machine.json
├── README.md
└── adapters/
    ├── INSTAGRAM_REELS_V1.json
    ├── YOUTUBE_SHORTS_V1.json
    └── TIKTOK_MANUAL_HANDOFF_V1.json
```

---

# 64. Acceptance checklist

- [x] platform delivery matrix accepted.
- [x] TikTok manual-handoff policy accepted.
- [x] PublicationDeliveryMode accepted.
- [x] READY_FOR_MANUAL_PUBLISH accepted.
- [x] exact mediaAssetId accepted.
- [x] AssetDerivation provenance accepted.
- [x] scheduler/control ownership accepted.
- [x] Publisher abstraction accepted.
- [x] Instagram Login/professional account strategy accepted.
- [x] Instagram container/status/media_publish flow accepted.
- [x] temporary signed delivery URL accepted.
- [x] YouTube resumable videos.insert flow accepted.
- [x] YouTube native scheduling option accepted.
- [x] YouTube audit/capability gate accepted.
- [x] manual TikTok package accepted.
- [x] PublicationAttempt/retry classification accepted.
- [x] PUBLISHING_UNKNOWN/reconciliation accepted.
- [x] token lifecycle/account health accepted.
- [x] metadata versioning accepted.
- [x] manual completion honesty accepted.
- [x] security/observability accepted.

Next:

1. freeze Distribution;
2. proceed to Analytics & Learning.
