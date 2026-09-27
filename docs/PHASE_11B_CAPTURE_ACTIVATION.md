# Phase 11B — Product Capture Progressive Activation

**Status:** 11B-1 COMPLETE — fail-closed authenticated Capture boundary.

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

Next: 11B-2 may prepare an explicit one-shot Capture canary harness. The real remote canary remains a separate side effect and must not be part of ordinary CI.
