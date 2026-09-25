# Phase 10F — Storage / Disk / Capacity Hardening

## Inventory and ownership

| Surface                                                              | Owner / classification                                      | Completion and cleanup                                                                                     |
| -------------------------------------------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Recording HTTP stream and local `source`                             | RecordingPackService / EPHEMERAL                            | Count before each write; probe and verify S3 readback before success; owner cleanup in finally             |
| Capture screenshots, video, traces, browser downloads directory      | CaptureWorkerOrchestrator / EPHEMERAL until ingested        | Stage immutable private objects, preserve existing diagnostic evidence, then owner cleanup in finally      |
| Materialized S3 inputs and reconciliation copy                       | RenderWorkerOrchestrator / REGENERABLE                      | Byte and checksum verified; incomplete `.part` is never published as complete                              |
| FFmpeg HDR/chroma intermediates, Remotion intermediate, local master | RenderWorkerOrchestrator / EPHEMERAL until canonical upload | Preflight, bounded file validation, technical QA, immutable upload, then owner cleanup                     |
| Remotion bundle                                                      | Render workspace / REGENERABLE                              | Per-operation bundle inside workspace; persistent bundler cache disabled                                   |
| Playwright browser profile and Remotion internal render temp         | Library-owned / EPHEMERAL                                   | OS temp filesystem also checked; normal library shutdown cleanup retained; no sweep of library directories |
| S3 originals, capture diagnostics, render masters                    | Asset ledger / CANONICAL, IMMUTABLE                         | Never deleted by 10F, including failed or unreferenced objects                                             |
| Registry files, templates, browser/tool installations                | Repository/tooling / maintained inputs                      | No runtime cleanup                                                                                         |
| Unit/browser/render fixtures and disposable S3 buckets               | Test harness / EPHEMERAL                                    | Existing test teardown, isolated from canonical objects                                                    |

The inspection found no disk preflight, an unbounded S3-to-file materializer,
a render output without a maximum, and age-only upload temp deletion. Existing
recording/capture limits were 512 MiB. S3 already used private objects and
`IfNoneMatch: '*'`; these invariants are retained.

## Capacity policy

`packages/shared/src/capacity-policy.ts` centralizes validated, finite limits.
`CapacityGuard` uses Node `statfs(..., { bigint: true })`: available bytes are
`bavail * bsize`, not blocks reserved for privileged users. Invalid, negative,
inconsistent, overflowing or unavailable observations fail closed. The probe has
a one-second deadline and checks at most 64 ancestors if a configured root does
not yet exist. It does not create directories in order to sample capacity.

Before materialization:

```text
availableFreeBytes >= minimumFreeBytes + requestedBytes
```

Equality is allowed. Arithmetic rejects unsafe totals. This is an admission
snapshot, not an atomic cross-process disk reservation. No leases, scheduler or
reconciliation system is added.

Defaults for the local V1:

- `VCE_MIN_LOCAL_FREE_BYTES`: 268435456 (256 MiB). A separate operating margin,
  configurable to a positive safe integer.
- `VCE_MAX_UPLOAD_BYTES`: 536870912 (512 MiB), preserving the existing upload cap.
- `VCE_MAX_ARTIFACT_BYTES`: 536870912 (512 MiB), preserving the capture cap and
  applying an explicit bound to downloads/render artifacts.

The two size settings may lower the existing 512 MiB baseline, not raise it via
the bootstrap environment. Zero, fractional, negative, NaN, Infinity and unsafe
values are rejected. API bootstrap passes the policy to recording uploads, S3 and
Operations. Worker libraries accept an injected CapacityGuard; callers must pass
their configured policy when overriding defaults. They remain bounded when using
the default policy. The render orchestrator passes its guard to the renderer.

Working-space estimates are deliberately conservative allowances, not predictions
of compression:

- Upload: the full configured upload ceiling, because the stream size is untrusted.
- Download: validated expected bytes if known, otherwise the artifact ceiling.
- Capture: one artifact ceiling per declared output plus three diagnostic/video
  allowances, plus 256 MiB of browser scratch. The OS temp filesystem also needs
  the scratch allowance. Current capture flows always use local artifacts/tracing.
- Render: known input bytes plus two artifact ceilings per input (HDR/chroma),
  three artifact ceilings (intermediate/master/reconciliation), plus 256 MiB of
  scratch. Both configured work root and OS temp filesystem are checked, even
  when they happen to reside on the same volume.
- Each FFmpeg invocation also checks its input and space for one bounded output.

Insufficient capacity produces `INSUFFICIENT_LOCAL_CAPACITY`; unavailable stats
produce `LOCAL_CAPACITY_UNAVAILABLE`. Render/Capture failures flow through the
existing attempt/job finalization. Upload refusal happens before consuming the
request stream or creating an Asset. No filesystem pressure deletes canonical data.

## Artifact and stream bounds

HTTP recording uploads reject an excessive declared Content-Length before the
service is called. The service still counts actual bytes before writing every
chunk, including unknown-length bodies. Empty uploads remain invalid. Existing
probe, SHA256 verification and domain validation are unchanged.

S3 upload validates a regular, non-symlink local file, positive size, configured
maximum and matching declared size before sending. It streams at most that many
bytes, closes the stream on failure/success, and keeps immutable conditional put.
S3 reads validate Content-Length when present and also count actual stream bytes.
Oversized or short responses fail; cancellation closes the upstream body.
No remote free-space/quota measurement is fabricated. Existing 10D storage
readiness and the private write/read canary remain authoritative for reachability.

Materialization streams into a unique `.part`, checks size and checksum, then
uses an atomic hard-link publication with no overwrite. The partial name is
unlinked in finally; an existing complete target is never overwritten/deleted.
Cleanup failures are logged separately. This is complete-file visibility, not a
claim of crash-durable fsync or a new recovery protocol.

Capture files are size-checked before ingestion, screenshots before subsequent
processing, and PNG validation reads only the header. Browser downloads are not a
supported output in the integrated scenarios: a scenario requesting unbounded
browser downloads is denied before startup. Existing frozen scenarios all block
such downloads. Capture business actions and evidence semantics are unchanged.

FFmpeg uses `-fs` and validates produced size. Remotion intermediate/final output
sizes are checked before later processing/upload. Existing technical QA still
checks final media validity and duration; size checks do not replace it. Remotion
has no hard disk quota: preflight plus post-render validation is the supported
boundary, so temporary growth between checks remains an explicit limitation.
Review/manual preview buffers retain bounded behavior; final render review now
rejects oversized canonical metadata before loading bytes. No general heap refactor.

## Temporary cleanup safety

Existing roots are retained: OS tmpdir for upload/capture (or the injected capture
root), and the configured render workRoot. `createOwnedTemp` creates a private,
unique child identified by operation UUID and kind. Its returned cleanup closure
captures the canonical root, device/inode and random ownership marker. There is no
public API accepting an arbitrary deletion path.

Cleanup verifies the root, directory identity and marker, rejects replacement
symlinks, and never follows nested symlink targets. A pre-scan limits deletion to
10,000 entries and depth 16. Exceeding the scan budget conservatively retains the
directory. Workspace contents must be quiescent after awaited producers finish;
this is not protection against a hostile process running under the same OS user.

The owner cleans in finally after success or failure; cleanup errors return false
and produce a structured warning without replacing the original operation error.
CaptureAssetStager only stages bytes: it no longer recursively deletes a path
supplied by its caller. The orchestrator owns that cleanup. Direct executor/renderer
callers own their supplied workspace, including smoke-test teardown.

The previous age-only `cleanAbandonedUploadTemps` sweep is removed. A filename and
age do not prove another process is inactive. Recent, old, foreign and legacy temp
directories are not swept automatically. Existing database upload-interruption
handling remains unchanged. Proving inactivity and reconciling crash leftovers
belongs to 10G; no stale cleanup daemon/CLI or retention policy is introduced here.

## Operations and logging

The existing authenticated `GET /api/operations/runtime` adds `localCapacity`:
`scope: API_TEMP_FILESYSTEM`, sample time, availability, free bytes, policy limits
and deterministic status. INSUFFICIENT means below minimum headroom; LOW means
below headroom plus one maximum upload; HEALTHY means at least that threshold.
Unknown stats expose `available: false`, never healthy zero values. This snapshot
is not proof of worker-host capacity or permission to execute a particular render.

No tempUsageBytes is claimed, no directory traversal runs on the endpoint, and no
paths, credentials or signed URLs are returned. Session protection and
`Cache-Control: private, no-store` are retained. 10D readiness and 10E budget reads
remain separate.

10C logs add `capacity.check_failed`, `capacity.insufficient`,
`artifact.too_large`, `temp.cleanup_completed`, `temp.cleanup_failed`; byte counts,
validated operation UUIDs and allowlisted codes are safe. No raw path/provider
response is logged.

## Validation and remaining boundaries

`pnpm check:phase10f` covers configuration/numeric boundaries, injected disk stats,
stream abort/partial cleanup, workspace traversal/symlink/ownership, cleanup failure,
API authentication/header refusal, PostgreSQL attempt state after capacity refusal,
capture staging ownership, recording limits and S3 private/immutable invariants.
Remotion smoke and media regression exercise the real local rendering tools.
All prior phase gates and the broad Phase 9 regression remain required.

Known limits: no atomic disk reservation across workers; estimates are not exact;
other processes can consume space after a sample; library-owned crash remnants
and legacy caches are not swept; S3 total capacity/retention is operator-managed.
No canonical GC, backup, migration, new storage provider, external dependency,
real-provider activation or 10G/10H work is included. Media gains only internal
links to the existing shared and observability packages.
