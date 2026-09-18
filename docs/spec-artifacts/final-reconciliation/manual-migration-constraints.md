# Manual Migration Constraints

The initial Prisma migration must be reviewed and amended with PostgreSQL SQL for:

1. Approval subject CHECK.
2. One ACTIVE KnowledgeSnapshot per key partial unique index.
3. REVENUE AttributionEvent amount/currency CHECK.

Application-level cross-table invariants require tests:
- ScriptVersion concept consistency.
- CreativePlanVersion ↔ EditingPlanVersion Template/Profile consistency.
- Publication exact-media lineage consistency.
