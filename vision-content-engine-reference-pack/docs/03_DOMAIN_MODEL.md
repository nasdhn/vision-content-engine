# 03 — Domain Model

## Entités principales envisagées

### Strategy / ideation
- Campaign
- Brief
- ContentPillar
- Pattern
- PatternVersion
- Reference
- Idea
- Concept
- ConceptVersion

### Writing / creative
- Script
- ScriptVersion
- CreativePlan
- CreativePlanVersion
- EditingPlan
- EditingProfile

### Media
- Asset
- RecordingRequest
- Recording
- CaptureScenario
- CaptureRun
- Template
- TemplateVersion
- Render
- RenderAttempt

### Distribution
- Platform
- PlatformAccount
- Publication
- PublicationAttempt
- Schedule

### Analytics / learning
- MetricSnapshotRaw
- MetricSnapshotNormalized
- AttributionEvent
- Experiment
- ExperimentArm
- Insight
- Recommendation

### Operations
- WorkflowRun
- JobAttempt
- Approval
- AuditEvent
- ModelInvocation
- CostEntry

## Règles
- versions immuables pour scripts, plans, templates ;
- lineage conservée de l'idée jusqu'aux analytics ;
- un champ inconnu reste `NULL`, jamais transformé artificiellement en zéro ;
- toutes les entités publiées doivent être retraçables jusqu'à leur concept/pattern.
