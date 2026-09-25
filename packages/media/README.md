# Media — Phase 3

Private original recording ingest only. `S3PrivateStorage` writes server-generated immutable
keys with `If-None-Match: *`; it never exposes credentials, ACLs or public object URLs.
The application verifies SHA-256 against a complete storage read before atomically marking
an Asset READY and linking its Recording. Filenames, extensions and client MIME types are
not trusted. Network/storage work happens outside PostgreSQL transactions.

`probeFile` executes a fixed ffprobe argument array with a 30-second timeout, a 1 MiB output
limit, a container allowlist and file-only protocols. Probe normalization records display
rotation, dimensions, duration, fps, codec, color and audio parameters. Unknown/non-applicable
fields remain absent. Media outside the supported SDR audio/video path is rejected explicitly;
no tone-map, re-encode, capture or render engine is included. Green-screen quality and duration
mismatches are feedback, not invented creative-quality scores. A green-screen take may be silent
when its voice is supplied separately; VOICE requests require an audio stream.

Originals remain private and unchanged. Missing/corrupt preview objects become QUARANTINED,
reopening affected requests and future readiness atomically. This conservative treatment also
applies to a failed storage read; upload a replacement after restoring storage availability.
Historical version/render/input rows are not rewritten.

Temporary ingest workspaces have private permissions and are cleaned in `finally` only after
verifying their operation ownership, root boundary and directory identity. Age alone never
authorizes deletion; automatic stale-directory cleanup is disabled until inactive ownership can
be proven. Interrupted DB uploads older than one hour still become FAILED; late finalization is
refused. Any already written original stays linked to the failed Asset for diagnostics/retention,
never reused on retry. See [Phase 10F](../../docs/PHASE_10F_STORAGE_CAPACITY.md) for capacity
limits and cleanup guarantees.

Limits: 512 MiB per original, two concurrent uploads and one preview load per service process;
HTTP upload timeout 120 seconds, object operation timeout 60 seconds. Preview checks the entire
object before returning bytes and currently buffers it (up to roughly twice the file size during
concatenation). Production streaming/range optimization and deployment hardening remain later
work; the Phase 3 runtime is explicitly restricted to LOCAL loopback services.

The host must provide `ffprobe`; deterministic fixture tests also use `ffmpeg` with libx264.
Validated locally with FFmpeg/ffprobe 8.1.2. CI checks its installed media tool and executes the
same synthetic media contracts. No external media or customer data is used.
