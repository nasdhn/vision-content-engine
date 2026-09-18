# Specification Status

## Current stage
Product direction validated.  
System architecture accepted.  
Domain model accepted.  
Prisma specification accepted.  
Workflows accepted.  
AI contracts accepted.  
Pattern Library accepted.  
Editing Intelligence accepted.  
Video Engine is now the active design task.

## Version
Draft: `spec-v0.8`

## Foundation status
- Product: ACCEPTED
- Architecture: ACCEPTED
- Domain Model: ACCEPTED
- Prisma: ACCEPTED
- Workflows: ACCEPTED
- AI Contracts: ACCEPTED
- Pattern Library: ACCEPTED
- Editing Intelligence: ACCEPTED

## Accepted Editing Intelligence principles
- AI plans editing; renderer executes deterministically
- Creative Director and Editing Intelligence have distinct responsibilities
- two-pass editorial selection then timing/composition
- real natural voice remains the narrative backbone by default
- natural pauses are preserved; dead air is trimmed
- semantic cut grammar, not timer-based cutting
- proof-first product visibility
- normalized 0..1 visual coordinate system
- presenter placement is gesture/product/caption aware
- semantic captions with sparse emphasis
- music and SFX are optional
- motion uses whitelisted purposeful presets
- layered timeline model
- deterministic collision/hard validation
- minimal-scope repair
- descriptive editing diagnostics
- seven V1 EditingProfile seeds

## Canonical Editing Intelligence spec artifacts
- `docs/spec-artifacts/editing-intelligence/schema.ts`
- `docs/spec-artifacts/editing-intelligence/profiles/*.json`

These remain specification artifacts until implementation authorization.

## Still to freeze before Codex implementation
- Template contract
- Video Engine / renderer contract
- exact media Asset ingest/normalization contract
- render validation rules
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
`docs/08_VIDEO_ENGINE.md`
