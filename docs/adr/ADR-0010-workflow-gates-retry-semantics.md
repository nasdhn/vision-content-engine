# ADR-0010 — Human gates and retry/regeneration semantics

## Status
Accepted

## Decision
V1 has two mandatory human approval gates:
1. ConceptVersion approval.
2. Final Render approval.

Human recording is conditional on CreativePlan requirements.

A technical retry keeps immutable inputs and creates a new Attempt.
A creative/input change creates a new immutable version or a new Render.

Publication ambiguity uses `PUBLISHING_UNKNOWN` and reconciliation instead of blind retry.

## Consequences
- fewer unnecessary approval clicks;
- clear audit history;
- no confusion between failed execution and changed creative intent;
- lower duplicate-publication risk.
