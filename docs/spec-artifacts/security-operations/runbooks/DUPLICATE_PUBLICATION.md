# Duplicate Publication Runbook

1. Pause the affected publisher.
2. Identify Publication and all PublicationAttempts.
3. Preserve all remote identifiers.
4. Determine where idempotence/reconciliation failed.
5. Remove remote duplicate manually only if intended.
6. Reconcile canonical DB state.
7. Fix the bug before resuming.
