# Specification Status

## Current stage
All substantive V1 specification blocks are accepted and cross-reconciled.

Final `spec-v1.0` freeze + Codex Master Handoff is now the only remaining specification task.

## Version
Draft: `spec-v0.16`

## Accepted foundation
- Product: ACCEPTED
- Architecture: ACCEPTED
- Domain / Prisma: ACCEPTED + RECONCILED
- Workflows: ACCEPTED + RECONCILED
- AI Contracts: ACCEPTED + RECONCILED
- Pattern Library: ACCEPTED
- Editing Intelligence: ACCEPTED
- Video Engine: ACCEPTED
- Product Capture / Playwright: ACCEPTED
- Dashboard UX: ACCEPTED
- Distribution: ACCEPTED
- Analytics & Learning: ACCEPTED
- Security / Observability / Operations: ACCEPTED
- Test Strategy & Acceptance: ACCEPTED
- Repository Conventions: ACCEPTED + RECONCILED
- Implementation Plan: ACCEPTED FOR HANDOFF

## Closed final debt
- exact ScriptVersion → ConceptVersion lineage
- exact CreativePlanVersion → TemplateVersion / EditingProfileVersion lineage
- DB-backed immutable KnowledgeSnapshot
- SourceReference provenance
- repository-backed Prompt Registry
- ModelInvocationAttempt
- bounded raw AI payload retention
- Creative QA ModelInvocation linkage
- manual PlatformAccount without credentials
- required raw analytics provenance
- typed attribution source/idempotence
- explicit Publication delivery mode
- AssetKind FONT
- repository structure mismatch
- legacy security-spec ambiguity

## Canonical final-reconciliation sources
- `docs/18_FINAL_RECONCILIATION.md`
- `docs/spec-artifacts/schema.prisma`
- `docs/spec-artifacts/final-reconciliation/*`

## Still not authorized
Application implementation is still **NOT authorized**.

## Remaining before authorization
1. apply/commit this spec-v0.16 reconciliation;
2. perform final artifact/schema sanity pass;
3. finalize `17_CODEX_MASTER_PROMPT.md`;
4. mark/tag `spec-v1.0`;
5. then authorize Phase 0 only.
