# Phase 11C — Reviewed Render Canary Evidence

Date: 2026-09-30

## Execution

- Canary: `PHASE_11C_2B_SYNTHETIC_RENDER`
- Fixture: `phase5-media-v1`
- Composition: `green-screen-explainer-v1`
- Result: `SUCCEEDED`
- Renderer invoked: `true`
- Technical QA: `PASS`
- Chroma executed: `true`
- External provider cost: `USD 0`

## Retained master

- File: `master.mp4`
- Size: `1079697` bytes
- SHA-256: `51f824a81640173890743911932f9811e72077415413fcd600078f8311aad382`
- Duration: `1258 ms`
- Video codec: `h264`
- Canvas: `1080x1920`
- Frame rate: `30 fps`
- Pixel format: `yuv420p`
- Dynamic range: `SDR`
- Color: `BT.709`
- Audio codec: `aac`
- Audio sample rate: `48000 Hz`
- Audio channels: `2`

## Runtime

- Renderer version: `v1`
- Remotion: `4.0.526`
- FFmpeg: `8.1.2`
- Chroma profile: `GREENSCREEN_STANDARD_V1`

## Human review

Visual/audio review was performed on the retained master.

Observed synthetic fixture behavior:

- generated vertical color/test pattern is visible;
- `PREUVE PRODUIT` overlay is visible;
- `Vision trouve les bons prospects` caption is visible;
- synthetic green-screen presenter path is composited;
- synthetic audio tone is audible.

The continuous tone is intentional: the voice fixture is a synthetic
440 Hz sine wave used to prove audio transport and post-processing.

Review outcome: `PASS_FOR_SYNTHETIC_FIXTURE`.

This does not approve the creative quality of a real production video.
It proves that the reviewed local Video Engine path can construct,
render, post-process, probe and technically validate its synthetic V1
composition.

## Safety

The retained evidence reported:

- database adapter invoked: `false`;
- object-storage adapter invoked: `false`;
- AI provider invoked: `false`;
- publishing adapter invoked: `false`;
- synthetic inputs only: `true`;
- external provider cost: `USD 0`.

The retained MP4 itself remains local review evidence and is not committed
to Git.
