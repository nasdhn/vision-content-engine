# ADR-0012 — Versioned evidence-bound AI contracts

## Status
Accepted

## Decision
All production AI use is performed through five logical capabilities behind one provider gateway.

Every call is tied to:
- immutable prompt identity/version/hash;
- input/output contract versions;
- versioned Knowledge Snapshot;
- model/provider metadata;
- bounded cost/retry policy.

Outputs pass schema, reference, business-rule and claim validation before entering canonical state.

Creative QA may only assess dimensions supported by supplied evidence.

## Consequences
- provider/model can change without changing business contracts;
- hallucinated IDs are rejected;
- historic AI decisions are reproducible enough to audit;
- AI cannot silently invent facts or claim visual inspection it did not perform.
