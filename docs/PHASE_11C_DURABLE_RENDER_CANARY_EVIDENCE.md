# Phase 11C — Durable Render Canary Evidence

Date: 2026-10-01

## Execution

- Canary: `PHASE_11C_3B_DISPOSABLE_DURABLE_RENDER`
- Fixture: `phase11c3-disposable-durable-render-v1`
- Result: `SUCCEEDED`
- Render status: `CREATIVE_QA`
- RenderAttempt status: `SUCCEEDED`
- JobAttempt status: `SUCCEEDED`
- Output Asset status: `READY`
- Technical QA: `PASS`
- Private object verified: `true`
- External provider cost: `USD 0`

## Master

- File: `master.mp4`
- Size: `1079697` bytes
- SHA-256: `51f824a81640173890743911932f9811e72077415413fcd600078f8311aad382`
- Duration: `1258 ms`
- Canvas: `1080x1920`
- Frame rate: `30 fps`
- Video codec: `h264`
- Pixel format: `yuv420p`
- Color: `SDR BT.709`
- Audio codec: `aac`
- Audio sample rate: `48000 Hz`
- Audio channels: `2`

## Durable lineage

The reviewed execution successfully crossed:

1. disposable local PostgreSQL;
2. disposable local private S3;
3. three persisted READY input Assets;
4. canonical Render creation;
5. RenderAttempt creation;
6. paired durable JobAttempt creation;
7. real `RenderWorkerOrchestrator` execution;
8. private input materialization;
9. real Remotion/FFmpeg rendering;
10. technical QA;
11. immutable private output upload;
12. output Asset transition to READY;
13. RenderAttempt and JobAttempt success;
14. Render transition to CREATIVE_QA;
15. private-object readback;
16. size and SHA-256 verification.

## Cleanup

- Disposable database destroyed: `true`
- Disposable bucket destroyed: `true`
- Worker temporary directory destroyed: `true`

## Safety

- Environment: `LOCAL`
- Disposable PostgreSQL only: `true`
- Disposable S3 bucket only: `true`
- AI provider invoked: `false`
- Capture invoked: `false`
- Analytics invoked: `false`
- Publishing adapter invoked: `false`
- External provider cost: `USD 0`
- Remote side effect: `false`

## Human observation

The retained master visually matches the earlier synthetic Render canary.

This is expected. Both use the same deterministic synthetic fixture:

- generated color/test pattern;
- synthetic green-screen presenter;
- product-proof text/captions;
- synthetic 440 Hz audio tone.

The SHA-256 also matches the earlier reviewed isolated Render master:

`51f824a81640173890743911932f9811e72077415413fcd600078f8311aad382`

This evidence proves durable-path determinism and persistence behavior.
It does not constitute creative-quality approval for production content.

The retained MP4 remains local and is not committed to Git.
