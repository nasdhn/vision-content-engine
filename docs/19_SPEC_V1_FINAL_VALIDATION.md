# 19 — spec-v1.0 Final Validation

**Status:** FINAL  
**Specification:** `spec-v1.0`  
**Validated:** 2026-09-19

---

# 1. Scope

This report records the final pre-implementation sanity pass of the Vision Content Engine V1 specification.

It does not claim that application code exists.

---

# 2. Final artifact checks

The reconstructed final specification set was checked for:

```text
JSON parse validity
TypeScript spec-artifact syntax
Prisma model/enum/reference/index consistency
cross-artifact registry references
capture profile references
distribution state references
analytics collection-window references
test-tier references
Pattern seed identity uniqueness
freeze-checklist completeness
```

Results:

```text
Prisma models:                         50
Prisma enums:                          49
Prisma static relation/index errors:    0

TypeScript spec artifacts parsed:       15
TypeScript syntax errors:                0

JSON spec artifacts parsed:             63
JSON parse errors:                       0

Cross-artifact reference errors:         0
```

---

# 3. Prisma limitation of this validation

A project-local Prisma CLI is not installed in the specification-only repository state used for this pre-implementation review.

Therefore this report does **not** substitute for:

```text
prisma format
prisma validate
prisma generate
```

Those are mandatory release-blocking Phase 0 tasks using the pinned implementation dependency.

Any Prisma CLI error must stop implementation and be reconciled against the canonical spec rather than silently changing the domain.

---

# 4. Final canonical domain corrections confirmed

The final schema includes:

```text
ScriptVersion → exact ConceptVersion
CreativePlanVersion → exact TemplateVersion
CreativePlanVersion → exact EditingProfileVersion
KnowledgeSnapshot
SourceReference
ModelInvocationAttempt
Creative QA ModelInvocation linkage
PublicationDeliveryMode
Publication.mediaAssetId
AssetDerivation
MetricSnapshotNormalized → required raw snapshot
typed AttributionSourceSystem
required attribution externalEventId
AssetKind.FONT
```

---

# 5. Cross-platform distribution status

Final V1 policy remains:

```text
Instagram Reels:
  API_AUTOMATED

YouTube Shorts:
  API_AUTOMATED only when public-upload capability/audit gate is satisfied

TikTok:
  MANUAL_HANDOFF
```

This policy must be re-verified against current provider terms/capabilities at implementation activation time.

No browser-automation workaround is authorized for TikTok.

---

# 6. Final human-gate model

Exactly two mandatory approval gates remain:

```text
1. ConceptVersion approval
2. final Render approval
```

Recording is human input where required, not a third approval gate.

Script and CreativePlan remain inspectable/editable without mandatory approval.

---

# 7. Final learning posture

Analytics remains business-first:

```text
customer
activation
signup
website visit
platform attention
```

with:

```text
NULL != 0
DIRECT / INFERRED / UNKNOWN attribution
versioned comparability/evidence policy
no automatic strategy mutation
```

---

# 8. Historical-document rule

Some accepted specification documents preserve historical rationale, old review questions or earlier freeze sequencing.

They are not an instruction to reopen accepted decisions.

Canonical precedence is defined in:

```text
docs/18_FINAL_RECONCILIATION.md
```

and repeated in the Codex Master Prompt.

---

# 9. Implementation gate

`spec-v1.0` freezes the specification.

Implementation does **not** begin automatically because this tag exists.

Implementation begins only when the user explicitly hands:

```text
docs/17_CODEX_MASTER_PROMPT.md
```

to the coding agent.

That prompt authorizes **Phase 0 only**.

Every later phase requires a separate explicit authorization after review of the previous phase.

---

# 10. Freeze result

The V1 specification is sufficiently closed for Phase 0 implementation.

Remaining implementation-time choices are intentionally operational/vendor-level choices, not unresolved product/domain decisions.

Examples:

```text
exact identity-provider vendor
exact observability vendor
exact S3-compatible provider
exact backup tool
exact speech-alignment implementation
host concurrency tuning
provider API minor versions
Remotion licence re-check at activation
```

These choices must respect the accepted interfaces, tests and stop conditions.

---

# 11. Post-freeze amendment — spec-v1.0.1 (2026-09-19)

Sections 1–10 remain the historical validation record for `spec-v1.0`.
The accepted `docs/20_TIME_SEMANTICS_AMENDMENT.md` and ADR-0024 now correct only the native
PostgreSQL type of all 97 DateTime fields to `@db.Timestamptz(3)`, preserving UTC instant
semantics and every other schema property. For this correction only, amendment 20 takes precedence.

After the amendment's validation gates pass, `spec-v1.0.1` becomes the current baseline,
recorded by its new manifest. The existing `spec-v1.0` tag and manifest remain immutable.
No tag is created or moved; no SQL is applied. This amendment does not authorize Phase 1.

---

# 12. Post-freeze amendment — spec-v1.0.2 (2026-09-19)

The earlier validation and spec-v1.0.1 amendment records remain historical.
`docs/21_DURABLE_LEASES_FENCING_AMENDMENT.md` and ADR-0025 add the explicit durable PostgreSQL
lease/claim and fencing contract, nine nullable fields, two recovery indexes and four manual
CHECKs. Amendment 21 governs this limited subject; amendment 20 continues to govern UTC instants.

After its validation gates pass, spec-v1.0.2 is the current baseline, covered by a new manifest.
Both earlier tags and manifests remain immutable. This tranche applies no migration and
creates no runtime service, commit or Git tag. Phase 1 and Phase 2 remain unauthorized here.

---

# 13. Post-freeze amendment — spec-v1.0.3 (2026-09-21)

The earlier validation and spec-v1.0.1 / spec-v1.0.2 amendment records remain historical.
`docs/22_PHASE5_EDITING_PLAN_PERSISTENCE_AMENDMENT.md`, ADR-0026 and D-187 close the
EditingPlan persistence gap discovered during Phase 5 implementation.

The canonical and runtime Prisma schemas now both contain nullable
`EditingPlanVersion.planSpecJson`. AI-produced plans require the exact complete validated
EditingPlan snapshot, successful/applied ModelInvocation evidence and deterministic projection
agreement before READY promotion. Historical rows remain nullable without fabricated backfill.

`docs/spec-artifacts/spec-v1.0.3-manifest.json` is the current specification manifest.
Historical manifests remain immutable and are reconstructed in fidelity tests by reversing
only the explicitly declared later schema amendments and document appendices.

This amendment does not authorize Distribution or publication work.
