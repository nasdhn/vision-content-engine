# Specification Status

## Current stage
Product direction validated.  
System architecture accepted.  
Domain model accepted.  
Prisma specification accepted.  
Workflows accepted.  
AI contracts accepted.  
Media/Pattern specification is now the active design task.

## Version
Draft: `spec-v0.6`

## Foundation status
- Product: ACCEPTED
- Architecture: ACCEPTED
- Domain Model: ACCEPTED
- Prisma: ACCEPTED
- Workflows: ACCEPTED
- AI Contracts: ACCEPTED

## Accepted AI contract principles
- five logical capabilities, not autonomous agents
- centralized AIProviderGateway
- strict versioned request/output contracts
- versioned Knowledge Snapshot
- prompt key/version/hash provenance
- strict schema validation
- deterministic reference validation
- business-rule validation
- claim validation
- evidence-bound Creative QA
- conservative Analyst confidence/comparability
- deterministic deduplication boundary
- bounded retries/timeouts/token/cost policies
- Zod-shaped specification artifacts under `docs/spec-artifacts/ai-contracts/`

## Important
The Zod files are specification artifacts only.
They are not application code until implementation is authorized.

## Still to freeze before Codex implementation
- Pattern Library schema and initial pattern seed set
- Template contract
- EditingProfile contract
- EditingPlan/media details
- captions/audio/render validation
- Playwright capture contract
- dashboard UX
- platform publisher adapters
- analytics normalization and learning
- security/observability/deployment
- tests/acceptance criteria
- Codex Master Prompt

## Gate
Codex implementation is **NOT authorized** until all required items are validated and this document reaches `spec-v1.0`.

## Next specification
`docs/06_PATTERN_LIBRARY_SPEC.md`
