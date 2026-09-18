# Specification Status

## Current stage
Product direction validated.  
System architecture accepted.  
Domain model accepted.  
Prisma structural review accepted.  
Workflow specification accepted.  
Final Prisma schema draft is now the active validation task.

## Version
Draft: `spec-v0.4`

## Accepted workflow decisions
- Brief / Idea / Concept lifecycles
- Script / CreativePlan / EditingPlan lifecycles
- human RecordingRequest lifecycle
- CaptureRun lifecycle
- Render / RenderAttempt semantics
- Creative QA behavior
- two mandatory human review gates
- Publication lifecycle including `PUBLISHING_UNKNOWN`
- analytics append-only measurement
- weekly analysis workflow
- `WorkflowRun.WAITING` semantics
- retry vs regeneration distinction
- recovery behavior after worker/control crashes
- stable failure taxonomy
- workflow-owned lifecycle enums

## Why Prisma schema draft is still not checked
The workflow enums are now known, but the draft must be revised to include:
- UUID v7
- Prisma 7 generator/config shape
- lifecycle enums
- CaptureRunAsset
- RenderInputAsset
- TemplateVersionAsset
- corrected Approval relation/integrity
- final delete/index directions

## Still to freeze before Codex implementation
- final Prisma schema draft
- exact AI JSON contracts
- Pattern schema details
- EditingPlan contract
- template/render contracts
- Playwright capture contract
- dashboard screen contracts
- platform publisher interfaces
- analytics normalization model
- deployment/security details
- acceptance criteria per implementation phase

## Gate
Codex implementation is **NOT authorized** until all required items are validated and this document reaches `spec-v1.0`.

## Next specification
`docs/03B_PRISMA_SCHEMA_FINAL_DRAFT.md`
