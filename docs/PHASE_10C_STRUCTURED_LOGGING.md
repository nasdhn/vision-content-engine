# Phase 10C — Structured / Redacted Logging

## Inventory and changes

Before 10C, the API bootstrap emitted two fixed JSON console messages. The local infrastructure
canary and CLI/test scripts printed fixed progress messages. Nest logging and Prisma query
logging were disabled. Control and worker orchestrators had no structured outcome logging.
No log level configuration existed. The natural home is the existing `@vision/observability`
package, which already contains readiness probes.

The render path retained free-form browser console messages in diagnostics and concatenated
error/cause text into failure diagnostics. Browser output is now represented by a fixed marker;
render failure diagnostics use the existing classified code. Rendering, QA, persistence status,
idempotence, leases and retries are unchanged. Authenticated capture tracing remains disabled.

## Boundary

`StructuredLogger` emits a JSON line with `timestamp`, `level`, `component` and a fixed `event`.
The default level is `info`; a constructor option enables `debug`. Info/debug use stdout;
warn/error use stderr. The sink is synchronous and injectable for tests. Logging exceptions
are swallowed. `observeOperation` returns the original result or rethrows the original error;
it never opens a transaction or serializes the operation's result/payload.

Runtime events use an explicit field allowlist, not an arbitrary metadata object:

- Existing UUID identifiers: operation, collection operation, workflow run, job attempt,
  publication/attempt, Outbox event, render/attempt, capture run and experiment.
- Enumerated provider/platform/queue, status and HTTP method.
- Bounded numeric duration, attempt and HTTP status.
- Explicitly recognized error codes and a safe error projection.

Unknown fields, arbitrary identifier strings, raw requests/responses, headers, paths and URL
queries are omitted. No new correlation identifier or persistent log entity is introduced.
Unknown error codes become `UNKNOWN_ERROR`: a new operational code must be consciously added
at the logging boundary. Error messages are never trusted merely because they look uppercase.

## Redaction and errors

The bounded recursive sanitizer handles objects and arrays, sensitive key variants, URL strings,
Error, Date, BigInt, cycles, binary objects, undefined and functions. It does not invoke getters
or `toJSON`. Traversal is limited to depth 5, 100 visited values, 20 entries per container and
512 characters per string. Larger values become fixed markers. No buffers are serialized.

Sensitive keys include passwords, secrets, API/access keys, tokens, authorization, cookies,
sessions, CSRF, signed/presigned URLs, authenticated storage state, credential objects,
headers, environment, payload/body/prompt/snapshot and process output. `credentialRef`,
`credentialsRef` and `secretRef` remain non-secret references in the sanitizer; current runtime
logs do not need these fields. Every URL value is suppressed, including userinfo, path, query,
signature and fragment. Runtime callers log canonical IDs instead of URLs.

`safeError` retains only a fixed name and a recognized code. It drops free-form message, stack,
cause, custom name, request/response, headers and SDK configuration. This deliberately trades
some diagnostic detail for safety. The sanitizer alone cannot recognize an arbitrary secret
hidden in innocent text; the runtime field allowlist is therefore mandatory.

## Runtime wiring

| Surface          | Events and correlation                                                                                                                                                                   |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API              | Startup/failure; completed HTTP response with method, status, duration; login failures with fixed auth code. No request body, header, route/query or client-supplied correlation header. |
| Control          | Queue enqueue success/failure with canonical operation and Outbox event IDs. An enqueue log does not claim that the Outbox acknowledgement transaction committed.                        |
| AI worker        | Validated weekly job outcome with operation/workflow/job IDs; no prompt, knowledge snapshot or output.                                                                                   |
| Capture worker   | Claimed job outcome with operation/workflow/job IDs; no storage-state path, cookies, page content or diagnostics object.                                                                 |
| Render worker    | Invocation outcome with render/attempt IDs; no media URL, payload or raw process/browser output.                                                                                         |
| Publish worker   | Validated job outcome with operation/publication/attempt IDs; provider exceptions use platform and safe error projection.                                                                |
| Analytics worker | Validated job outcome with collection operation/workflow/job/publication IDs and platform.                                                                                               |

BullMQ worker and transport error events use the same safe logger. Schema-invalid jobs are
rejected before processing; no unvalidated payload is logged. API requests do not invent
workflow IDs where none exists. Existing worker/provider gates stay independent from logging.

## Exceptions and limits

- The local infrastructure canary, local setup/migration scripts and synthetic test utilities
  retain their fixed console progress output. The secret scanner reports paths only.
- Nest's generic logger and Prisma query logger remain disabled. No global console monkey patch,
  process handler, SQL logging or remote collector is installed.
- Remotion browser output callbacks suppress content, and renderer verbosity is reduced to its
  supported `error` level. Dependency-internal diagnostics and Node/tool warnings are outside the
  application logger; dependency upgrades require reviewing their output behavior. No real
  provider credentials are supplied to those rendering tools.
- The sink is best effort, synchronous and has no delivery/retry guarantee. It is not an audit
  store. Events emitted after a process crash can be lost.
- Allowlisted fields and UUIDs must still be genuine operational identifiers. Deliberately
  encoding secrets into permitted IDs is outside this boundary's detection capability.
- No heartbeat/queue health, metrics, trace spans, alerting, dashboards or remote shipping is
  introduced. Existing job lease heartbeats are untouched. Those next steps remain 10D+.
- Real providers remain disabled; publishing paused; TikTok remains `MANUAL_HANDOFF`.

## Validation

`pnpm check:phase10c` covers format, lint, types, secret scan, recursive redaction and error tests,
throwing sinks/hostile values, and runtime API-auth, worker/provider-stub and control failures.
Sentinels exist only in synthetic tests and must be absent from final log lines. The tests also
check preserved UUID correlation, unchanged exception identity and transaction call count.

Required regression: `pnpm check:phase10a`, `pnpm check:phase10b`, `pnpm check:phase9`. Rendering
is additionally checked with the existing local Remotion smoke after its output policy changes.
No schema/migration or external dependency is added. Six workspace manifests and the lockfile
only link the already existing observability package into control and workers.
