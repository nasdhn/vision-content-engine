# Phase 10A — Local auth hardening

Baseline: `1ebcdc1235f0f86b276bbd66512d74716773094c` on `phase/9-learning`.

## Model and audit

The existing `LocalSessionService` remains the shared boundary used by API controllers. This is
local single-operator authentication, not a new identity system. One opaque 256-bit random session
token and an independent 256-bit CSRF token are held in process memory. Each successful login
replaces the previous session and CSRF token; supplied cookies are never adopted. Restarting the
API invalidates sessions. PostgreSQL remains canonical for business state, unchanged by auth.

The audit found secure cookie attributes, timing-safe SHA-256 digest comparison, exact Origin
checks, per-session CSRF and bounded single-session storage already present. 10A retains these.
It fixes the exact expiration boundary, rejects duplicate/malformed session cookies, makes login
input strict and tests the existing security properties. Invalid server key/origin configuration
fails closed with a generic error.

Malformed JSON previously caused Nest's body-parser error response to echo a fragment of the
request body. A filter registered at the application boundary sanitizes HTTP 400 errors only on
POST session/logout routes, including case/trailing-slash variants. Registration is global because
body parsing precedes controllers; unrelated routes retain the existing exception handling. No
logging redesign is introduced.

## Policies

- Cookie: `__Host-vce`, `Secure`, `HttpOnly`, `SameSite=Strict`, `Path=/`, no `Domain` attribute.
  Login uses `Max-Age=28800`; logout uses identical scope/security attributes and `Max-Age=0`.
  Login and logout responses, including auth failures, use `Cache-Control: no-store`.
- TTL: eight hours from login, no sliding renewal. The server rejects at `now >= expires`,
  independently of browser cookie expiry. An injected clock enables deterministic boundary tests.
- Writes and logout require both the current session's `X-CSRF-Token` and an exact configured
  `Origin`. Missing, external, malformed or `null` origins fail closed. No Referer fallback,
  localhost bypass or forwarded-header trust is added. Reads require the session; existing
  same-origin browser credentials and absence of permissive CORS remain unchanged.
- Login accepts only `{ accessKey: string }`, length 32–256, and requires the expected Origin.
  Credentials are compared using Node `timingSafeEqual` over fixed-size digests. Invalid credentials
  receive `AUTH_FAILED` (401); malformed JSON receives `AUTH_INVALID_INPUT` (400), without fragments.
- Limiter: at most 20 failed credential validations in five minutes starting at the first failure;
  subsequent attempts receive `AUTH_RATE_LIMITED` (429), including correct credentials. The block
  ends at the exact window deadline; blocked attempts do not extend it. A successful login before
  blocking clears the failure count and does not consume the budget. Bad Origin requests and JSON
  parse errors never reach credential comparison and do not consume this bucket.
- The limiter is one global **process-local** bounded counter/window, not a Map per IP. Spoofed
  forwarded IPs cannot create fresh buckets. It neither sleeps nor retains unbounded timestamps.
- Authenticated logout requires CSRF/Origin, revokes the server session and deletes the cookie.
  Replaying the previous cookie/CSRF cannot access protected reads or writes.
- The frontend uses the HttpOnly cookie via same-origin requests. CSRF stays in transient memory;
  the entered key is cleared after successful or failed login. Credentials/session secrets are not
  stored in localStorage, sessionStorage, globals or URLs. Login preserves the requested deep link.

## Verification

`pnpm check:phase10a` runs formatting, lint, typecheck, secrets, the dedicated unit/API auth matrix,
then browser auth/deep-link checks through the actual session mechanism. `pnpm check:phase9` is
also required for the complete historical regression; its inherited Phase 8 gates need not be
run again separately.

- `tests/unit/local-session.test.ts`: cookie policy, fixation, exact TTL, logout, CSRF, Origin,
  malformed input/configuration, ambiguous cookies, limiter threshold/recovery/success behavior.
- `tests/integration/auth-session-api.test.ts`: real HTTP requests across Learning, Analytics,
  Concept review, Render review and Distribution, with business-service spies proving rejected
  requests never reach business actions; expiry, logout, limiter and JSON-error redaction.
- `tests/browser/auth-session.spec.ts`: desktop/mobile unauthenticated Learning deep links, failed
  login key clearing, secure HttpOnly cookies, reload, logout/replay, empty browser storage and
  absence of secret values in browser console output.

Controllers explicitly invoke the shared service; this is not a global authorization guard.
Representative domain tests prove its use on existing routes. Health/readiness remain public;
signed Vision attribution ingest retains its separate HMAC boundary.

## Remaining limits and scope

Sessions and limiting are process-local. Restart resets the limiter, concurrent API processes
would have separate buckets, and an attacker able to reach the login endpoint can temporarily
deny login to the single operator. Each window ends automatically, but repeated attempts can
consume subsequent windows; this limiter does not prevent availability attacks. Distributed
identity/rate limiting and production exposure require a separate review.

Secure cookies are retained for local Chromium's localhost behavior; deployment beyond this local
model needs actual HTTPS. No insecure-cookie fallback is introduced for tests.

No schema, migration, dependency, frozen decision, AI prompt or provider behavior changes.
`VCE_REAL_PROVIDERS_ENABLED=false` and `PAUSE_ALL_PUBLISHING=true` remain required.
No 10B secret resolver, 10C logging, 10D+ operations or Phase 11 activation is implemented.
