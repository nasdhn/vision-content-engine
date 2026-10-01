# Phase 11C — Rendering Progressive Activation

**Status:** 11C-3C COMPLETE — reviewed disposable durable Render canary validated; Human Review activation NOT STARTED.

Phase 11C progressively enables the already implemented Video Engine after
the reviewed Product Capture canary.

## 11C-1 — Rendering activation safety boundary

Rendering activation is allowed only when both conditions are true:

- `VCE_ENV=STAGING_CAPTURE`
- `PAUSE_RENDERING=false`

`LOCAL` and `PRODUCTION` remain disabled for this first reviewed V1
Rendering activation path.

The activation decision is centralized in
`isRenderingActivationEnabled(config)`.

Persistent defaults remain fail-closed:

- `VCE_ENV=LOCAL`
- `PAUSE_RENDERING=true`
- `VCE_REAL_PROVIDERS_ENABLED=false`

11C-1 does not:

- start the Render worker;
- claim a Render job;
- access a remote database;
- read or write object storage;
- invoke an AI provider;
- publish media;
- change the existing renderer implementation;
- enable Rendering in production.

The existing renderer remains responsible for deterministic Remotion
composition, FFmpeg post-processing, output probing and technical QA.

Phase status:

- Generation durable path: DONE
- Product Capture first reviewed real canary: DONE
- 11C-1 Rendering activation safety boundary: DONE
- 11C-2A dry-run Rendering canary harness: DONE
- 11C-2B explicit reviewed execution command: DONE
- 11C-2C reviewed local synthetic Rendering canary: DONE
- 11C-3A durable Render canary dry-run boundary: DONE
- 11C-3B explicit disposable durable Render execution command: DONE
- 11C-3C reviewed disposable durable Render canary: DONE
- persistent Render worker activation: NOT STARTED
- Human Review activation: NOT STARTED

## 11C-2A — deterministic dry-run Rendering canary harness

The reviewed canary envelope is frozen from the existing
`phase5-media-v1` regression fixture:

- 1200 ms master duration;
- 1080x1920 portrait canvas;
- 30 fps;
- synthetic product video;
- synthetic green-screen presenter;
- synthetic stereo voice audio;
- synthetic black/silence diagnostic fixture;
- `green-screen-explainer-v1`;
- `GREENSCREEN_STANDARD_V1`;
- `SDR_BT709_SOCIAL_V1`;
- `SOCIAL_H264_AAC_V1`;
- `SOCIAL_VOICE_MASTER_V1`.

The future reviewed execution is expected to produce an H.264,
`yuv420p`, SDR BT.709 master with 48 kHz stereo audio and to pass the
existing technical QA path.

11C-2A validates only the canary envelope and an ephemeral Rendering
activation equivalent to `STAGING_CAPTURE` with Rendering unpaused.

Persistent runtime state remains fail-closed:

- `VCE_ENV=LOCAL`;
- `PAUSE_RENDERING=true`;
- `PAUSE_ALL_PUBLISHING=true`;
- `VCE_REAL_PROVIDERS_ENABLED=false`.

No Remotion render is invoked by the 11C-2A harness.
No database or object-storage operation is performed.
No AI provider or publishing adapter is invoked.
No network request or external side effect is performed.

`--execute` is deliberately rejected with
`CANARY_EXECUTION_NOT_IMPLEMENTED_11C2A`.

Next: 11C-2B adds a separate explicit reviewed command that performs one
local synthetic Render canary, retains the resulting master and evidence
for human review, and still performs no publication or external
AI-provider call.

## 11C-2B — explicit reviewed local Render execution command

11C-2B adds a separate execution command for exactly one reviewed local
synthetic Render canary.

Execution requires all of the following simultaneously:

- `VCE_ENV=STAGING_CAPTURE`;
- `PAUSE_RENDERING=false`;
- `PAUSE_CAPTURE=true`;
- `PAUSE_AI_GENERATION=true`;
- `PAUSE_ALL_PUBLISHING=true`;
- `PAUSE_ANALYTICS_COLLECTION=true`;
- `VCE_REAL_PROVIDERS_ENABLED=false`;
- exact confirmation `EXECUTE_SYNTHETIC_RENDER_CANARY`.

The execution path reuses the existing `phase5-media-v1` regression flow
instead of implementing a second renderer.

The regression flow creates only synthetic local media, runs the existing
Remotion/FFmpeg Video Engine, executes the existing technical QA, and may
retain the reviewed output only when the execution harness supplies its
dedicated absolute output directory.

A successful reviewed execution retains:

- `master.mp4`;
- `canary-evidence.json`.

The evidence manifest contains the final media probe, technical QA outcome,
runtime renderer diagnostics, file size and SHA-256 digest. It does not
store database credentials, object-storage credentials or provider
credentials.

The execution harness has no database adapter, object-storage adapter,
AI-provider adapter or publishing adapter. The renderer's local asset
server remains part of the existing Remotion render path.

The 11C-2B unit tests inject a fake regression runner. Therefore the code
closure gate does not execute the reviewed real Render canary.

Code closure does not claim that the reviewed real canary has run.

Next after code closure: explicitly execute exactly one synthetic local
Render canary, inspect `canary-evidence.json`, open `master.mp4`, and
perform human visual/audio review before any durable Render worker
activation.

## 11C-2C — reviewed local synthetic Rendering canary

The explicit reviewed local Render canary was executed successfully on
2026-09-30 using the real Remotion/FFmpeg renderer and synthetic
`phase5-media-v1` inputs.

Result:

- renderer invocation: SUCCEEDED;
- technical QA: PASS;
- chroma preprocessing: executed;
- human visual/audio review: PASS FOR SYNTHETIC FIXTURE;
- durable database-backed Render worker: NOT STARTED;
- object-storage persistence: NOT STARTED;
- publishing: NOT STARTED;
- external provider cost: USD 0.

The synthetic appearance and audio are intentional test inputs and are not
a creative-quality approval for production content.

Detailed non-secret evidence is frozen in
`docs/PHASE_11C_RENDER_CANARY_EVIDENCE.md`.

Next: inspect and prepare the durable controlled Render-worker activation
path before Human Review activation.

## 11C-3A — durable Render canary dry-run boundary

Inspection confirms that the durable Render pipeline already exists.

`RenderWorkerOrchestrator` owns the canonical path from the durable Render
Job/RenderAttempt through private input materialization, deterministic
rendering, technical QA, immutable private output upload, Asset readiness
and durable Job success.

11C-3 does not rebuild this pipeline.

The future reviewed durable canary is restricted to:

- a disposable local Postgres database created specifically for the run;
- a disposable local S3 bucket created specifically for the run;
- synthetic fixture-owned inputs only;
- direct execution of exactly one `RenderWorkerOrchestrator` attempt;
- all external AI providers disabled;
- all publishing disabled;
- no Capture execution;
- no Analytics collection.

No VPS, production database or application bucket is used.

This local disposable test topology is intentionally distinct from the
`STAGING_CAPTURE` product-runtime activation boundary. It does not enable
the persistent Render worker process in LOCAL or PRODUCTION.

11C-3A itself creates no database, bucket, Render job or media object.
The dry-run performs no DB, S3, renderer, AI, publishing or remote side
effect.

`--execute` remains unavailable in 11C-3A.

Next: 11C-3B adds a separate explicit reviewed execution command that
creates disposable LOCAL Postgres/S3 resources, builds one synthetic
durable Render lineage, executes exactly one real Render worker attempt,
verifies the resulting private Asset/object/QA lineage, records sanitized
evidence and destroys the disposable infrastructure.

## 11C-3B — explicit disposable durable Render execution command

11C-3B adds a separate explicit command for exactly one disposable LOCAL
durable Render canary.

The persistent runtime remains fail-closed. The command requires:

- `VCE_ENV=LOCAL`;
- loopback-only PostgreSQL and S3 endpoints;
- `PAUSE_RENDERING=true`;
- `PAUSE_CAPTURE=true`;
- `PAUSE_AI_GENERATION=true`;
- `PAUSE_ALL_PUBLISHING=true`;
- `PAUSE_ANALYTICS_COLLECTION=true`;
- `VCE_REAL_PROVIDERS_ENABLED=false`;
- exact confirmation `EXECUTE_DISPOSABLE_DURABLE_RENDER_CANARY`;
- an absolute empty local evidence directory.

The execution command does not start the persistent Render worker process.
It explicitly invokes exactly one `RenderWorkerOrchestrator` attempt inside
a test-only disposable topology.

The reviewed execution path will:

1. create one disposable LOCAL PostgreSQL database;
2. create one disposable LOCAL private S3 bucket;
3. generate three synthetic local inputs;
4. persist the three READY input Assets into the disposable bucket/database;
5. create canonical approved content lineage and a validated EditingPlanVersion;
6. request and queue one Render and one RenderAttempt/JobAttempt;
7. execute the existing real `RenderWorkerOrchestrator`;
8. materialize the private input Assets from S3;
9. execute the real Remotion/FFmpeg renderer;
10. run technical QA;
11. upload the immutable private Render output;
12. verify JobAttempt, RenderAttempt, Asset and Render durable state;
13. read the private object back and verify size plus SHA-256;
14. destroy the disposable bucket, database and worker temporary directory;
15. retain only a local reviewed `master.mp4` and sanitized
    `canary-evidence.json`.

The S3 test fixture tracks the worker-created Render object key so cleanup
can delete the output before deleting its disposable bucket.

No VPS, application database, production bucket, external AI provider,
Capture run, Analytics collection or publishing adapter is used.

The 11C-3B closure gate does not call
`canary:render:durable:execute`.

Code closure does not claim that the disposable durable canary has run.

Next after code closure: explicitly execute one reviewed disposable durable
Render canary and freeze its non-secret evidence before any persistent
Render-worker activation.

## 11C-3C — reviewed disposable durable Render canary

The disposable durable Render canary was executed successfully on
2026-10-01.

This execution crossed the canonical durable Render path:

- disposable LOCAL PostgreSQL;
- disposable LOCAL private S3 bucket;
- persisted READY input Assets;
- Render / RenderAttempt / JobAttempt lineage;
- `RenderWorkerOrchestrator`;
- private input materialization;
- real Remotion/FFmpeg rendering;
- technical QA;
- immutable private Render output upload;
- output Asset readiness;
- durable JobAttempt and RenderAttempt success;
- private-object readback and SHA-256 verification;
- disposable database, bucket and worker-temp destruction.

Result:

- Render: `CREATIVE_QA`;
- RenderAttempt: `SUCCEEDED`;
- JobAttempt: `SUCCEEDED`;
- output Asset: `READY`;
- technical QA: `PASS`;
- private object verification: `PASS`;
- cleanup: `PASS`;
- external provider cost: `USD 0`;
- remote side effect: `false`.

The master SHA-256 is identical to the previously reviewed isolated
synthetic Render canary. This is expected because both executions use the
same deterministic synthetic fixture and composition.

The repeated synthetic visual appearance and 440 Hz tone are intentional.
This evidence validates durable Rendering mechanics and determinism, not
creative production quality.

Detailed non-secret evidence is frozen in
`docs/PHASE_11C_DURABLE_RENDER_CANARY_EVIDENCE.md`.

Phase 11C Rendering validation is complete for the reviewed V1 activation
sequence. Persistent Render worker activation remains fail-closed.

Next canonical phase: Human Review.
