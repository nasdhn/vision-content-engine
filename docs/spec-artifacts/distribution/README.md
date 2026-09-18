# Distribution Spec Artifacts

Status: specification artifacts only.

V1 platform modes:
- Instagram Reels: API_AUTOMATED
- YouTube Shorts: API_AUTOMATED once capability/audit prerequisites are satisfied
- TikTok: MANUAL_HANDOFF

Core safety:
- exact Publication.mediaAssetId;
- explicit AssetDerivation lineage;
- no blind retry after ambiguous remote side effects;
- credentials are referenced, not stored in jobs/metadata;
- TikTok browser automation is not used as a policy workaround.
