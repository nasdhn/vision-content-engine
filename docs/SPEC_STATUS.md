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
Dashboard UX is now the active design task.

## Version
Draft: `spec-v0.10`

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

## Accepted Product Capture principles
- deterministic CaptureScenarioVersion execution
- controlled Vision capture environment/account
- fresh BrowserContext per CaptureRun
- secret-backed auth state
- stable locator contract
- semantic readiness rather than networkidle/fixed sleeps
- bounded capture DSL
- screenshot/video/mark-moment outputs
- fixture-first product proof
- bounded live-provider variability/cost
- protected traces and failure diagnostics
- restricted origins/destructive actions
- browser/build version pinning
- five initial V1 capture scenarios

## Canonical Product Capture spec artifacts
- `docs/spec-artifacts/product-capture/schema.ts`
- `docs/spec-artifacts/product-capture/browser-profiles.json`
- `docs/spec-artifacts/product-capture/safety-policies.json`
- `docs/spec-artifacts/product-capture/scenarios/*.json`

These remain specification artifacts until implementation authorization.

## Gate
Codex implementation is **NOT authorized** until all required items are validated and this document reaches `spec-v1.0`.

## Next specification
Dashboard UX specification.
