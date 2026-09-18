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
Security / Observability / Operations is now the active design task.

## Version
Draft: `spec-v0.13`

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

## Accepted Analytics principles
- business outcomes outrank vanity metrics
- raw / normalized / attribution remain separate
- NULL is never silently treated as zero
- platform metrics retain semantic/comparability metadata
- collection uses content-age windows
- Instagram/YouTube automated analytics
- TikTok manual analytics until approved API access exists
- Umami via supported API
- stable Publication trackingCode
- DIRECT / INFERRED / UNKNOWN attribution
- signed Vision product-event ingest
- source event idempotence and typed revenue
- privacy-minimized identity
- deterministic feature extraction
- versioned evidence policy
- experiments preferred over uncontrolled causal claims
- Analyst recommends but does not autonomously change strategy

## Prisma amendments
Canonical spec schema now includes:
- MetricCollectionMethod
- Publication.trackingCode
- MetricSnapshotRaw collection method/operation identity
- additional normalized metric/comparability fields
- AttributionEvent source-system idempotence and typed revenue

## Canonical Analytics artifacts
- `docs/spec-artifacts/analytics-learning/schema.ts`
- `docs/spec-artifacts/analytics-learning/metric-definitions.json`
- `docs/spec-artifacts/analytics-learning/collection-windows.json`
- `docs/spec-artifacts/analytics-learning/evidence-policy.json`
- `docs/spec-artifacts/analytics-learning/attribution-contract.json`
- `docs/spec-artifacts/analytics-learning/adapters/*.json`

## Gate
Codex implementation is **NOT authorized** until all required items are validated and this document reaches `spec-v1.0`.

## Next specification
Security / Observability / Operations.
