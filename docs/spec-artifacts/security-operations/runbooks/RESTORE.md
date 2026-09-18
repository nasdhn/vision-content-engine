# Restore Runbook

1. Provision clean host/environment.
2. Restore PostgreSQL.
3. Validate schema and application version compatibility.
4. Reconnect canonical object storage.
5. Restore secret/config references.
6. Start Redis, API, control and workers.
7. Recover outbox/job leases from canonical DB state.
8. Reconcile every PUBLISHING_UNKNOWN publication.
9. Validate representative approved Assets.
10. Resume schedules/kill switches deliberately.

Never blindly replay old Redis queues after restore.
