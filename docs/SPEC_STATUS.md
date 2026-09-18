# Specification Status

## Current stage
Product direction validated.  
System architecture accepted.  
Domain model accepted.  
Prisma specification accepted.  
Workflows accepted.  
AI contracts accepted.  
Pattern Library accepted.  
Editing Intelligence is now the active design task.

## Version
Draft: `spec-v0.7`

## Foundation status
- Product: ACCEPTED
- Architecture: ACCEPTED
- Domain Model: ACCEPTED
- Prisma: ACCEPTED
- Workflows: ACCEPTED
- AI Contracts: ACCEPTED
- Pattern Library: ACCEPTED

## Accepted Pattern Library principles
- Pattern distinct from Angle / Template / EditingProfile
- stable Pattern root + immutable PatternVersion
- stable primary category
- performance evidence separated from PatternVersion
- no universal pattern score
- deterministic bounded candidate selection before Creator
- explicit eligibility rules
- configurable exploration/exploitation
- fatigue evaluated from content combinations
- deliberate variants tracked explicitly
- initial seed limited to 8 distinct mechanisms
- semantic-overlap gate before activating new patterns
- Researcher remains deferred

## Canonical Pattern spec artifacts
- `docs/spec-artifacts/pattern-library/schema.ts`
- `docs/spec-artifacts/pattern-library/seeds/*.json`

These are specification artifacts only until implementation authorization.

## Still to freeze before Codex implementation
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
`docs/07_EDITING_INTELLIGENCE.md`
