# Specification Status

## Current stage
Product direction validated.  
System architecture accepted.  
Domain model accepted.  
Prisma structural review accepted.  
Workflow specification accepted.  
Concrete Prisma schema specification accepted.  
AI contract specification is now the active design task.

## Version
Draft: `spec-v0.5`

## Foundation status
- Product: ACCEPTED
- Architecture: ACCEPTED
- Domain Model: ACCEPTED
- Prisma structural decisions: ACCEPTED
- Workflows: ACCEPTED
- Concrete Prisma schema specification: ACCEPTED

## Important
The Prisma schema is still a **spec artifact**, not active application code.

Canonical design artifacts:
- `docs/spec-artifacts/schema.prisma`
- `docs/spec-artifacts/prisma.config.ts`

During implementation bootstrap these must be mechanically verified with the pinned Prisma 7 toolchain before any migration is applied.

## Accepted correction
`CreativePlanStatus` uses:

- DRAFT
- READY
- WAITING_FOR_INPUTS
- READY_FOR_EDITING
- SUPERSEDED
- ARCHIVED

Missing recording/capture/asset dependencies are derived from relational state rather than encoded as mutually exclusive blocker statuses.

## Still to freeze before Codex implementation
- Brand/Product Knowledge contract
- Creator contract
- Creative Director contract
- Editing Intelligence contract
- Creative QA contract
- Analyst contract
- AI provider gateway + prompt registry
- Pattern schema details
- EditingPlan media contracts
- template/render contracts
- Playwright capture contract
- dashboard screen contracts
- platform publisher interfaces
- analytics normalization/learning rules
- deployment/security details
- tests and acceptance criteria per implementation phase

## Gate
Codex implementation is **NOT authorized** until all required items are validated and this document reaches `spec-v1.0`.

## Next specification
`docs/05_AI_CONTRACTS.md`
