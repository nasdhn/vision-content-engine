# Specification Status

## Current stage
Product direction validated.  
System architecture accepted.  
Domain model accepted.  
Prisma structural review accepted.  
Workflow specification is now the active design task.

## Version
Draft: `spec-v0.3`

## Accepted Prisma structural decisions
- Prisma ORM 7 for V1
- UUID v7 canonical IDs
- explicit CaptureRunAsset relation
- explicit RenderInputAsset relation
- explicit TemplateVersionAsset relation
- single Approval table with explicit supported-subject FKs
- database CHECK constraint for Approval integrity
- Brief + BriefVersion snapshot strategy
- protected historical lineage via Restrict/archive
- Prisma Migrate as authoritative workflow
- remaining lifecycle enums owned by workflow specification

## Why Prisma draft is not yet checked as frozen
The relational structure is accepted, but the final `schema.prisma` still depends on lifecycle enums defined by `04_WORKFLOWS.md`.

## Still to freeze before Codex implementation
- exact workflow state transitions
- final Prisma schema draft after workflow enums
- exact AI JSON contracts
- exact Pattern schema details
- exact EditingPlan schema
- exact template/render contracts
- exact Playwright capture contract
- dashboard screen contracts
- platform publisher interfaces
- analytics normalization model
- deployment/security details
- acceptance criteria per implementation phase

## Gate
Codex implementation is **NOT authorized** until all required items are validated and this document reaches `spec-v1.0`.

## Next specification
`docs/04_WORKFLOWS.md`
