# Phase 11A — Generation Progressive Activation

**Status:** 11A-4A runtime composition candidate; 11A-3 real canary passed.

Phase 11 activates capabilities progressively. Generation is the first
capability in the frozen Phase 11 order.

## 11A-1 — reviewed activation path

11A-1 introduced the reviewed real-provider activation path without selecting,
connecting or calling a real external AI provider.

`VCE_REAL_PROVIDERS_ENABLED=false` remains the default.

The canonical activation decision requires both:

- a non-LOCAL environment;
- `VCE_REAL_PROVIDERS_ENABLED=true`.

`LOCAL` remains fake-provider only.

`StructuredProvider.kind` supports `FAKE` and `REAL`, but registration alone
does not authorize execution. `AIProviderGateway` defaults the real-provider
activation predicate to false and re-checks it immediately before each real
provider attempt.

All existing budget reservation, attempts, timeout, schema validation,
cost-accounting, pause and durable-invocation semantics remain in the gateway.

## 11A-2 — first concrete provider adapter

### Provider and model

The first concrete adapter is:

- provider: `groq`;
- model: `openai/gpt-oss-120b`;
- endpoint: `https://api.groq.com/openai/v1/chat/completions`;
- transport: native Node `fetch`;
- SDK dependency: none.

Provider capability and pricing were reviewed on 2026-09-26.

The model is treated as a pinned provider/model pair. Model changes require an
explicit code review rather than silently following a floating model alias.

### Secret boundary

`GROQ_API_KEY` is an authorized runtime-only `SecretId`.

The key:

- is not part of `RuntimeConfig`;
- is not part of DTOs;
- is not accepted in queue jobs;
- is not persisted;
- is not included in provider request bodies;
- is resolved only immediately before the HTTP invocation.

Normal LOCAL bootstrap and release smoke do not require the secret.

### Request mapping

The adapter maps the canonical `ProviderRequest` to Groq Chat Completions.

The frozen prompt remains the system instruction. The user message contains
the canonical envelope, output JSON schema and optional repair instruction.

11A-2 deliberately uses provider JSON Object Mode rather than making the
provider-specific strict-schema subset canonical. The existing gateway remains
the authority for:

- JSON parsing;
- Zod output validation;
- repair attempts;
- business-rule validation;
- reference and claim validation.

No tool use, browsing or streaming is enabled by this adapter.

For GPT-OSS, supported internal reasoning values are explicitly limited to:

- `low`;
- `medium`;
- `high`.

Unsupported reasoning values fail before credential resolution or networking.

### Estimator and currency

The provider budget currency is `USD`.

Reviewed pricing for `openai/gpt-oss-120b` on 2026-09-26:

- input: `$0.15 / 1M tokens`;
- output: `$0.60 / 1M tokens`.

The estimator is deliberately conservative:

- serialized UTF-8 request bytes are counted as input-token units;
- an additional fixed protocol allowance is added;
- requested maximum output tokens are priced at the full output rate;
- prompt-cache discounts are ignored for durable accounting.

Actual provider token usage is retained when returned, but cached input tokens
are also accounted at the full input rate. The system therefore does not rely
on a cache discount to remain under budget.

### Provider failure mapping

Before a real canary:

- HTTP `429` maps to `RATE_LIMIT`, nonbillable;
- HTTP `408` maps to `NETWORK`, nonbillable;
- HTTP `5xx` maps to `PROVIDER_5XX`, nonbillable;
- other non-success HTTP responses map to `PERMANENT`, nonbillable;
- transport failures map to `NETWORK`, nonbillable;
- malformed successful responses fail conservatively as `PERMANENT` and may
  be accounted as billable.

Gateway timeout ownership remains unchanged.

### Tests

11A-2 tests use an injected `fetch` implementation.

They prove:

- construction and estimation do not resolve credentials;
- no network occurs during tests;
- authorization material is header-only and absent from request bodies;
- request mapping is deterministic;
- token/cost usage is normalized to the gateway contract;
- HTTP and transport failures map to the existing provider-failure taxonomy;
- unsupported model parameters fail before secret resolution.

## Release boundary

11A-2 does **not**:

- add a real credential to the repository;
- add a provider SDK;
- enable `VCE_REAL_PROVIDERS_ENABLED`;
- unpause `PAUSE_AI_GENERATION`;
- make an external provider request;
- incur provider cost;
- activate capture, rendering, publishing, analytics or learning.

Operational release smoke remains deliberately fail-closed with real providers
disabled and all five emergency work classes paused.

## Next tranche

11A-3 is the explicit `LOW_COST_EXPLICIT_CANARY`.

It must require:

1. a runtime-only `GROQ_API_KEY`;
2. a non-LOCAL activation context;
3. explicit real-provider activation;
4. an explicit AI-generation unpause for the isolated canary path;
5. a hard USD budget;
6. one bounded request;
7. captured provider/model/usage/cost evidence;
8. immediate re-pause after completion.

11A-3 must never be part of normal CI or ordinary release smoke.

## 11A-3 — explicit low-cost canary harness

11A-3 uses a dedicated operational harness:

- `pnpm canary:ai:groq --dry-run`
- `pnpm canary:ai:groq --execute`

Dry-run is the default and performs no provider network call.

Real execution requires both:

- `AI_CANARY_CONFIRM=EXECUTE_ONE_GROQ_CALL`;
- `GROQ_API_KEY` supplied by the current shell.

The harness rejects `GROQ_API_KEY` if it is stored in the local `.env`.
The repository and persistent `.env` remain fail-closed:

- `VCE_ENV=LOCAL`;
- `VCE_REAL_PROVIDERS_ENABLED=false`;
- `PAUSE_AI_GENERATION=true`.

For the isolated process only, the execution harness constructs a reviewed
ephemeral `STAGING_CAPTURE` runtime configuration with:

- real providers enabled;
- AI generation unpaused.

No persistent configuration is changed.

The canary is pinned to:

- provider `groq`;
- model `openai/gpt-oss-120b`;
- reasoning `low`;
- one provider attempt;
- 20,000 maximum input tokens;
- 1,024 maximum output tokens;
- 30 second gateway timeout;
- `$0.01 USD` absolute reservation/budget ceiling;
- no fallback provider.

Before execution, the provider's conservative estimator must remain within the
same hard USD ceiling.

The canary uses the isolated active KnowledgeSnapshot key
`phase11-ai-canary`.

The real call traverses `AIProviderGateway` and the normal
`InvocationRepository` lifecycle so that provider, model, token usage, attempt
status and actual cost are durably accounted.

The harness invokes the Creator contract directly and does not call
`AIContentService`, therefore the canary must not create Concept or
ConceptVersion business records.

A successful real canary requires:

- exactly one ModelInvocationAttempt;
- the pinned Groq provider/model;
- a successful ModelInvocation;
- actual USD usage below the hard ceiling;
- exactly one AI CostEntry;
- zero linked ConceptVersion rows.

The real `--execute` command is never part of normal CI, normal release smoke,
or broad regression.

## 11A-3 real canary evidence — 2026-09-26

The first real Groq generation canary completed successfully from harness
baseline commit:

`c1d6c78a830dcc3899d755d7c1ee34bba8f2e5e3`

Durable execution evidence:

- ModelInvocation:
  `d21caffa-93bc-47cf-a4ba-60f655a47ca7`;
- invocation status: `SUCCEEDED`;
- invocation attempt count: `1`;
- attempt status: `SUCCEEDED`;
- provider: `groq`;
- model: `openai/gpt-oss-120b`;
- reasoning level: `low`;
- actual input tokens: `1839`;
- actual output tokens: `369`;
- cached input tokens: `0`;
- actual provider cost: `$0.00049725 USD`;
- durable CostEntry: `$0.00049725 USD`;
- hard canary budget ceiling: `$0.01 USD`;
- linked ConceptVersion rows: `0`.

The conservative pre-call adapter estimate for the exact harness request was
`$0.00229320 USD`, remaining below the `$0.01 USD` hard ceiling before the
provider was invoked.

The real execution used exactly one provider attempt and no fallback.

After execution:

- `GROQ_API_KEY` was removed from the canary shell;
- no Groq credential was written to `.env`;
- persistent `.env` remained `LOCAL`, AI-paused and real-provider-disabled;
- repository HEAD and worktree remained unchanged by the provider call.

This evidence establishes that the reviewed Groq adapter, real-provider gate,
AIProviderGateway, InvocationRepository, token accounting and durable cost
accounting operate successfully against one real provider request.

It does **not** establish normal application generation activation.

The dedicated canary harness invokes the Creator contract directly. The normal
API/worker composition still does not register Groq as the generation provider
for ordinary Creator / Creative Director execution.

Therefore:

- 11A-3 real canary: **DONE**;
- normal generation runtime activation: **PENDING**;
- capture activation: **NOT STARTED**.

## 11A-4A — fail-closed normal generation composition

11A-4A introduces the normal generation composition root in `worker-ai`
without yet introducing a generation planner, queue consumer or user-facing
trigger.

The composition is:

```text
GroqStructuredProvider
        ↓
AIProviderGateway
        ↓
AIContentService
```

`createAIGenerationRuntime()` is side-effect free at construction time:

- it does not resolve `GROQ_API_KEY`;
- it does not contact Groq;
- it does not access PostgreSQL.

The Groq credential remains a runtime-only lazy capability supplied through
the existing `SecretResolver`.

The gateway receives live predicates for:

- `PAUSE_AI_GENERATION`;
- `isRealProviderActivationEnabled(config)`.

Registering the real adapter therefore does not itself authorize execution.

The default LOCAL configuration remains protected first by
`AI_GENERATION_PAUSED`.

A separate non-LOCAL, unpaused configuration with
`VCE_REAL_PROVIDERS_ENABLED=false` is rejected with
`REAL_PROVIDERS_DISABLED`.

Both safety barriers are verified before:

- durable ModelInvocation reservation;
- PostgreSQL access;
- Groq credential resolution;
- provider networking.

Construction with an explicitly enabled non-LOCAL configuration is also
verified to remain lazy: merely composing the runtime performs no database,
secret or network access.

11A-4A adds no:

- provider call;
- provider cost;
- database schema or migration;
- JobAttempt;
- WorkflowRun;
- BullMQ queue;
- API route;
- capture activation;
- render activation;
- distribution activation.

### Remaining 11A-4B boundary

Normal asynchronous Creator execution is still pending.

The existing repository already defines and tests the canonical durable AI
execution identity:

- queue name `ai`;
- job type `AI`;
- recovery policy `SAFE_RETRY`;
- JobAttempt lease fencing;
- atomic AIContentService result persistence with job completion.

The frozen workflow specification requires a new immutable BriefVersion
snapshot before each concept-generation request.

11A-4B must introduce the smallest durable planner/worker path that
reconstructs Creator options from canonical PostgreSQL state and executes the
existing AIContentService under the `ai` job lease.

11A-4B must not make queue transport canonical and must not activate Capture.
