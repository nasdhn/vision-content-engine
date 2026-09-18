# Specification Status

## Current stage
Product direction validated.  
System architecture accepted.  
Domain model accepted.  
Prisma specification accepted.  
Workflows accepted.  
AI contracts accepted.  
Pattern Library accepted.  
Editing Intelligence accepted.  
Video Engine accepted.  
Product Capture / Playwright is now the active design task.

## Version
Draft: `spec-v0.9`

## Foundation status
- Product: ACCEPTED
- Architecture: ACCEPTED
- Domain Model: ACCEPTED
- Prisma: ACCEPTED
- Workflows: ACCEPTED
- AI Contracts: ACCEPTED
- Pattern Library: ACCEPTED
- Editing Intelligence: ACCEPTED
- Video Engine: ACCEPTED

## Accepted Video Engine principles
- replaceable `VideoRenderer` boundary
- deterministic render from immutable inputs
- FFmpeg/ffprobe preflight and output inspection
- isolated RenderAttempt workspace
- no arbitrary remote media fetch
- orientation normalization
- HDR/HLG/Dolby Vision → SDR BT.709 policy
- versioned Color/Audio/Codec profiles
- versioned motion/transition/chroma registries
- pinned font/template dependencies
- centralized ms→frame conversion
- deterministic Technical QA
- exact `Publication.mediaAssetId`
- platform-derivative provenance required
- Remotion licensing gate before production

## Prisma amendment
Canonical spec schema now contains:

`Publication.mediaAssetId -> Asset`

for exact uploaded-media lineage.

## Canonical Video Engine spec artifacts
- `docs/spec-artifacts/video-engine/schema.ts`
- `docs/spec-artifacts/video-engine/asset-media-contract.ts`
- `docs/spec-artifacts/video-engine/*-profiles.json`
- `docs/spec-artifacts/video-engine/*-registry.json`
- `docs/spec-artifacts/templates/*.json`
- amended `docs/spec-artifacts/schema.prisma`

## Gate
Codex implementation is **NOT authorized** until all required items are validated and this document reaches `spec-v1.0`.

## Next specification
`docs/09_PRODUCT_CAPTURE_PLAYWRIGHT.md`
