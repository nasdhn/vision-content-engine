# ADR-0022 — Final V1 lineage and runtime audit reconciliation

## Status
Accepted

## Decision
Before spec-v1.0, V1 closes remaining cross-specification gaps by:

- linking ScriptVersion to exact ConceptVersion;
- linking CreativePlanVersion to exact TemplateVersion/EditingProfileVersion;
- persisting immutable KnowledgeSnapshot rows in PostgreSQL;
- introducing curated SourceReference provenance while keeping autonomous Researcher deferred;
- using repository-backed immutable prompts;
- separating logical ModelInvocation from concrete ModelInvocationAttempt rows;
- linking Creative QA invocations to RenderAttempt;
- requiring normalized analytics to reference raw evidence;
- typing attribution source identity;
- making Publication delivery mode explicit.

Historical Prisma review documents remain design history; final canonical authority is the reconciled schema plus final reconciliation document.

## Consequences
The implementation handoff no longer has to invent lineage, retry, provenance or storage semantics that were previously implicit.
