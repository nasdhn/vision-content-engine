# Local Recording Pack

Use project Node 24.21.0 / pnpm 10.34.5 and an installed ffprobe (ffmpeg is also required for tests).

```sh
pnpm install --frozen-lockfile
pnpm local:init
pnpm infra:up
pnpm prisma:generate
pnpm db:migrate:local
pnpm dev:api
# In another terminal:
pnpm dev:web
```

Open `http://localhost:5174`. Read `VCE_LOCAL_ACCESS_KEY` privately from the ignored `.env`
and enter it in the login form. Do not print/share/commit the key. `local:init` preserves
existing service credentials and adds only a missing local access key.

This is a LOCAL-only session adapter, with an HttpOnly/Secure/SameSite=Strict cookie,
8-hour in-memory sessions, exact origin + CSRF checks on writes and bounded login attempts.
Use localhost, whose secure-context treatment permits the secure cookie in the tested Chromium
browser. No CORS grants, public media URLs or credential-bearing URLs are exposed. Restarting
the API invalidates sessions. Deployment auth/TLS hardening is outside Phase 3.

Creative Director now materializes RecordingRequests in its existing persistence transaction.
Startup catches up existing active Phase 2 plans idempotently. The UI shows the latest exact
CreativePlanVersion, exact script segments, duration, framing, position, gesture and background,
with an indicative layout. Upload multiple raw takes through the file picker or drag/drop.
Preview/select/reject/deselect them independently. There is no additional Approval gate.

Rejecting/deselecting the last valid selected take reopens the request to UPLOADED. Selecting
again restores ACCEPTED. Another valid selected take keeps it ACCEPTED. Take mutation,
request status, current-plan readiness, audit and outbox changes commit/roll back together.
Captures are not executed: any declared capture requirement remains unfulfilled in Phase 3.
Future production consumers must recheck exact-version input readiness through
`UnitOfWork.recordings.refresh(versionId)` in their own persistence transaction.

Uploads use unique new keys; retrying means uploading a new take. A failed upload does not
become READY. Failed originals are retained privately under their tracked Asset; no automatic
canonical-object deletion or schema migration is introduced. Displayed packs are bounded to
the 100 most recently created active plan roots; each uses its latest immutable version.

Validation:

```sh
pnpm check:phase3
pnpm test:infra
```

The browser suite launches its own disposable PostgreSQL fixture API and a Vite server;
ports 3100 and 5174 must be free. Storage tests use disposable private buckets on local
SeaweedFS. Neither suite clears the application database or publishes externally. Browser
screenshots are emitted under ignored `test-results/` for visual review. The workflow at
`.github/workflows/phase0.yml` runs existing gates plus media/storage/browser acceptance.
