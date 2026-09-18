# ADR-0016 — Deterministic controlled Playwright capture

## Status
Accepted

## Decision
Product capture uses immutable CaptureScenarioVersion definitions executed by Playwright against a dedicated controlled Vision environment/account.

Each CaptureRun uses a fresh BrowserContext, secret-backed authentication state, stable locators, semantic readiness checks and bounded typed steps.

LLMs cannot free-roam the browser or inject arbitrary JavaScript into capture scenarios.

## Consequences
- repeatable product proof;
- lower risk of customer-data exposure;
- fewer flaky scenarios;
- clearer debugging and version provenance;
- Editing Intelligence receives timestamped/typed media instead of opaque screen recordings.
