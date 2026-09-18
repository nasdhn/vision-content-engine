# Security / Observability / Operations Spec Artifacts

Status: specification artifacts only.

Core rules:
- secrets never enter docs/jobs/logs/AI prompts;
- Postgres is authoritative; Redis is recoverable infrastructure;
- object storage is private and canonical for media;
- heavy workers are resource-bounded;
- publishing ambiguity is reconciled before retry;
- backups are monitored and periodically restored in drills;
- local development cannot publish to real accounts by default;
- every production deployment is pinned and observable.
