-- spec-v1.0.2 canonical migration requirements; NOT applied by this amendment.
-- Include alongside the three existing manual constraints in the future initial migration.
-- Nullable metadata is permitted outside active states, including retained terminal metadata.
-- Expiry relative to the PostgreSQL clock belongs in conditional writes, never in a CHECK.

ALTER TABLE "JobAttempt"
  ADD CONSTRAINT "JobAttempt_running_lease_required" CHECK (
    "status" <> 'RUNNING'
    OR (
      "workerId" IS NOT NULL
      AND "leaseToken" IS NOT NULL
      AND "leaseAcquiredAt" IS NOT NULL
      AND "heartbeatAt" IS NOT NULL
      AND "leaseExpiresAt" IS NOT NULL
    )
  ),
  ADD CONSTRAINT "JobAttempt_lease_time_order" CHECK (
    ("leaseExpiresAt" IS NULL OR "leaseAcquiredAt" IS NULL
      OR "leaseExpiresAt" > "leaseAcquiredAt")
    AND ("heartbeatAt" IS NULL OR "leaseAcquiredAt" IS NULL
      OR "heartbeatAt" >= "leaseAcquiredAt")
  );

ALTER TABLE "OutboxEvent"
  ADD CONSTRAINT "OutboxEvent_dispatching_claim_required" CHECK (
    "status" <> 'DISPATCHING'
    OR (
      "claimOwner" IS NOT NULL
      AND "claimToken" IS NOT NULL
      AND "claimedAt" IS NOT NULL
      AND "claimHeartbeatAt" IS NOT NULL
      AND "claimExpiresAt" IS NOT NULL
    )
  ),
  ADD CONSTRAINT "OutboxEvent_claim_time_order" CHECK (
    ("claimExpiresAt" IS NULL OR "claimedAt" IS NULL
      OR "claimExpiresAt" > "claimedAt")
    AND ("claimHeartbeatAt" IS NULL OR "claimedAt" IS NULL
      OR "claimHeartbeatAt" >= "claimedAt")
  );
