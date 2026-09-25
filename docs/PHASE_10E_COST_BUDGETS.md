# Phase 10E — Cost Limits / Budget Operations

## Existing model, retained

Inspection found an existing durable AI budget implementation, not abstract cost
units: `AIProviderGateway`, `InvocationRepository`, `ModelInvocation`,
`ModelInvocationAttempt` and `CostEntry`. 10E hardens these boundaries and adds a
private read model. No billing, customer quota, provider pricing lookup, migration,
new budget table or automatic reconciliation is introduced.

A trusted caller supplies `{ key, from, to, limit, currency }` and `ModelPolicy`.
The budget key/window identifies a shared pool. Currency is mandatory; no exchange
rate or implicit conversion exists. Decimal strings use the existing PostgreSQL
`numeric(18,8)` domain. Tests use synthetic EUR amounts, not real provider prices.
There is no `maxCostUnits` contract: its equivalent here is the monetary
`maxEstimatedCost` per logical invocation, within the shared `budget.limit`.

`maxAttempts` is the existing per-invocation provider-call cap. Each initial,
repair, fallback or transport retry that actually calls a provider uses another
`ModelInvocationAttempt`. Failed and explicitly nonbillable calls still count.
No second `maxProviderCalls` policy field is added; the read model exposes the
existing cap under that descriptive name. Shared pools cap money, not a separate
pool-wide request quota. Token limits and per-attempt `timeoutMs` remain distinct
dimensions.

## Authorization and numeric validation

Before executing `provider.generate`, the gateway validates the explicit budget,
policy, input, knowledge context, provider selection and conservative estimate.
Under a PostgreSQL advisory lock for the budget key, `begin` reserves the whole
invocation ceiling. It accounts RUNNING invocations at the greater of their full
reserved ceiling and already-accounted cost, and terminal invocations at their
finalized accounted cost. Attempt accounting updates the logical cost total in
the same transaction, retaining known overruns across a crash before finalization.
Conflicting policies or overlapping windows for a key are refused. A reservation cannot exceed the
shared remaining limit or differ from the invocation policy ceiling.

`startAttempt` locks the invocation row, checks the persisted window, verifies the
remaining call count, refuses another RUNNING attempt, and checks:

```text
finalized attempt costs + requested conservative estimate <= invocation reservation
```

The attempt is durably committed and the count incremented before the provider
call. Provider work runs outside the transaction. Database unavailability denies
execution. Equality is allowed. There is no permission returned for an already
RUNNING attempt; ambiguous authorization must not replay the provider call.

Budgets reject missing values, negative/NaN/Infinity values, scientific notation
in decimal strings, excess precision, unsupported numeric sizes and reversed
windows. `maxEstimatedCost` remains the existing JavaScript number contract but
must round-trip at eight decimal places and fit its supported range. The gateway
converts it to an exact decimal string, including small values such as 1e-8.
Attempt counts, timeouts and token fields fit signed PostgreSQL integers; token
limits also account for the maximum number of attempts to prevent aggregate
overflow. Zero cost permits an explicitly free estimated call; `maxAttempts=0`
remains invalid under the frozen positive-count contract.

Primary denial codes are `BUDGET_REQUIRED`, `INVALID_BUDGET`,
`INVALID_MODEL_POLICY`, `BOUNDED_POLICY_REQUIRED`, `COST_BUDGET_BLOCK`,
`ATTEMPTS_EXHAUSTED`, `BUDGET_WINDOW_CLOSED`, `BUDGET_POLICY_CONFLICT` and
`BUDGET_LEDGER_INCOMPLETE`. No fallback bypasses a denial.

## Finalization, retries and crashes

A logical invocation keeps the existing request/operation UUID. Re-delivery of
that UUID cannot create another invocation/reservation or grant another provider
call. Gateway re-entry returns `INVOCATION_ALREADY_EXISTS`; it does not fabricate
or reconstruct an output. Weekly Analysis retains its existing successful-output
checkpoint path and reuses that output without calling the provider again.

Concrete provider attempts have unique `(modelInvocationId, attemptNumber)`
identities. A retry after a known provider attempt is another real call and consumes
another slot. It is not conflated with a transport redelivery of the logical task.

Attempt finalization stores a deterministic fingerprint in its existing typed
validation metadata. Replaying identical finalization returns the existing row
without duplicating `CostEntry`. A conflicting replay fails with
`ATTEMPT_FINALIZATION_CONFLICT`. Logical finalization has the same behavior for
its status/output/checkpoint, avoiding duplicate audit or Outbox events. Legacy
terminal rows without a fingerprint remain non-replayable; their accounting is
readable and they cannot be charged again through a duplicate invocation.

Accounting rules:

- Pre-provider validation failure: no call/cost. A reservation made before an
  invalid quote is released by a terminal invocation with zero attempted cost.
- Reported valid usage: retain the exact amount and currency; create `CostEntry`.
- Provider error, timeout or missing/invalid usage: account the conservative
  estimate, without manufacturing reported usage or a CostEntry.
- Explicit trusted `ProviderFailure(..., false)`: known zero cost; the call slot
  remains consumed. This existing distinction is retained.
- Schema or hard validation failure after provider execution: account the call;
  invalid output is not free. Unknown costs cannot be finalized below their bound.
- Reserve then crash, or provider returns then crash before finalization: keep the
  invocation/attempt RUNNING and retain the greater of the entire reservation and
  already-accounted cost. No timed refund,
  retry authorization, global reconciliation or recovery is added.
- Adapter reports more than its promised upper bound: reject the output, preserve
  the reported cost and expose overrun. Later shared reservations are refused.
  No mechanism can retroactively prevent an untruthful adapter from exceeding its
  quote; real adapter calibration and provider-side hard caps belong to Phase 11.

## Other integrated providers

The AI gateway still accepts only FAKE adapters. `VCE_REAL_PROVIDERS_ENABLED=false`
and `PAUSE_ALL_PUBLISHING=true` remain unchanged. No real call is used in tests.

Inspection also covered the existing non-AI adapters:

| Path                        | Existing boundary retained                                                                                       |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Instagram publishing        | Global provider/publishing gates, durable publication attempt, max publish retries and bounded container polling |
| YouTube publishing          | Same gates; chunk upload tied to finite asset bytes and bounded recovery attempts                                |
| Instagram/YouTube analytics | Provider gate and finite endpoint requests per collection; no priced cost ledger exists                          |
| Umami import                | Provider gate and validated finite `maxPages` (at most 100)                                                      |
| TikTok                      | Manual only                                                                                                      |
| Capture / render            | Local Playwright / FFmpeg / Remotion, existing duration limits; no invented CPU price                            |
| S3                          | Existing private storage operations; storage/egress billing is not modeled in 10E                                |

No real tariff is assumed for APIs whose current contracts expose no monetary
cost. Their existing request/retry limits and gates are preserved. Adding a new
billable adapter requires a truthful cost boundary before activation; the API
read model does not imply that these paths have an AI monetary budget.

## Private operational read model

`GET /api/operations/budgets/:operationId` reuses the 10A session boundary and sends
`Cache-Control: private, no-store`. The operation UUID is validated; missing rows
return 404 and invalid/unavailable accounting returns a generic 503. There are no
mutation routes or budget editing UI. `/api/operations/runtime` remains unchanged.

The read uses PostgreSQL REPEATABLE READ with a read-only transaction, statement
and transaction timeouts. It projects:

- Operation: call cap/consumed/remaining, monetary ceiling, accounted cost,
  reported cost, unknown-cost upper bounds, pending-call reservation and remaining
  monetary headroom. Terminal status still forbids execution even if nominal
  unused headroom remains.
- Shared scope: stable hash identity, window, currency, limit, RUNNING invocation
  reservations, terminal invocation consumption, remaining capacity, calls consumed
  and overrun flag. Finalized attempts within a RUNNING invocation remain covered
  by its scope commitment (at least the full reservation); they are not counted twice.

Amounts are decimal strings. Raw budget keys, policy JSON, prompts, provider
payloads, credentials and connection URLs are never returned. A snapshot is not a
provider authorization; only the locked gateway/repository boundary grants one.
The lookup starts with one operation UUID and aggregates its shared scope in SQL;
no unbounded list of all budgets is returned. The existing JSON ledger has no
budget-key index: large installations may hit the read timeout. An indexed durable
budget registry, if needed later, requires an explicit schema decision.

10C logging adds `budget.reserved`, `budget.denied`, `budget.finalized` and
`provider_call.denied`, with safe operation UUIDs, attempt counts and allowlisted
error codes. It never logs budget records, raw keys, usage bodies or prompts.

## Validation

`pnpm check:phase10e` runs formatting, lint, types, secret scanning, numeric/budget
unit tests, authenticated API tests and PostgreSQL tests exercising the production
AI gateway with counting fake providers. They cover exact/zero/exhausted budgets,
call caps, conservative failures, pre/post-call validation, operation isolation,
concurrent shared reservations and attempt authorizations, duplicate finalization,
logical redelivery, expired windows, currency isolation and ambiguous crashes.
The pre-existing AI suite checks known nonbillable failures, timeouts, token
limits, fallback/repair and successful application behavior.

Required regressions remain `check:phase10a`, `check:phase10b`, `check:phase10c`,
`check:phase10d`, `check:phase9` and the Remotion smoke. Only an internal workspace
link from AI to the existing observability package is added. No external package
version, Prisma schema, migration, Learning policy or provider activation changes.
