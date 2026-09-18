# ADR-0018 — Mixed V1 distribution and TikTok manual handoff

## Status
Accepted

## Decision
Distribution V1 uses API automation for Instagram Reels and YouTube Shorts where account/app capability permits it.

TikTok remains a manual handoff because current TikTok Content Sharing Guidelines explicitly reject internal/private utilities for uploading to accounts managed by the developer/team.

All Publications store an explicit delivery mode.

Platform derivatives have explicit AssetDerivation provenance and Publication.mediaAssetId remains the exact delivered media.

## Consequences
- policy-compliant TikTok V1;
- automated Instagram/YouTube path remains first-class;
- no browser-automation workaround;
- future TikTok API support can be introduced without rewriting historical Publications;
- exact media and retry/reconciliation lineage remains auditable.
