# Phase 11B — Reviewed Capture Canary Evidence

## Scope

This document freezes the non-secret evidence from the explicitly reviewed
remote Product Capture canary.

No credential or Playwright storage-state payload is stored here.

## Canary

- Scenario: `PRICING_PAGE`
- Scenario version: `018f3000-0000-7000-8000-000000000004`
- Environment: `VISION_CAPTURE_DEMO`
- Base URL: `https://capture-demo.urvision.fr`
- Authentication profile: `VISION_CAPTURE_ACCOUNT_V1`
- Fixture mode: `PREPARED_STATE`
- Reset before run: `false`

## Result

- Execution: `SUCCEEDED`
- Executed steps: `4`
- Required locator `pricing-primary-card`: visible
- Console errors: `0`
- Page errors: `0`
- Request failures: `0`

## Screenshot evidence

- Output: `pricing.png`
- Size: `106133` bytes
- SHA-256:
  `18738b4e43dd5215a9e24249d571fb0c6d9600765ccd9b7b92c8fd3a8effa778`

Human visual inspection confirmed the expected pricing-page Capture result.

## Security

- Storage-state credential committed to Git: `false`
- Credential contents recorded in evidence: `false`
- Customer data used: `false`
- Real customer mission used: `false`
- External provider cost: `USD 0`

The credential remained in the reviewed runtime-mounted secret boundary.

## Limitation

The selected `/tarifs` target is a public route.

The successful run proves the reviewed authenticated browser context,
credential-loading boundary, remote navigation, deterministic assertions
and screenshot Capture path against the dedicated controlled environment.

It does not independently prove access to protected-session-only product
content.

This limitation is retained explicitly rather than overstating the canary.
