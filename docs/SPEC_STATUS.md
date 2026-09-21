# Specification Status

## Current stage
Vision Content Engine V1 specification is **FROZEN**.

## Version
`spec-v1.0`

## Freeze date
2026-09-19

## Status
- Product: FROZEN
- Architecture: FROZEN
- Domain / Prisma: FROZEN
- Workflows: FROZEN
- AI Contracts: FROZEN
- Pattern Library: FROZEN
- Editing Intelligence: FROZEN
- Video Engine: FROZEN
- Product Capture / Playwright: FROZEN
- Dashboard UX: FROZEN
- Distribution: FROZEN
- Analytics & Learning: FROZEN
- Security / Observability / Operations: FROZEN
- Test Strategy & Acceptance: FROZEN
- Repository Conventions: FROZEN
- Implementation Plan: FROZEN
- Final Reconciliation: FROZEN
- Codex Master Handoff: READY

## Canonical implementation baseline
Use the Git tag:

```text
spec-v1.0
```

on the final specification commit.

Canonical precedence:

```text
1. docs/19_SPEC_V1_FINAL_VALIDATION.md
2. docs/18_FINAL_RECONCILIATION.md
3. docs/spec-artifacts/schema.prisma
4. current accepted/frozen domain-specific specs
5. docs/DECISIONS.md + accepted ADRs
6. historical 03A/03B Prisma design records
```

## Implementation authorization
The specification freeze itself does not start implementation.

When the user explicitly gives:

```text
docs/17_CODEX_MASTER_PROMPT.md
```

to the coding agent, **Phase 0 only** is authorized.

Phase 1 and later remain unauthorized until the previous phase is reviewed and the user explicitly continues.

## Mandatory first implementation validation
Phase 0 must install/pin the implementation dependencies and run:

```text
prisma format
prisma validate
prisma generate
```

Any schema failure is a STOP condition and must be reconciled against the frozen spec.

## Final known V1 limitations
- TikTok publishing: manual handoff.
- TikTok analytics: manual entry until approved API access is intentionally added.
- YouTube public automation: capability/audit gated.
- Dashboard: mono-user.
- Strategy changes: human-approved, not autonomous.
- No autonomous external trend/research crawler.
- No multi-touch attribution.
- No Kubernetes / Temporal / Kafka.

## Next action
Create the final spec commit and tag it:

```text
spec-v1.0
```

Then implementation may begin with Phase 0 only when explicitly requested.

## Current baseline amendment — 2026-09-19

The preceding version, tag-creation and first-validation instructions record the historical
`spec-v1.0` freeze. This dated status update supersedes them for the current baseline only.

- Current specification: **`spec-v1.0.1`**, activated after the validation gates in
  `20_TIME_SEMANTICS_AMENDMENT.md` pass.
- Accepted change: all 97 V1 DateTime fields persist UTC instants as `@db.Timestamptz(3)`;
  no other domain change. See ADR-0024 and D-184.
- Current manifest: `docs/spec-artifacts/spec-v1.0.1-manifest.json` (149 entries).
- Historical baseline: tag `spec-v1.0` remains at `f2450f34d7f55a4ce4cf950b5c7557d03c7e3549`;
  `spec-v1.0-manifest.json` stays byte-for-byte unchanged.
- Precedence: amendment 20 overrides earlier documents only for time semantics and baseline
  versioning. The existing precedence still applies to everything else.
- Phase 0 delivery: `f256c182672c9d50e55da96ec6927d5da040a585`.
- Authorization now: specification amendment and its validation only. **Phase 1 is NOT authorized.**
- No migration is applied. No Git tag is created, moved or deleted. No push is performed.

After validation, stop and report. The historical “Next action” above must not be executed.

## Current baseline amendment — spec-v1.0.2 (2026-09-19)

This update supersedes earlier dated baseline instructions only for the accepted durable
lease/fencing amendment. Prior freeze and amendment sections remain historical records.

- Current specification after the validation gates: **spec-v1.0.2**.
- Normative contract: `21_DURABLE_LEASES_FENCING_AMENDMENT.md`, ADR-0025 and D-185.
- Scope: nine nullable lease/claim fields, two recovery indexes and four manual CHECK constraints.
- DateTime fields: 103, all Timestamptz(3), including the six new nullable UTC instants.
- Current manifest: `docs/spec-artifacts/spec-v1.0.2-manifest.json` (153 entries).
- Historical tags/manifests spec-v1.0 and spec-v1.0.1 stay immutable at their existing commits.
- Precedence: amendment 21 governs durable leases/fencing; amendment 20 still governs UTC
  instant semantics. All other accepted precedence and product decisions remain unchanged.
- Phase 1 remains blocked pending separate explicit authorization after amendment review.
- This tranche is uncommitted: no migration application, tag operation, push or runtime implementation.

After validation, report and stop. Neither Phase 1 nor Phase 2 starts automatically.

## Current baseline amendment — spec-v1.0.3 (2026-09-21)

This update supersedes earlier dated baseline instructions only for lossless EditingPlan
persistence.

- Current specification after validation: **spec-v1.0.3**.
- Normative contract: `22_PHASE5_EDITING_PLAN_PERSISTENCE_AMENDMENT.md`, ADR-0026 and D-187.
- Scope: one nullable `EditingPlanVersion.planSpecJson` field plus the exact READY proof
  tying the stored plan and projections to the applied successful ModelInvocation.
- Current manifest: `docs/spec-artifacts/spec-v1.0.3-manifest.json` (156 entries).
- Historical spec-v1.0, spec-v1.0.1 and spec-v1.0.2 manifests remain immutable.
- Amendment 20 still governs UTC instants; amendment 21 still governs durable leases/fencing.
- Phase 5 implementation remains limited to the currently authorized Editing Intelligence /
  Video Engine tranche. Distribution is not activated by this amendment.

After validation, the historical earlier baseline sections remain dated records.

## Current baseline amendment — spec-v1.0.4 (2026-09-21)

This update supersedes earlier dated baseline instructions only for the structured Editing
Intelligence blocker contract.

- Current specification after validation: **spec-v1.0.4**.
- Normative contract: `23_PHASE5_STRUCTURED_EDITING_BLOCKER_AMENDMENT.md`, ADR-0027 and D-188.
- Editing Intelligence 1.0.0 remains historical; runtime generation moves to prompt/contract 1.1.0.
- Output is `PLAN | BLOCKED`; a valid blocker is a successful ModelInvocation and creates no
  EditingPlanVersion.
- `EditingBlocker` provides canonical OPEN/RESOLVED/SUPERSEDED lineage.
- Current manifest: `docs/spec-artifacts/spec-v1.0.4-manifest.json` (161 entries).
- Historical manifests through spec-v1.0.3 remain byte-for-byte immutable.
- Amendments 20, 21 and 22 continue to govern UTC instants, durable leases/fencing and lossless
  EditingPlan persistence respectively.
- This amendment remains inside the authorized Phase 5 Editing Intelligence / Video Engine
  scope. Distribution is not activated.
