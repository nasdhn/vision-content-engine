# Phase 11C — Rendering Progressive Activation

**Status:** 11C-2A COMPLETE — deterministic dry-run Rendering canary harness; real reviewed canary NOT STARTED.

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
- reviewed real Rendering canary: NOT STARTED
- durable real Render execution: NOT STARTED
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
