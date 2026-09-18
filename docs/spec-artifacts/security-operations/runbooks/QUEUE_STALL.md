# Queue Stall Runbook

1. Inspect queue depth and oldest-job age.
2. Check worker heartbeats.
3. Check Redis and external dependency health.
4. Restart affected worker when safe.
5. Recover expired leases.
6. Requeue only from canonical Postgres state.
7. Escalate if backlog continues to grow.
