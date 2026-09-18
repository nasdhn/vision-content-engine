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
- [ ] Prisma schema draft
- [x] audit model
- [x] cost model

## Workflows
- [ ] Content workflow
- [ ] Recording workflow
- [ ] Render workflow
- [ ] Review workflow
- [ ] Publication workflow
- [ ] Analytics workflow
- [ ] failure/recovery paths

## AI
- [ ] Brand/Product Knowledge contract
- [ ] Creator contract
- [ ] Creative Director contract
- [ ] Editing Intelligence contract
- [ ] Creative QA contract
- [ ] Analyst contract
- [ ] model/provider gateway rules
- [ ] prompt/version registry

## Media
- [ ] Pattern schema
- [ ] Template schema
- [ ] EditingProfile schema
- [ ] EditingPlan schema
- [ ] captions model
- [ ] audio model
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
