# Phase 11B — Product Capture Progressive Activation

**Status:** 11B-2B COMPLETE — explicit reviewed execution command; real authenticated canary NOT STARTED.

11B-1 adds the runtime security boundary required before authenticated Product Capture can be activated.

Authenticated Capture is enabled only when:

- `VCE_ENV=STAGING_CAPTURE`
- `PAUSE_CAPTURE=false`

`LOCAL` and `PRODUCTION` remain disabled for this V1 authenticated Capture path.

The reviewed V1 authentication profile is `VISION_CAPTURE_ACCOUNT_V1`.

`MountedCaptureAuthStateProvider` accepts only a runtime-mounted Playwright storage-state file and fails closed unless the profile is reviewed, the path is absolute, the file is a regular non-symlink, group/world permission bits are zero, size is bounded to 1 MiB, and JSON contains `cookies` and `origins` arrays.

11B-1 does not mount a real credential, automate login, contact `capture-demo.urvision.fr`, create a real external CaptureRun, activate Rendering, or incur provider cost.

Persistent local state remains fail-closed:

- `VCE_ENV=LOCAL`
- `PAUSE_CAPTURE=true`
- `VCE_REAL_PROVIDERS_ENABLED=false`

Phase status:

- Generation durable path: DONE
- 11B-1 Capture authentication safety boundary: DONE
- real authenticated Capture canary: NOT STARTED
- Rendering activation: NOT STARTED

## 11B-2A — dry-run Capture canary harness

11B-2A prepares the one-shot Capture canary envelope without executing
any external browser activity.

The selected canary is the immutable `PRICING_PAGE` scenario:

- scenario version `018f3000-0000-7000-8000-000000000004`;
- environment `VISION_CAPTURE_DEMO`;
- base URL `https://capture-demo.urvision.fr`;
- auth profile `VISION_CAPTURE_ACCOUNT_V1`;
- fixture mode `PREPARED_STATE`;
- `resetBeforeRun=false`;
- no scenario input;
- step sequence `NAVIGATE, ASSERT, VISUAL_SETTLE, SCREENSHOT`;
- one required `pricing` screenshot output.

The dry-run validates an ephemeral Capture activation envelope equivalent
to `STAGING_CAPTURE` with Capture unpaused, while requiring persistent
configuration to remain `LOCAL`, Capture paused and real providers
disabled.

The 11B-2A harness intentionally cannot execute the remote canary.
`--execute` fails with `CANARY_EXECUTION_NOT_IMPLEMENTED_11B2A`.

Dry-run evidence is required to remain:

- `credentialResolved=false`;
- `browserLaunched=false`;
- `networkCalled=false`;
- `externalSideEffect=false`.

No real storage-state credential is resolved.
No browser is launched.
No request is made to `capture-demo.urvision.fr`.
No CaptureRun is created.
No external side effect is performed.

Phase status:

- Generation durable path: DONE
- 11B-1 Capture authentication safety boundary: DONE
- 11B-2A dry-run Capture canary harness: DONE
- real authenticated Capture canary: NOT STARTED
- Rendering activation: NOT STARTED

## 11B-2B — explicit reviewed execution command

11B-2B adds a separate command dedicated to the single reviewed
`PRICING_PAGE` remote canary. The existing 11B-2A dry-run command remains
unchanged and keeps its own `--execute` path unavailable.

The real execution command requires all of the following simultaneously:

- runtime `VCE_ENV=STAGING_CAPTURE`;
- runtime `PAUSE_CAPTURE=false`;
- `VCE_REAL_PROVIDERS_ENABLED=false`;
- exact CLI confirmation `EXECUTE_PRICING_PAGE_CAPTURE_DEMO`;
- an absolute runtime-mounted Playwright storage-state path;
- the existing `MountedCaptureAuthStateProvider` checks;
- immutable `PRICING_PAGE`;
- `PREPARED_STATE`, `marketing-v1`, no reset and no scenario input.

The command writes a non-secret `canary-evidence.json` beside the output
and fails unless the required `pricing` screenshot exists.

11B-2B implementation tests inject a fake Capture executor. They validate
authorization, credential preflight, fixture policy, required output and
evidence generation without Chromium or network access.

Phase status:

- Generation durable path: DONE
- 11B-1 Capture authentication safety boundary: DONE
- 11B-2A dry-run Capture canary harness: DONE
- 11B-2B explicit execution command: DONE
- real authenticated Capture canary: NOT STARTED
- Rendering activation: NOT STARTED

Next after code closure: provision the dedicated storage state outside
Git and explicitly authorize exactly one remote `PRICING_PAGE` canary.
