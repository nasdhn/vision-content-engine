# Phase 10D — Worker Heartbeats / Queue Health

10D adds operational observations. PostgreSQL remains canonical for workflows,
attempts, leases and Outbox. No schema/migration, job payload, provider gate,
retry, recovery or publishing behavior changes. Real providers stay disabled;
publishing stays paused; TikTok stays manual.

## Runtime inventory and lifecycle

Inspection found three BullMQ queues: `ai` (weekly analysis), `vce-publication`
and `vce-analytics`. Capture claims PostgreSQL `JobAttempt` rows in `capture`;
render executes `RenderAttempt` rows. Control runs caller-owned planning/dispatch
operations, without its own queue. `vce-analytics-manual` is a PostgreSQL workflow,
not a BullMQ queue. No fictional capture/render/learning/control queue is added.

The repository has an API bootstrap, but no standalone worker/control daemon
entrypoints. Raw orchestrator construction does not prove a process is running.
The supported process owners now start runtime observation through:

| Component          | Start                                                                        | Graceful stop                                                      |
| ------------------ | ---------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `worker-ai`        | `await createBullMqWeeklyAnalysisWorker({ redisUrl, orchestrator, probes })` | `await worker.close()`                                             |
| `worker-publish`   | `await createBullMqPublishWorker({ redisUrl, orchestrator, probes })`        | `await worker.close()`                                             |
| `worker-analytics` | `await createBullMqAnalyticsWorker({ redisUrl, orchestrator, probes })`      | `await worker.close()`                                             |
| `worker-capture`   | `await startCaptureWorkerRuntime(orchestrator, options)`                     | `await runtime.close()`                                            |
| `worker-render`    | `await startRenderWorkerRuntime(orchestrator, options)`                      | `await runtime.close()`                                            |
| `control`          | `await startControlRuntime(options)`                                         | Drain the caller-owned dispatch loop, then `await runtime.close()` |

The three BullMQ factories are now asynchronous. They reuse the existing
non-blocking backend connection; no extra Redis connection per heartbeat.
`probes` are callbacks over the caller's existing PostgreSQL/storage clients.
Redis PING is supplied automatically. Capture/render/control `options` contain
`{ store: new RedisHeartbeatStore(() => existingRedisClient), probes }`.
Use the returned capture `processOne` / render `execute` methods: close rejects
new work, waits for outstanding calls and then removes the heartbeat. BullMQ close
locally pauses consumption and drains active work before removing the heartbeat
and closing connections. No global queue pause is introduced. The process owner
must wire its signal handler to close, as it already owns its shutdown policy.

Start exactly one runtime session per component instance at process startup,
not per job. Each gets a random UUID, immutable `startedAt` and refreshed
`lastSeenAt` (epoch milliseconds). No hostname, address, environment or fabricated
build version is recorded. Existing render `workerVersion` remains an attempt
attribute, not a newly invented process/build identifier.

## Redis heartbeat model

The shared observability package stores under `vce:runtime:{component}:`:

- `instance:<uuid>:alive`: 45-second Redis TTL, refreshed every 15 seconds.
- `instance:<uuid>`: safe metadata/readiness, retained for 5 minutes.
- `instances`: last-seen sorted index, also expires after 5 minutes without writers.
- `instance:<uuid>:stopped`: 5-minute shutdown tombstone preventing an in-flight
  write from reviving an instance after close.

A Lua write updates the records/index atomically and removes expired index entries.
Redis server time scores the index. A write more than 45 seconds from server time
is rejected, so delayed commands cannot revive a dead runtime. Worker clocks must
be reasonably synchronized (within 45 seconds of Redis). UUID identity is stable
for the session; restart creates another UUID.

`HEALTHY` means the alive key exists, independent of readiness. After a crash,
Redis expires that key and the retained instance becomes `STALE`. After metadata
retention, the instance disappears; a component with no retained instances is
`MISSING`. A successful graceful stop deletes both keys/index membership.
A component can have healthy and stale instances simultaneously: its aggregate
status is HEALTHY if any is alive, while each instance keeps its own status.
There is no expected replica count, so this does not assert all replicas exist.

Reads return at most 100 recent instances per component and report `truncated`.
When Redis cannot be read, `available: false` replaces any freshness verdict;
unavailability is never reported as MISSING. Metadata is validated and projected
onto an explicit allowlist before returning it. Heartbeat failures log a safe
warning and leave canonical work alone. Old records expire naturally. Refreshes
are coalesced; the Redis store allows only one outstanding write per instance.

Timers are unreferenced, clocks injectable, and readiness/storage operations have
2-second observation timeouts. The existing API Redis client also bounds commands
at 1.5 seconds and disables offline buffering. Callers supplying their own Redis
clients should use bounded commands and disabled offline buffering. On shutdown
failure, Redis TTL still removes liveness. Observability does not terminate jobs.

## Readiness

`/healthz` remains API process liveness. `/readyz` keeps its existing checks and
503 response when a required dependency fails. Operations reuses those same
PostgreSQL SELECT 1, Redis PING and S3 HeadBucket probes, with their existing
clients, credentials boundary and timeouts. It does not write storage objects.

Worker probes select only required infrastructure:

| Components               | Dependencies               |
| ------------------------ | -------------------------- |
| control, AI, analytics   | PostgreSQL, Redis          |
| capture, render, publish | PostgreSQL, Redis, storage |

Missing required callbacks and probe failures produce `not_ready`, even when the
heartbeat itself is alive. No provider calls are made. Disabled Instagram/YouTube,
manual TikTok and paused publishing do not cause a readiness failure. For stale
instances, readiness is the last reported observation, not a current guarantee.

## Queue observations

Each actual BullMQ queue exposes `waiting`, `active`, `delayed`, `failed`,
`completed`, `prioritized`, legacy `paused` counts, and `isPaused`.
BullMQ 6 pauses via its metadata flag while jobs remain in `wait`; `paused` counts
only the older paused list, if present. The flag therefore matters even when that
count is zero. Failed/completed counts include retained history and are not rates.
A retry is counted in its current state only, without summing attemptsMade.

`RedisQueueHealthReader` uses BullMQ `QueueKeys` prefixes and bounded read-only
Lua over the actual Redis lists/sets. This avoids BullMQ getters' legacy-marker
cleanup and fetches only timestamps, never job data, results or failure messages.
The adapter targets the installed BullMQ 6 layout; its real-runtime smoke guards
upgrades. No extra Queue/Worker is constructed by the API.

`oldestPendingAgeMs` is age since original enqueue (`timestamp`) among sampled
waiting, prioritized and legacy-paused jobs. Delayed jobs are counted separately
and excluded: intentional schedules are not flagged as blocked backlog. Retried
jobs keep their original enqueue time, so this is not time in the current state.
`oldestActiveAgeMs` uses `processedOn`, the current execution start. Empty samples
return null, never a fabricated zero.

Reads examine at most 100 IDs per state (400 IDs total per queue). When a relevant
count exceeds 100, `pendingSampleComplete` or `activeSampleComplete` is false:
the reported age is an observed lower bound, not a guaranteed global oldest age.
Counts/samples are consecutive observations, not a cross-query transactional
snapshot; concurrent transitions can produce small discrepancies. Priority/retry
ordering makes it unsafe to claim the first queued ID is always globally oldest.

Ages, pause flags and retained failures expose backlog/stagnation for inspection.
No arbitrary active-age threshold or stalled verdict is added, especially for
long render/capture work. PostgreSQL attempt ages remain in existing business
read models; they are not represented as fake BullMQ queues. Canonical lease
heartbeats and BullMQ's own stalled/retry handling are untouched.

## Private Operations API and limits

`GET /api/operations/runtime` is registered in the API bootstrap behind the 10A
local session boundary. Successful and service-error responses use
`Cache-Control: private, no-store`; unauthenticated requests are refused before
any health read and retain the auth filter's no-store policy. There is no write
route. Concurrent reads are coalesced. Dependency and observation failures are
safe `not_ready` / `available: false` values; unexpected failures return a generic 503. Only component names, UUIDs, timestamps, readiness, counts and ages leave the
boundary. No DSN, Redis URL, credentials, hostname, cookies or environment dump.

No existing Operations UI was found, so this tranche adds only the API. It does
not start workers automatically: components without a started runtime correctly
appear MISSING. Historical uptime, durable worker inventory, expected replicas,
alerts, restarts, retries, queue repair/purge, cost limits and budgets are outside
10D. Redis loss also loses operational history, never canonical business state.

The 10C allowlisted logger adds `worker.started`, `worker.stopped`,
`heartbeat.failed`, `queue.health_read_failed` and `dependency.not_ready`.
Exceptions and responses are never logged verbatim.

## Validation

`pnpm check:phase10d` runs format, lint, types, secret scanning, deterministic
heartbeat/readiness/queue tests, authenticated API tests and local runtime smoke.
The smoke uses local PostgreSQL/Redis/storage, isolated queue prefixes and owned
heartbeat UUIDs. It checks all six component types, multiple instances, real TTL
expiry via immediate PEXPIRE, graceful stop/tombstones, actual BullMQ
waiting/active/delayed/failed/paused behavior and oldest ages. Cleanup only removes
its own queues/keys; no global scan or purge. No provider is invoked.

Regression gates: `check:phase10a`, `check:phase10b`, `check:phase10c`,
`check:phase9`, plus the Remotion smoke. No new external package/version: API
explicitly links the existing BullMQ 6.3.8 dependency for QueueKeys.
