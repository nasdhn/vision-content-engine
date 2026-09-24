# Phase 10B — Secret Resolver / Credential Boundaries

## Model and inventory

Secret material belongs to runtime capabilities, never business state. `accountId`,
`authProfileKey`, provider names and credential references are non-secret identifiers.
Tokens, passwords, HMAC keys and authenticated browser state are credentials.

The inspection found these existing boundaries:

| Capability                     | Previous source / use                                           | 10B boundary                                                       |
| ------------------------------ | --------------------------------------------------------------- | ------------------------------------------------------------------ |
| PostgreSQL / Redis             | Central bootstrap config → local clients                        | Scoped resolver at client construction                             |
| S3-compatible private storage  | Central bootstrap config → SDK credentials                      | Lazy SDK credential provider                                       |
| Local authentication           | Config → session service                                        | Resolver callback at login; Phase 10A session rules retained       |
| Vision attribution             | Optional config → HMAC verification                             | Resolver callback per signature verification                       |
| Instagram / YouTube publishing | Injected account credential interface → adapter HTTP headers    | Environment-backed factory bound to one configured account         |
| Instagram / YouTube analytics  | Injected account credential interface → collector HTTP headers  | Same account-bound factory; scopes/expiry remain explicit metadata |
| Umami                          | Injected endpoint/site/token interface → API client             | Lazy token factory; endpoint/site remain non-secret configuration  |
| Capture                        | Injected profile → storage-state file path → Playwright context | Profile-bound resolver; absolute private regular file required     |
| AI                             | Fake structured providers only                                  | No real credential path exists; real providers remain rejected     |

No secret was found persisted by these credential paths. The concrete gaps were missing
central runtime wiring, permissive metadata/Outbox writes, and authenticated Playwright
traces that could export cookies or headers. No schema change is required.

## Resolver contract

`packages/shared/src/secrets.ts` supplies `SecretId`, `SecretResolver` and
`EnvironmentSecretResolver`. Its finite identifiers are:

- Existing bootstrap names: `DATABASE_URL`, `REDIS_URL`, `S3_ACCESS_KEY_ID`,
  `S3_SECRET_ACCESS_KEY`, `VCE_LOCAL_ACCESS_KEY`, `VCE_VISION_ATTRIBUTION_INGEST_SECRET`.
- Runtime-only names introduced for existing adapter capabilities:
  `INSTAGRAM_ACCESS_TOKEN`, `YOUTUBE_ACCESS_TOKEN`, `UMAMI_BEARER_TOKEN`,
  `CAPTURE_STORAGE_STATE_PATH`.

These are names, not values. No local environment contents are reproduced here.
Construct each resolver with an explicit allowlist and inject only the factory required by
the adapter. Unknown/ungranted identifiers, missing/blank values and the local-init placeholder
fail closed. Construction does not require disabled-provider credentials. Each resolution
reads the current environment object, with no application credential cache. Resolver fields
are private and JSON serialization fails; errors never echo input or underlying exceptions.

Account factories accept an exact deployment-configured account ID, not an arbitrary mapping
from job data to environment names. Capture similarly binds one profile. Factories return
ephemeral SDK/adapter credentials; callers must never log or persist these objects.

## Runtime use and persistence

Control creates canonical intent. Outbox dispatch and BullMQ carry strict IDs and operation
references. Existing adapters invoke their injected credential interface only when preparing
or executing provider operations. Resolution does not authorize an operation: worker gates,
ownership/compliance checks, pause flags, idempotence and reconciliation remain in place.

The recursive secret guard now covers cookies, storage-state contents/paths and credential
objects as well as existing token/password/header patterns. Outbox emission, analytics JSON
metadata and invocation policy/attempt/checkpoint writes use it. Explicit projections remain
the main protection: no runtime resolver or credential enters a workflow, JobAttempt,
ModelInvocation, audit, queue or API DTO. Settings expose only their existing safe projection.

Authenticated capture state is read locally by Playwright. The resolver requires a regular
file (no symlink), absolute path, no group/other permissions and a bounded size. State contents
are never returned as business data. Authenticated contexts never record/export traces, even
on failure; a scenario requiring a trace fails closed. Public fixture traces retain their
existing behavior. Screenshots/video still require the existing masking and safe fixture rules.

## Validation

`pnpm check:phase10b` runs formatting, lint, types, the existing secret scanner, resolver/auth
tests, stubbed publishing and analytics adapters, PostgreSQL metadata/Outbox checks, private
S3 tests, local BullMQ smoke and authenticated capture tests. No provider network is used.
Known synthetic credentials are checked against HTTP results, API responses, actual persisted
analytics/audit/Outbox data and queued data. Negative tests prove rejection before persistence.
Capture uses a temporary private cookie state and checks both success and failure exports.
The AI gateway remains fake-only and ModelInvocation metadata guards are tested separately.

`pnpm check:phase10a` protects local session behavior and browser storage. `pnpm check:phase9`
covers the broad regression, including real local PostgreSQL/Redis/S3, all browser tests,
the web build and analytics/distribution/learning queue smokes.

## Operational limits and future activation

- Real providers remain disabled and publishing paused. TikTok remains `MANUAL_HANDOFF`.
  Provider factories are prepared and tested with stubs; no live provider is bootstrapped.
- The V1 factories bind one configured account/profile per instance. OAuth refresh, external
  vaults, multi-account provisioning and automatic rotation are outside 10B.
- The resolver reads current in-process values; external environment changes require process
  restart. DB/Redis connections and SDK credential caches can require client recreation.
- Central `RuntimeConfig` still validates legacy bootstrap fields for compatibility; it is
  server-only and must never be serialized wholesale. Existing test/tool bootstrap code can
  still load local infrastructure credentials directly. No new secret-bearing DTO is added.
- Pattern/key guards are defense in depth, not detection of arbitrary secrets hidden in
  innocent text. Explicit projections and runtime-only injection remain required. Direct
  Prisma calls can bypass repository guards and must not accept credential objects.
- Local file permission validation assumes trusted local provisioning; it is not a vault or
  protection against a hostile local process changing the file after validation.
- Logs are secret-safe at the new boundaries; global structured/redacted logging is deferred
  to Phase 10C. No logging framework or global logging refactor is introduced.
- Future production activation must provision account-bound resolvers, least-privilege
  credentials and safe capture fixtures, then separately satisfy the existing Phase 11 gates.
  AI credentials remain N/A until a real provider boundary exists.

Schema, migrations, dependencies and analytics attribution semantics are unchanged.
