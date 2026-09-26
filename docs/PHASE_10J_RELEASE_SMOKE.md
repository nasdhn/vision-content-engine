# Phase 10J — Runbooks + Release Smoke

## Status

Implementation candidate.

## Scope

Phase 10J adds a release smoke that is usable with the configured V1
environment rather than being limited to the Phase 0 local bootstrap.

The smoke verifies:

1. validated runtime configuration;
2. all emergency work classes paused;
3. real providers disabled;
4. PostgreSQL readiness;
5. Redis readiness;
6. configured S3-compatible storage readiness;
7. synthetic object-storage write/read/delete;
8. isolated Redis/BullMQ enqueue/consume;
9. deployed worker heartbeats outside LOCAL.

## Environment behavior

The smoke supports the canonical environments:

- `LOCAL`;
- `STAGING_CAPTURE`;
- `PRODUCTION`.

It does not require loopback dependency URLs.

`checkLocalInfra()` remains the stricter LOCAL bootstrap canary and is not
repurposed as the production release smoke.

In LOCAL, worker-heartbeat mechanics remain covered by
`tests/runtime/health-bullmq-smoke.ts`.

In STAGING_CAPTURE and PRODUCTION, release smoke reads the canonical runtime
heartbeat keys and requires every deployed worker/control component to report
HEALTHY.

## Safety boundary

The release smoke refuses to start unless:

- `VCE_REAL_PROVIDERS_ENABLED=false`;
- `PAUSE_ALL_PUBLISHING=true`;
- `PAUSE_AI_GENERATION=true`;
- `PAUSE_CAPTURE=true`;
- `PAUSE_RENDERING=true`;
- `PAUSE_ANALYTICS_COLLECTION=true`.

It does not intentionally invoke AI, capture, render, publishing, analytics
provider, Instagram, YouTube, Umami, or Vision attribution side effects.

The only deliberate canary writes are:

- one temporary object under `release-canary/`, deleted in cleanup;
- one isolated BullMQ queue/job, removed in cleanup.

## Existing runtime regressions

The Phase 10J gate also reuses the existing deterministic runtime tests for:

- worker heartbeats / queue health;
- publication BullMQ transport;
- analytics BullMQ transport;
- weekly-analysis BullMQ transport.

These remain separate from the deployed release canary.

## Render and capture

Render and browser capture already have dedicated targeted smoke coverage.

They are not executed by the default operational release smoke. They remain
required when the corresponding media/capture surface changes.

## Runbooks

Canonical operational runbooks remain under:

`docs/spec-artifacts/security-operations/runbooks/`

including:

- `PUBLISHING_UNKNOWN.md`;
- `DUPLICATE_PUBLICATION.md`;
- `QUEUE_STALL.md`;
- `RUNAWAY_COST.md`;
- `SECRET_COMPROMISE.md`;
- `RESTORE.md`.

## Commands

Release smoke:

    pnpm test:release-smoke

Phase gate:

    pnpm check:phase10j
