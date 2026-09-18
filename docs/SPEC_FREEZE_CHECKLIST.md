# Spec V1 Freeze Checklist

Mark an item `[x]` only after explicit validation.

## Product
- [x] Project purpose
- [x] V1 audience: Vision only
- [x] Platforms
- [x] Human recording approach
- [x] Review model
- [x] Publishing autonomy strategy
- [x] Pattern Library requirement
- [x] Editing quality requirement

## Architecture
- [x] System boundaries
- [x] Deployment topology
- [x] Repository structure
- [x] Queue strategy
- [x] Object storage strategy
- [x] Failure/retry strategy

## Domain
- [x] Entity list
- [x] Relationships
- [x] Versioning rules
- [x] Prisma schema draft
- [x] audit model
- [x] cost model

## Workflows
- [x] Content workflow
- [x] Recording workflow
- [x] Render workflow
- [x] Review workflow
- [x] Publication workflow
- [x] Analytics workflow
- [x] failure/recovery paths

## AI
- [x] Brand/Product Knowledge contract
- [x] Creator contract
- [x] Creative Director contract
- [x] Editing Intelligence contract
- [x] Creative QA contract
- [x] Analyst contract
- [x] model/provider gateway rules
- [x] prompt/version registry

## Media
- [x] Pattern schema
- [ ] Template schema
- [x] EditingProfile schema
- [x] EditingPlan schema
- [x] captions model
- [x] audio model
- [ ] asset model
- [ ] render validation rules

## Product capture
- [ ] Playwright scenario schema
- [ ] safe environment
- [ ] auth
- [ ] deterministic fixtures
- [ ] capture outputs
- [ ] failure handling

## UX
- [ ] navigation
- [ ] campaign/brief screen
- [ ] concepts screen
- [ ] recording pack screen
- [ ] production screen
- [ ] review screen
- [ ] calendar
- [ ] analytics

## Distribution
- [ ] TikTok adapter contract
- [ ] Instagram adapter contract
- [ ] YouTube adapter contract
- [ ] scheduling contract
- [ ] idempotence/reconciliation
- [ ] token lifecycle

## Analytics & learning
- [ ] raw metric model
- [ ] normalized metric model
- [ ] attribution scope
- [ ] experiment model
- [ ] confidence language
- [ ] weekly report contract

## Operations
- [ ] secrets
- [ ] logs/tracing
- [ ] cost tracking
- [ ] backups
- [ ] tests
- [ ] deployment
- [ ] rollback

## Codex handoff
- [ ] implementation phases
- [ ] acceptance criteria for every phase
- [ ] stop conditions
- [ ] inspection-first rules
- [ ] Master Prompt
- [ ] final spec tag `spec-v1.0`
