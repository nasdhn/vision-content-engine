# ADR-0006 — Modular monorepo with separate runtime processes

## Status
Accepted

## Context
The Content Engine needs several workloads with very different resource profiles: HTTP API, AI calls, Chromium capture, Remotion/FFmpeg rendering, social publishing and analytics collection.

Running everything inside one API process would create reliability and scaling problems. Building independent microservices with separate databases would add unnecessary V1 complexity.

## Decision
Use one TypeScript monorepo with shared domain/application packages and separate runtime processes:

- web
- api
- control
- worker-ai
- worker-capture
- worker-render
- worker-publish
- worker-analytics

All processes share the same canonical PostgreSQL domain model while remaining independently deployable.

## Consequences
- strong code reuse without runtime coupling;
- heavy workers can move to dedicated machines later;
- API remains isolated from media workloads;
- one database remains the source of truth;
- no service-per-domain database split in V1.
