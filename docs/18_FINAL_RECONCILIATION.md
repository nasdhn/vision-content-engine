# 18 — Final Specification Reconciliation

**Status:** ACCEPTED  
**Specification version:** spec-v0.16  
**Purpose:** close cross-specification debt before the final `spec-v1.0` freeze.  
**Implementation authorization:** NO

---

# 1. Result

The full V1 specification set has been reconciled across:

```text
architecture
domain / Prisma
workflows
AI contracts
Pattern Library
Editing Intelligence
Video Engine
Playwright Capture
Dashboard UX
Distribution
Analytics & Learning
Security / Operations
Test Strategy
Repository conventions
Implementation plan
```

No product-direction change was required.

The remaining corrections were consistency/lineage/runtime-audit fixes.

---

# 2. Canonical precedence

When documents differ, implementation follows this order:

```text
1. docs/18_FINAL_RECONCILIATION.md
2. docs/spec-artifacts/schema.prisma
3. current accepted domain-specific specs (02–16)
4. DECISIONS.md + accepted ADRs
5. historical 03A/03B Prisma draft/review documents
```

Historical review docs explain how decisions evolved but are not field-level authority.

---

# 3. Closed debt — ScriptVersion lineage

Problem:

```text
Script root → Concept root
```

did not prove which exact ConceptVersion produced a ScriptVersion.

Final:

```text
ScriptVersion.conceptVersionId → ConceptVersion
```

Canonical lineage:

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

Application validation must ensure:

```text
Script.conceptId == ScriptVersion.conceptVersion.conceptId
```

---

# 4. Closed debt — CreativePlan exact renderer choices

Creative Director already selected:

```text
TemplateVersion
EditingProfileVersion
```

but Prisma stored only string family/key hints.

Final:

```text
CreativePlanVersion.templateVersionId
CreativePlanVersion.editingProfileVersionId
```

are required relational FKs.

EditingPlanVersion pins the same exact versions again.

Mismatch is a validation failure, not an opportunity for Editing Intelligence to silently choose another template/profile.

---

# 5. Closed debt — Knowledge persistence

Final V1 decision:

```text
DB-backed immutable KnowledgeSnapshot
```

Every ModelInvocation references one exact KnowledgeSnapshot.

Dashboard edits create new snapshots.

At most one snapshot per knowledge `key` may be ACTIVE.

---

# 6. Closed debt — claim/source provenance

`SourceReference` becomes a V1 entity even though automatic Researcher/crawling stays deferred.

Purpose:

```text
VerifiedClaim.sourceIds
Idea provenance
manual/internal/official evidence
```

A new source observation becomes a new SourceReference rather than silently rewriting old evidence.

---

# 7. Closed debt — Prompt Registry

Final V1 decision:

```text
repository-backed immutable prompt artifacts
```

Runtime prompt editing is out of scope.

ModelInvocation pins:

```text
promptKey
promptVersion
promptContentHash
```

---

# 8. Closed debt — logical AI call vs provider retries

Final:

```text
ModelInvocation
  └── ModelInvocationAttempt 1
  └── ModelInvocationAttempt 2
  └── ...
```

ModelInvocation = logical capability request.

ModelInvocationAttempt = concrete provider call / repair / fallback.

This prevents fallback/retry metadata from being collapsed into one misleading provider/model row.

---

# 9. Closed debt — AI request/response retention

Permanent raw AI-body retention is not required.

V1 may retain canonical request/response bodies temporarily through restricted opaque refs:

```text
requestPayloadRef
responsePayloadRef
rawPayloadExpiresAt
```

Long-term audit keeps:

```text
hashes
prompt identity/hash
KnowledgeSnapshot FK
schemas
policy
provider/model attempts
usage/cost
validation outcome
```

---

# 10. Closed debt — Creative QA lineage

Creative QA is an AI capability and must be traceable.

Final:

```text
RenderAttempt.creativeQaModelInvocationId
→ ModelInvocation
```

The QA result JSON alone is not sufficient provenance.

---

# 11. Closed debt — manual platform credentials

TikTok internal V1 uses manual handoff.

Therefore:

```text
PlatformAccount.credentialsRef
```

is nullable.

API adapters still require credentials/capabilities before automated publication.

---

# 12. Closed debt — normalized analytics evidence

Every normalized metric snapshot now requires:

```text
rawSnapshotId
```

including manual TikTok entry.

Therefore:

```text
RAW observation
→ normalized observation
```

is always reconstructable.

Canonical units:

```text
avgWatchPercentage: 0–100
completionRate: 0–1
```

---

# 13. Closed debt — attribution idempotence

Final source systems are typed:

```text
UMAMI
VISION_APP
STRIPE
MANUAL
```

Every AttributionEvent has a required `externalEventId`.

Unique identity:

```text
(sourceSystem, externalEventId)
```

For manual events, the application generates a stable manual event ID.

REVENUE requires typed amount/currency.

---

# 14. Closed debt — Publication safety defaults

`Publication.deliveryMode` no longer has an implicit database default.

Every Publication creation must explicitly choose:

```text
API_AUTOMATED
or
MANUAL_HANDOFF
```

This prevents an accidentally-created TikTok Publication from silently becoming API automated.

`Publication.trackingCode` gets an opaque UUIDv7 default.

---

# 15. Closed debt — Asset font type

`AssetKind.FONT` is now explicit because TemplateVersionAsset can pin fonts and renderer inputs can resolve them as fonts.

---

# 16. Zod/spec contract reconciliation

AI spec artifacts now use typed snapshots for core cross-capability inputs.

Editing Intelligence AI output reuses the canonical:

```text
EditingPlanSpecSchema
```

Video Engine RenderPayload also reuses that exact schema.

This removes duplicate, divergent EditingPlan definitions.

Scenario-specific JSON and extensible provider metadata may still use bounded JSON records where the exact schema is selected by another versioned contract.

---

# 17. Prisma migration-time constraints

Prisma cannot express every accepted invariant.

The initial migration must manually add/test the following PostgreSQL constraints/indexes.

## Approval polymorphism

```text
CONCEPT:
  conceptVersionId NOT NULL
  renderId NULL

RENDER:
  renderId NOT NULL
  conceptVersionId NULL
```

## One active KnowledgeSnapshot per key

Partial unique index:

```text
UNIQUE(key) WHERE status = 'ACTIVE'
```

## Revenue completeness

CHECK:

```text
eventType != 'REVENUE'
OR (
  valueAmountMinor IS NOT NULL
  AND valueCurrency IS NOT NULL
)
```

Cross-table consistency that cannot be expressed cleanly as a simple CHECK remains application validation with tests:

```text
ScriptVersion ConceptVersion belongs to Script Concept
CreativePlanVersion exact Template/Profile match EditingPlanVersion
Publication media Asset belongs to approved/derived render lineage
```

---

# 18. Legacy document cleanup

The original lightweight:

```text
docs/13_SECURITY_OBSERVABILITY.md
```

is superseded by:

```text
docs/13_SECURITY_OBSERVABILITY_OPERATIONS.md
```

The legacy file should be deleted in the reconciliation commit.

---

# 19. Intentionally implementation-time choices

These are **not unresolved product/domain debt**:

```text
exact dashboard identity provider
exact log/error-tracking vendor
exact speech-alignment engine
exact host concurrency numbers
exact Postgres backup tool
exact S3-compatible provider
exact provider API minor versions
exact Remotion licence terms at activation time
```

They are selected during implementation/operations under accepted interfaces and gates.

---

# 20. Intentionally deferred V1 scope

Still out of scope:

```text
multi-user / RBAC / billing
AI avatar default
automatic TikTok posting for private internal use
TikTok scraping
automatic external Researcher crawler
generic trend crawler
LinkedIn/X publishing
autonomous strategy mutation
multi-touch attribution
Kubernetes / Temporal / Kafka
```

---

# 21. Gate after this reconciliation

After this corrective commit:

```text
spec-v0.16
```

The final freeze step must:

1. validate the reconciled schema/artifacts;
2. close the checklist;
3. generate the final Codex Master Prompt;
4. mark `SPEC_STATUS.md` as `spec-v1.0`;
5. create/tag the final spec commit;
6. only then authorize implementation Phase 0.
