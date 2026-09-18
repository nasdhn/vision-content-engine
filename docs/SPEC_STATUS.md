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
Test Strategy & Acceptance is now the active design task.

## Version
Draft: `spec-v0.14`

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

## Accepted operational principles
- dedicated Docker Compose production host
- strict trust boundaries and typed validation
- secret-reference model
- private object storage
- Postgres authoritative / Redis recoverable
- transactional outbox + lease recovery
- structured correlated logs + central redaction
- worker heartbeats / queue-age / operational alerts
- cost/disk/concurrency bounds
- automated off-host DB backup + restore drills
- initial RPO <=24h / RTO <=4h targets
- pinned deployment/build/runtime versions
- controlled migrations and rollback strategy
- global kill switches
- incident runbooks
- category-specific retention
- graceful external-provider degradation
- safe local development defaults
- explicit third-party terms/licensing rechecks

## Canonical Operations artifacts
- `docs/spec-artifacts/security-operations/deployment-topology.json`
- `docs/spec-artifacts/security-operations/environment-contract.json`
- `docs/spec-artifacts/security-operations/backup-policy.json`
- `docs/spec-artifacts/security-operations/retention-policy.json`
- `docs/spec-artifacts/security-operations/observability-contract.json`
- `docs/spec-artifacts/security-operations/kill-switches.json`
- `docs/spec-artifacts/security-operations/runbooks/*.md`

## Gate
Codex implementation is **NOT authorized** until all required items are validated and this document reaches `spec-v1.0`.

## Next specification
Test Strategy & Acceptance.
