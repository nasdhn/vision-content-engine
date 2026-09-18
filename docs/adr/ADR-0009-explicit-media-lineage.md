# ADR-0009 — Explicit media lineage join models

## Status
Accepted

## Decision
Use explicit join models for:
- CaptureRun → Asset;
- Render → input Asset;
- TemplateVersion → Asset.

The relation records store roles/slots/order where relevant.

## Rationale
Exact media provenance is required for reproducibility, debugging and analytics. Core lineage must not be hidden inside JSON or mutable file paths.
