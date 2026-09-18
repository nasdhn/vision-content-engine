# Specification Status

## Current stage
Product direction validated.  
System architecture accepted.  
Domain model specification is the next active design task.

## Version
Draft: `spec-v0.2`

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

## Still to freeze before Codex implementation
- exact domain model
- exact relationships/versioning rules
- Prisma schema draft
- exact workflow state transitions
- exact AI JSON contracts
- exact Pattern schema
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
`docs/03_DOMAIN_MODEL.md`
