# Phase 0 test harness

`pnpm test` uses synthetic, in-process fixtures only. The scripted provider and manual clock
are test utilities for future fake AI, publisher and analytics adapters. They implement no
business workflow or provider contract yet. Real-provider tests are absent and disabled.

`pnpm test:infra` is an explicit local integration canary: PostgreSQL query, Redis PING,
signed S3 write/read/delete and anonymous-access denial. It requires `pnpm infra:up`,
refuses remote endpoints and never applies business migrations.

Domain, outbox, human gates, publication reconciliation, media and attribution tests belong
to their separately authorized implementation phases. Passing this harness does not certify V1.
