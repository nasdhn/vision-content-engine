# ADR-0031 — Phase 9 learning runtime boundary

**Status:** Accepted  
**Date:** 2026-09-22  
**Decision scope:** Phase 9 implementation

## Context

Phase 8 closed the analytics and attribution evidence layer. The next phase must convert that
evidence into learning without giving an LLM authority to redefine evidence quality, overwrite
provenance or mutate strategy.

The frozen V1 specification already provides `Experiment`, `ExperimentArm`, `Insight`,
`Recommendation`, the `ANALYST` capability and `WEEKLY_ANALYSIS` workflow type.

## Decision

Phase 9 uses a two-layer learning architecture:

```text
deterministic Evidence Engine
→ bounded Analyst
```

The Evidence Engine owns:

```text
comparability
source authority
measurement-window compatibility
metric-semantics compatibility
sample counts
outlier/direction diagnostics
deterministic confidence ceiling
required limitations
```

The Analyst owns:

```text
human-readable interpretation
bounded Insight wording
bounded Recommendation / next-test proposal
```

The Analyst may lower confidence but may never exceed the deterministic ceiling.

## Evidence policy

Runtime policy V1 freezes:

```text
single Publication max        = WEAK_SIGNAL
INTERESTING min sample        = 3
INTERESTING min publish dates = 2
FAIRLY_SOLID min sample       = 6
FAIRLY_SOLID min dates        = 3
outlier dominance share       = 0.60
consistent direction share    = 0.75
causal claims                 = disabled
```

These are implementation policy thresholds, not universal statistical guarantees.

## Persistence

No new Prisma model is introduced.

Use existing:

```text
Insight
Recommendation
Experiment / ExperimentArm
ModelInvocation
WorkflowRun(WEEKLY_ANALYSIS)
JobAttempt
OutboxEvent
AuditEvent
```

`Insight.evidenceJson` and `limitationsJson` retain the deterministic evidence contract required to
audit a conclusion.

## Human agency

Recommendations are proposals.

`ACCEPTED` does not mutate prompts, Patterns, templates, profiles, cadence, CTA policy or content.

A DRAFT Experiment may be created only after a separate explicit operator action from an accepted
Recommendation.

## Causality

Phase 9 V1 does not authorize autonomous causal claims.

Experiment comparisons remain descriptive unless a later accepted contract defines a causal design.

## Consequences

Positive:

- LLM cannot silently broaden evidence.
- Phase 8 provenance remains intact.
- learning output is reviewable and reproducible.
- human strategy control is preserved.
- no schema migration is needed.

Tradeoffs:

- conservative confidence may produce many `INSUFFICIENT_DATA` / `WEAK_SIGNAL` outputs early.
- some potentially useful cross-platform comparisons remain blocked.
- next-test execution requires an explicit operator action.

## Rejected alternatives

### Let the Analyst decide comparability and confidence

Rejected because it makes evidence quality nondeterministic and hard to audit.

### Auto-promote successful patterns or editing profiles

Rejected because V1 explicitly forbids strategy autopilot.

### Create an Experiment automatically when a Recommendation becomes ACCEPTED

Rejected because acceptance and execution are distinct operator decisions.

### Add a generic weighted engagement score

Rejected because Phase 8/9 preserve business-outcome hierarchy and platform metric semantics.
