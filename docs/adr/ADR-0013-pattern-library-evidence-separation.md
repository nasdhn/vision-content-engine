# ADR-0013 — Pattern Library as immutable strategy, evidence derived separately

## Status
Accepted

## Decision
A Pattern defines a reusable marketing/story mechanism.

PatternVersion remains immutable and does not contain mutable performance truth.

Performance/evidence is computed separately from publication lineage and analytics.

The initial V1 library contains eight distinct Pattern mechanisms. New patterns must pass a semantic-overlap gate.

## Consequences
- historical ConceptVersion lineage remains truthful;
- performance can evolve without mutating strategic definitions;
- the Creator receives a smaller, more meaningful candidate set;
- angles/variants do not pollute the Pattern taxonomy.
