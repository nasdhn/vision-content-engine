# Phase 9 Report — Learning

**Status:** closure candidate; the commit containing this report closes Phase 9 only after
targeted tests and `pnpm check:phase9` are green on the same worktree.

**Branch:** `phase/9-learning`

**Baseline before Phase 9G:** `9a70d37c3fc93644d995a977d4c6f05fb6c6ff5e`

## Scope delivered and checkpoints

- **Freeze** — `558c9d1fd37ae19d58a07b5240196bfd68cd9ff1`, whitespace cleanup
  `e5270d81c3fcd9bf59c256040bcf1aa8ed9eebd5`: frozen runtime boundary and machine-readable contract.
- **9A** — `0c20074a5315b6dd43d42297cdd68f09739efe89`: deterministic Evidence Engine,
  comparability, measurement windows, metric semantics, sample/date counts and confidence ceilings.
- **9B** — `e774f45409dfdb836a6482cfded85388e11e5ad0`: Experiment Evidence Analyzer,
  exact arm membership, declared primary metric, readiness and descriptive observations.
- **9C** — `0701ac3951c9d5ae8e7831ea42558c69909f9575`: versioned Analyst prompt and runtime,
  existing AI gateway, hard reference/confidence/causal validation and deterministic limitations.
- **9D** — `bc3283583fe0d4e0532cf5915e25b1b28bbbf401`: atomic, traceable Insight and
  Recommendation persistence, audited human lifecycle and explicit idempotent Experiment proposal.
- **9E** — `e1b776a874647ca4ac706f8a0ac3b96907f28ed7`: weekly planning, frozen UTC window,
  transactional outbox, AI worker leases/fencing, validated checkpoint recovery and atomic completion.
- **9F** — `9a70d37c3fc93644d995a977d4c6f05fb6c6ff5e`: authenticated Learning read model,
  weekly reports, human Recommendation controls and responsive Learning UI.
- **9G** — this report, closure contract, local Learning BullMQ transport smoke and aggregate gate.
  The exact closure commit is recorded by `git rev-parse HEAD` after committing; it is not embedded
  in its own contents.

## Audit and minimal closure surface

The 9G read-only audit found the 9A–9F implementations and their unit, PostgreSQL, API and browser
coverage already present. The missing closure artifacts were this report, a closure contract and
the canonical command, including `test:learning:runtime` required by section 39 of
`27_PHASE9_LEARNING_IMPLEMENTATION_FREEZE.md`.

The Phase 7/8 report and aggregate-gate conventions are retained. No product feature or runtime
behavior changes in 9G. `docs/DECISIONS.md`, the frozen contract and provider configuration remain
unchanged. Phase 10/11 implementation is outside this closure.

## Canonical guarantees

PostgreSQL remains canonical; BullMQ is transport only. The pipeline is Phase 8 evidence →
deterministic EvidencePolicy/comparability → Experiment evidence → Analyst interpretation →
durable Insight/Recommendation → optional explicit human next-test proposal.

- `NULL != 0`: unavailable/unsupported/unobserved metrics never become artificial zeroes.
- Umami is authoritative for `WEBSITE_VISIT`; Vision for `SIGNUP`, `ACTIVATION`, `CUSTOMER`, `REVENUE`.
- `DIRECT`, `INFERRED`, `UNKNOWN` attribution remains distinct. Revenue uses minor units and explicit
  currency; currencies are not combined through implicit FX conversion.
- Matching metric names do not establish cross-platform comparability. Measurement windows and
  metric semantics must be compatible.
- A single publication cannot exceed `WEAK_SIGNAL`. `INTERESTING_SIGNAL` requires at least three
  comparable publications, two dates and documented confounders. `FAIRLY_SOLID` requires six
  publications, three dates, compatible semantics, consistent direction, no dominant outlier and
  documented confounders. Outlier/direction thresholds remain `0.60`/`0.75`.
- The Analyst cannot exceed `deterministicConfidenceCeiling`; `causalClaimsAllowed=false`.
  Experiment results remain descriptive, with no automatic winner.
- Only `PROPOSED → ACCEPTED`, `PROPOSED → REJECTED`, `ACCEPTED → EXECUTED` are legal.
  Acceptance alone creates no Experiment. A separate explicit human action creates at most one
  `DRAFT` proposal per accepted Recommendation, including concurrent retries.
- No automatic Pattern/PatternVersion, EditingProfile, Template, prompt, CTA or cadence mutation;
  no automatic Concept generation or publication from a Recommendation.
- `WEEKLY_ANALYSIS` freezes its UTC half-open `[from,to)` window before dispatch. Its stable
  `analysisOperationKey`, database locking and leases prevent duplicate logical learning outputs.
  `ModelInvocation.output_checkpointed` permits recovery without another provider invocation.
  Provider/hard-validation failures mark the run `FAILED` without durable learning outputs.
- A weekly report represents only a `SUCCEEDED` weekly run with its canonical 9E checkpoint.
  Missing provenance fails closed; failed/incomplete runs do not become empty reports.
- Reports expose Business outcomes, Funnel, Platform performance, Content / Pattern signals,
  Editing signals, Experiments, Anomalies / data quality, Recommendations for next week. Confidence,
  sample, measurement window, limitations and source context remain visible. Experiments retain
  hypothesis, primary metric, arms, readiness, observed values, limitations and status.

## Canonical closure check and test evidence

```bash
pnpm check:phase9
```

This reuses `pnpm check:phase8` unchanged, then runs `pnpm test:learning:runtime`. The inherited gate
runs infra readiness; formatting, ESLint, TypeScript, secret checks, Prisma validation and all
unit/contract/API tests; the full PostgreSQL suite; private storage; Analytics and Distribution
BullMQ smokes; the web build; and the full Playwright suite. Thus the AI gateway, Analyst and
Phase 9 closure contract are included without maintaining a duplicate test-file allowlist.

The added Learning smoke uses the real transport on a uniquely named local Redis queue, checks
redelivery deduplication, frozen window/operation identity and strict secret-free payload shape,
then deletes that queue. It starts no worker or provider. PostgreSQL tests remain responsible for
canonical transaction, lease, recovery and output idempotence semantics.

Targeted closure evidence:

| Coverage                                            | Existing suites / added closure test                                                                                                |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 9A–9C and 9E deterministic rules                    | `tests/unit/{learning-evidence,experiment-evidence,analyst-runtime,weekly-analysis}.test.ts`                                        |
| 9A–9F canonical persistence                         | `tests/postgres/{learning-evidence,experiment-evidence,analyst-runtime,learning-persistence,weekly-analysis,learning-read}.test.ts` |
| Auth, CSRF, separate human actions                  | `tests/integration/learning-api.test.ts`                                                                                            |
| Eight report sections, human flow, mobile deep link | `tests/browser/learning.spec.ts`                                                                                                    |
| Frozen boundaries and executable runtime assertions | `tests/contracts/phase9-closure.test.ts`                                                                                            |
| Real local Learning queue transport                 | `tests/runtime/learning-bullmq-smoke.ts`                                                                                            |

Closure results must be recorded after execution; no skipped, partial or unavailable suite counts
as a passing closure. A successful `check:phase9` also executes the complete historical
`check:phase8` gate.

## Schema and migrations

No Phase 9 Prisma schema change or migration was introduced relative to the Phase 8 closure.
9G changes neither schema nor migrations. The existing initial canonical migration and two Phase 5
migrations remain the complete migration set; the PostgreSQL regression checks replay and catalog
constraints. Insight, Recommendation, Experiment, WorkflowRun and ModelInvocation reuse existing
tables and audit/checkpoint structures.

## Provider state and cost side effects

`VCE_REAL_PROVIDERS_ENABLED=false` remains enforced by runtime parsing; `true` is invalid.
`PAUSE_ALL_PUBLISHING=true` remains the default and the required local closure state. No kill
switch or activation policy is relaxed. TikTok publishing remains `MANUAL_HANDOFF`; analytics
remains `MANUAL_ENTRY`.

Tests use fake/injected AI, publishing and analytics providers. No live AI/social/Umami call,
credential provisioning or external billed operation is authorized by this closure. Local suites
create disposable PostgreSQL databases, isolated Redis jobs and private-S3 canary objects with
cleanup. ModelInvocation/cost records in tests are synthetic; production Analyst calls remain
subject to existing budget reservation, token/cost limits, timeout, attempt and fallback policies.

## Security considerations and known limitations

- Provider/user text remains data, not instructions. The versioned Analyst prompt, strict output
  schema, reference subsets and deterministic hard validation remain in force. The causal-language
  guard is a bounded lexical guardrail, not proof against every natural-language formulation.
- API reads require local authentication and private/no-store responses. Human mutations retain
  CSRF protection; no provider credentials are exposed through Learning UI or queue payloads.
- Context is bounded to 100 publications, 25 Experiments, 25 prior Insights and 1,000 attribution
  events. Prior Insights are context only, never additional independent evidence. Bounded sampling
  and observation/confounder limitations must remain visible.
- Recovery after validated output checkpointing is covered. An existing invocation without a
  usable checkpoint fails closed; the worker does not blindly invoke a provider again.
- Evidence remains observational. No causal inference, universal strategy rule, automatic winner
  or strategy autopilot is authorized; proposal creation does not launch content generation.
- The historical PostgreSQL `client.query()` concurrency deprecation warning can appear during
  green suites. The storage immutability test can emit its expected non-retryable streaming
  diagnostic. Neither warrants a 9G refactor.
- Local deterministic/fake-provider tests do not establish production provider readiness.

## Future activation notes and phase boundary

Next planned phase: **Phase 10 — Security / Operations Hardening**.
**Phase 10 does not start automatically.** This closure adds no production scheduler, provider,
ranking strategy, AI engine or generation/publishing feature.

Real provider enablement remains a separate reviewed Phase 11 decision. Existing
`PHASE_11_DISTRIBUTION_ACTIVATION_CHECKLIST.md` and `PHASE_11_ANALYTICS_ACTIVATION_CHECKLIST.md`
remain applicable; credentials, current provider policies, retention and production operating
controls must be reviewed there. No activation step is performed or preauthorized by Phase 9G.
