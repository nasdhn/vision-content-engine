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
Product Capture / Playwright accepted.  
Dashboard UX accepted.  
Distribution accepted.  
Analytics & Learning is now the active design task.

## Version
Draft: `spec-v0.12`

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
- Product Capture / Playwright: ACCEPTED
- Dashboard UX: ACCEPTED
- Distribution: ACCEPTED

## Accepted Distribution principles
- Instagram Reels: API_AUTOMATED
- YouTube Shorts: API_AUTOMATED when public-upload capability is ready
- TikTok: MANUAL_HANDOFF for internal V1
- explicit PublicationDeliveryMode
- READY_FOR_MANUAL_PUBLISH status
- exact Publication.mediaAssetId
- explicit AssetDerivation provenance
- local scheduler canonical
- Instagram Login + temporary signed delivery URL
- YouTube resumable upload and capability/audit gate
- bounded retry and strict PUBLISHING_UNKNOWN reconciliation
- secret-reference token lifecycle
- manual TikTok confirmation does not fabricate remote proof

## Prisma amendments
Canonical spec schema now includes:
- PublicationDeliveryMode
- Publication.deliveryMode
- PublicationStatus.READY_FOR_MANUAL_PUBLISH
- AssetDerivation
- AssetDerivationType

## Canonical Distribution spec artifacts
- `docs/spec-artifacts/distribution/schema.ts`
- `docs/spec-artifacts/distribution/publication-state-machine.json`
- `docs/spec-artifacts/distribution/adapters/*.json`
- amended `docs/spec-artifacts/schema.prisma`

## Gate
Codex implementation is **NOT authorized** until all required items are validated and this document reaches `spec-v1.0`.

## Next specification
Analytics & Learning.
