# ADR-0015 — Deterministic Video Engine and SDR social master

## Status
Accepted

## Decision
The Video Engine renders immutable EditingPlanVersion inputs through a replaceable `VideoRenderer` boundary.

V1 normalizes HDR/HLG/Dolby Vision sources to a versioned SDR BT.709 social-master policy when safely supported.

The renderer only consumes controlled Assets/template dependencies, performs input/output probing, and emits technical QA.

`Publication.mediaAssetId` records the exact Asset intended for remote upload.

## Consequences
- reproducible media lineage;
- reduced platform color surprises;
- no arbitrary runtime internet asset fetch;
- Remotion remains replaceable;
- platform derivatives can be traced to the exact uploaded file.
