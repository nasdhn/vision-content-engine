# Specification Status

## Current stage
Product direction validated.  
System architecture accepted.  
Domain model accepted.  
Prisma schema draft is the next active validation task.

## Version
Draft: `spec-v0.3`

## Validated product decisions
- internal tool for Vision first
- TikTok / Instagram Reels / YouTube Shorts
- target around 3 original contents/day
- real natural voice
- green-screen presenter format
- Pattern Library in V1
- automatic product capture planned with Playwright
- Editing Intelligence is core
- concept review + final video review
- automatic publishing after review
- autonomous publishing only later
- analytics and learning loop
- automatic external research deferred

## Accepted architecture
- separate repository and deployment boundary from Vision
- TypeScript monorepo
- PostgreSQL as canonical business state
- Redis/BullMQ for asynchronous execution
- transactional outbox
- dedicated control process
- AI / capture / render / publish / analytics worker boundaries
- S3-compatible object storage for binary media
- centralized AI provider gateway
- schema-validated AI outputs
- deterministic Playwright scenarios
- idempotency and publication reconciliation
- PostgreSQL-backed canonical scheduling
- raw vs normalized analytics separation
- initial Docker Compose deployment on one dedicated Content Engine host
- scale-out path for heavy workers without domain rewrite

## Accepted domain model
- stable root entities + immutable versions
- first-class Idea entity
- Pattern/PatternVersion
- Script/ScriptVersion
- CreativePlan/CreativePlanVersion
- EditingPlan/EditingPlanVersion
- multiple recording takes
- explicit Asset provenance
- CaptureScenario/CaptureRun
- Template and EditingProfile versioning
- Render/RenderAttempt
- Approval
- Publication/PublicationAttempt
- raw/normalized metric snapshots
- AttributionEvent with confidence
- Experiment/Insight/Recommendation
- WorkflowRun/JobAttempt
- OutboxEvent
- ModelInvocation
- CostEntry
- AuditEvent

## Still to freeze before Codex implementation
- Prisma schema draft
- exact workflow state transitions
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
`docs/03A_PRISMA_SCHEMA_DRAFT.md`
