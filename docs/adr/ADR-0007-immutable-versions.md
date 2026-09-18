# ADR-0007 — Stable roots with immutable version entities

## Status
Accepted

## Context
The Content Engine must preserve exactly what was used to produce and publish historical content. Mutable rows alone would make old lineage lie after later edits.

## Decision
Version-sensitive objects use:
- a stable root entity;
- immutable version rows.

Examples:
- Pattern / PatternVersion
- Concept / ConceptVersion
- Script / ScriptVersion
- CreativePlan / CreativePlanVersion
- EditingPlan / EditingPlanVersion
- Template / TemplateVersion
- EditingProfile / EditingProfileVersion
- CaptureScenario / CaptureScenarioVersion

Published lineage points to exact version rows.

## Consequences
- historical reproducibility improves;
- analytics can be tied to exact creative inputs;
- edits create new versions instead of mutating history;
- storage grows modestly but remains operationally simple.
