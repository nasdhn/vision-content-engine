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
Video Engine accepted.  
Product Capture / Playwright accepted.  
Dashboard UX accepted.  
Distribution accepted.  
Analytics & Learning accepted.  
Security / Observability / Operations accepted.  
Test Strategy & Acceptance accepted.  
Final specification reconciliation is now the active task.

## Version
Draft: `spec-v0.15`

## Foundation status
- Product: ACCEPTED
- Architecture: ACCEPTED
- Domain Model: ACCEPTED
- Prisma: ACCEPTED
- Workflows: ACCEPTED
- AI Contracts: ACCEPTED
- Pattern Library: ACCEPTED
- Editing Intelligence: ACCEPTED
- Video Engine: ACCEPTED
- Product Capture / Playwright: ACCEPTED
- Dashboard UX: ACCEPTED
- Distribution: ACCEPTED
- Analytics & Learning: ACCEPTED
- Security / Observability / Operations: ACCEPTED
- Test Strategy & Acceptance: ACCEPTED

## Accepted test principles
- deterministic CI by default
- controllable clock/IDs/randomness
- real PostgreSQL for persistence/migration tests
- exhaustive state-machine invariants
- fake deterministic AI/provider adapters in normal CI
- media functional/perceptual regression rather than byte-identical encoding
- controlled Playwright fixture E2E
- publication ambiguity/duplicate prevention as release blocker
- Redis loss recoverable from canonical state
- analytics NULL/idempotence/evidence tests
- security/redaction/cost/kill-switch tests
- backup restore drills
- real-provider smoke tests explicit/off by default
- progressive production enablement
- documented first-production acceptance report

## Canonical Test Strategy artifacts
- `docs/spec-artifacts/test-strategy/test-tiers.json`
- `docs/spec-artifacts/test-strategy/release-blocking-invariants.json`
- `docs/spec-artifacts/test-strategy/acceptance-matrix.json`
- `docs/spec-artifacts/test-strategy/fixture-policy.json`
- `docs/spec-artifacts/test-strategy/provider-smoke-policy.json`
- `docs/spec-artifacts/test-strategy/fixtures/FIXTURE_CATALOG.md`

## Gate
Codex implementation is **NOT authorized yet**.

Before `spec-v1.0`, perform:
1. full final reconciliation;
2. resolve remaining known schema/contract debt;
3. verify cross-document terminology and lineage;
4. freeze corrected canonical schema/contracts;
5. then produce Codex Master Handoff.

## Next specification task
Final Specification Reconciliation.
