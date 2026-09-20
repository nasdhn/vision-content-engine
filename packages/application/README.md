# Phase 2 — Knowledge, Pattern Library and AI generation

`AIContentService` provides `seedPatterns`, `creatorContext`, `createConcepts`,
`directorContext` and `createCreativePlan`. Contexts are projected from PostgreSQL, including
the exact KnowledgeSnapshot, BriefVersion, candidate versions and approved ConceptVersion.
No HTTP routes, queue consumers, media ingestion or provider enablement are added in this phase.

## Knowledge and sources

Use `Persistence.transaction(trustedUser, unit => unit.knowledge.createSource(...))` to curate
a SourceReference. New observations create new records. `createSnapshot(key, effectiveAt, payload)`
validates the strict knowledge payload, source references and allowed assets, hashes the payload
with sorted object keys, and allocates an immutable version under a PostgreSQL advisory lock.
`activate(id)` changes lifecycle status only and deprecates the previous active snapshot atomically.
The existing partial unique index remains the final guard. Identical payload imports return the
existing snapshot; historical content, hash and effective instant are never rewritten.

Only trusted USER identities can curate sources, knowledge or import/deprecate patterns.
Authentication transport remains outside this library. The raw Prisma client remains a privileged
infrastructure/admin boundary, as in Phase 1. The repository contains synthetic test knowledge only;
it does not invent production Vision facts, pricing or evidence.

## Patterns and memory

The eight shipped pattern artifacts are semantically identical to the frozen seeds. The importer
uses the Phase 1 append-only version API and returns explicit spec-placeholder-to-canonical-ID
mappings. Each version retains the original artifact and hash in `sourceMetadataJson`. Reimporting
does not rewrite definitions or reactivate a deprecated root. Import checks include provenance,
category stability, required structures/examples and duplicate mechanism signatures; the eight
canonical seeds have already undergone the specification's editorial review.

The deterministic selector excludes unavailable proof, presenter, evidence, formats and explicit
exclusions. It explains eligibility, fit, recent usage and combination fatigue. Seeded exploration,
candidate limits, exploration slots and fatigue penalties are caller-supplied configuration; no
universal performance score or permanent exploration percentage is stored. Phase 2 does not
fabricate analytics evidence. Context memory uses the most recent 100 canonical concept versions.
Selection dimensions and format guidance are serialized within the existing rationale string so
future contexts can reconstruct usage. Exact normalized hooks and scripts are deduplicated;
similarity uses deterministic token overlap as a conservative textual heuristic.

An intentional variant may be recorded in the curated BriefVersion payload as `deliberateVariant`:
`{ conceptVersionId, keepConstant: string[], change: string[], reason }`. Its source must exist and
the explanation arrays must be nonempty. The metadata is retained in the generated concept rationale.
Only similarity to that exact source (and reuse of its script) is exempted; exact hook duplication
still fails the Creator hard rule. The model cannot introduce an exemption in its strict output.

## Gateway, validation and budget

Construct `AIProviderGateway` with `InvocationRepository`, explicitly injected deterministic
providers, and a live pause function (wire `PAUSE_AI_GENERATION` from runtime configuration).
The gateway rejects other provider kinds; no real SDK, network provider, credential or default
external execution path is shipped. The local runtime configuration still pauses AI by default.

Every call requires explicit input/output token limits, attempt limit, timeout and estimated cost
ceiling. A trusted budget configuration supplies `{ key, from, to, limit, currency }`; use one stable
key for the shared budget, with explicit UTC window boundaries and a decimal-string ceiling.
Under a PostgreSQL lock, RUNNING invocations reserve their whole call ceiling in `policyJson`.
Retries share that reservation. Completed known usage releases unused capacity; unknown costs
consume the adapter's conservative bound without pretending it is observed cost. Actual usage alone
creates CostEntry rows. A crashed RUNNING call retains its reservation for explicit reconciliation;
it is never automatically freed while provider completion/cost is unknown. Overlapping windows or
conflicting policy for the same budget scope are rejected. Decimal arithmetic uses Prisma Decimal.

Prompts are immutable repository artifacts, retrieved by exact key/version and verified hash.
Each invocation pins prompt identity/hash, schemas, DB knowledge identity, policy and input/output
hashes. Every concrete provider call records its own model, request/response hashes, usage,
latency, validation and safe failure code. Raw provider bodies and errors are not logged or retained.
Schema repair sends only structural error codes/paths, under the same task/context/contract.
Transient network/5xx/rate-limit/timeout failures can retry within limits; reference, business and
claim failures cannot. The pause function is checked before invocation and before each attempt.

Strict Zod schemas match the canonical artifacts. Additional checks enforce candidate allowlists,
source existence, claim validity windows, durations, production availability, segment references,
CTAs, diversity and deduplication. VERIFIED factual prose must match curated evidence after
normalization; arbitrary paraphrases are not auto-verified. Numerical copy cannot evade checks by
omitting its claims list. Forbidden-claim matching and text similarity are deterministic lexical
guards, not a proof of semantic truth; the two required human gates remain essential.

## Persistence, approvals and workers

Creator atomically creates ConceptVersions with invocation/claim lineage and submits them for human
review. It never approves them. Creative Director requires approval for the exact input version,
including a deliberately selected historical version. It writes ScriptVersion and CreativePlanVersion
through Phase 1 APIs, pins template/profile versions, records claim evidence, marks validated roots
READY and emits the transactional outbox. Recording/capture requirements remain CreativePlan JSON;
there are no RecordingRequest, CaptureRun, Asset, Render or Publication side effects in Phase 2.

Consumption of a validated invocation is locked, hash checked and audited in the same transaction
as its output versions. Replay cannot duplicate content. Provider usage remains recorded even if
the later application transaction fails. Hooks are rechecked under a DB lock before persistence
to prevent simultaneous generation of duplicate hooks.

Calls may be synchronous, or accept `{ leases, jobId, leaseToken }` from an existing leased job.
The latter uses `Leases.heartbeatJob` before generation and `Leases.finishJob` for atomic fenced
result persistence. The owning worker must maintain its heartbeat during long calls. A stale result
cannot consume the invocation or write business versions. Queue dispatch/consumer wiring is not
part of this phase.

## Validation

`pnpm check:phase2` runs deterministic checks, real PostgreSQL tests and the existing web build.
CI already discovers the new tests through its existing test commands. PostgreSQL tests own and
drop disposable databases; the application database is never cleared or seeded by tests.
No schema or migration changes are required. Revert the Phase 2 commit to roll back code;
preserve any content/usage history created later by intentional library calls.
