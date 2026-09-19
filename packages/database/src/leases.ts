import { randomUUID } from 'node:crypto';
import { invariant, leaseConfig } from '@vision/domain';
import type { LeaseConfig } from '@vision/domain';
import { Prisma } from './generated/prisma/client.js';
import type { PrismaClient, JobAttempt, OutboxEvent } from './generated/prisma/client.js';
import { audit, changed, databaseTime, lock } from './transaction.js';
import { UnitOfWork } from './persistence.js';

/** Recovery eligibility is explicit per job type; no default blind retry. */
export type RecoveryPolicies = Readonly<Record<string, 'SAFE_RETRY' | 'RECONCILE' | 'MANUAL'>>;
export class Leases {
  private readonly config: LeaseConfig;
  private readonly policies: RecoveryPolicies;
  constructor(
    private readonly client: PrismaClient,
    config: LeaseConfig,
    policies: RecoveryPolicies,
  ) {
    this.config = leaseConfig(config);
    this.policies = Object.freeze({ ...policies });
  }
  async claimJob(queueName: string, workerId: string) {
    invariant(workerId.trim(), 'OWNER_REQUIRED');
    const recoverable = Object.entries(this.policies)
      .filter(([, policy]) => policy === 'SAFE_RETRY')
      .map(([jobType]) => jobType);
    return this.client.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<JobAttempt[]>(Prisma.sql`
        SELECT * FROM "JobAttempt" WHERE "queueName" = ${queueName}
        AND ("status" = 'QUEUED' OR ("status" = 'RUNNING' AND "leaseExpiresAt" <= clock_timestamp()
          AND "jobType" = ANY(${recoverable}::text[])))
        ORDER BY "createdAt", "id" FOR UPDATE SKIP LOCKED LIMIT 1`);
      const row = rows[0];
      if (!row) return null;
      const now = await databaseTime(tx);
      const result = await tx.jobAttempt.update({
        where: { id: row.id },
        data: {
          status: 'RUNNING',
          workerId,
          leaseToken: randomUUID(),
          leaseAcquiredAt: now,
          heartbeatAt: now,
          leaseExpiresAt: new Date(now.getTime() + this.config.durationMs),
          startedAt: row.startedAt ?? now,
        },
      });
      await audit(
        tx,
        { actorType: 'WORKER', actorId: workerId },
        row.status === 'RUNNING' ? 'JobAttempt.recovered' : 'JobAttempt.claimed',
        'JobAttempt',
        row.id,
      );
      return result;
    });
  }
  async heartbeatJob(id: string, token: string) {
    return this.client.$transaction(async (tx) => {
      await lock(tx, 'JobAttempt', id, 'STALE_LEASE');
      const result = await tx.$executeRaw`
        WITH t AS MATERIALIZED (SELECT clock_timestamp()::timestamptz(3) AS now)
        UPDATE "JobAttempt" SET "heartbeatAt" = t.now,
          "leaseExpiresAt" = t.now + ${this.config.durationMs}::double precision * interval '1 millisecond'
        FROM t WHERE "id" = ${id}::uuid AND "status" = 'RUNNING'
          AND "leaseToken" = ${token}::uuid AND "leaseExpiresAt" > t.now`;
      invariant(result === 1, 'STALE_LEASE');
    });
  }
  async finishJob(
    id: string,
    token: string,
    status: 'SUCCEEDED' | 'FAILED' | 'CANCELLED',
    failureCode?: string,
    persistResult?: (unit: UnitOfWork) => Promise<void>,
  ) {
    invariant(['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(status), 'INVALID_TRANSITION');
    return this.client.$transaction(async (tx) => {
      await lock(tx, 'JobAttempt', id, 'STALE_LEASE');
      const owners = await tx.$queryRaw<{ workerId: string }[]>`
        SELECT "workerId" FROM "JobAttempt" WHERE "id" = ${id}::uuid
          AND "status" = 'RUNNING' AND "leaseToken" = ${token}::uuid
          AND "leaseExpiresAt" > clock_timestamp()`;
      invariant(owners[0], 'STALE_LEASE');
      // Database-only callback. The final expiry check below also fences its writes.
      await persistResult?.(
        new UnitOfWork(tx, { actorType: 'WORKER', actorId: owners[0].workerId }),
      );
      const result = await tx.$executeRaw`
        WITH t AS MATERIALIZED (SELECT clock_timestamp()::timestamptz(3) AS now)
        UPDATE "JobAttempt" SET "status" = ${status}::"JobAttemptStatus", "finishedAt" = t.now,
          "failureCode" = COALESCE(${failureCode ?? null}, "failureCode")
        FROM t WHERE "id" = ${id}::uuid AND "status" = 'RUNNING'
          AND "leaseToken" = ${token}::uuid AND "leaseExpiresAt" > t.now`;
      invariant(result === 1, 'STALE_LEASE');
      const row = await tx.jobAttempt.findUniqueOrThrow({ where: { id } });
      await changed(
        tx,
        { actorType: 'WORKER', actorId: row.workerId! },
        `JobAttempt.${status.toLowerCase()}`,
        'JobAttempt',
        id,
      );
      return row;
    });
  }
  async claimOutbox(owner: string) {
    invariant(owner.trim(), 'OWNER_REQUIRED');
    return this.client.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<OutboxEvent[]>`
        SELECT * FROM "OutboxEvent" WHERE
          ("status" = 'PENDING' AND "availableAt" <= clock_timestamp()) OR
          ("status" = 'DISPATCHING' AND "claimExpiresAt" <= clock_timestamp())
        ORDER BY "availableAt", "id" FOR UPDATE SKIP LOCKED LIMIT 1`;
      const row = rows[0];
      if (!row) return null;
      const now = await databaseTime(tx);
      return tx.outboxEvent.update({
        where: { id: row.id },
        data: {
          status: 'DISPATCHING',
          claimOwner: owner,
          claimToken: randomUUID(),
          claimedAt: now,
          claimHeartbeatAt: now,
          claimExpiresAt: new Date(now.getTime() + this.config.durationMs),
          attemptCount: { increment: 1 },
        },
      });
    });
  }
  async heartbeatOutbox(id: string, token: string) {
    return this.client.$transaction(async (tx) => {
      await lock(tx, 'OutboxEvent', id, 'STALE_LEASE');
      const result = await tx.$executeRaw`
        WITH t AS MATERIALIZED (SELECT clock_timestamp()::timestamptz(3) AS now)
        UPDATE "OutboxEvent" SET "claimHeartbeatAt" = t.now,
          "claimExpiresAt" = t.now + ${this.config.durationMs}::double precision * interval '1 millisecond'
        FROM t WHERE "id" = ${id}::uuid AND "status" = 'DISPATCHING'
          AND "claimToken" = ${token}::uuid AND "claimExpiresAt" > t.now`;
      invariant(result === 1, 'STALE_LEASE');
    });
  }
  async finishOutbox(
    id: string,
    token: string,
    status: 'DISPATCHED' | 'FAILED',
    errorCode?: string,
  ) {
    invariant(status === 'DISPATCHED' || status === 'FAILED', 'INVALID_TRANSITION');
    return this.client.$transaction(async (tx) => {
      await lock(tx, 'OutboxEvent', id, 'STALE_LEASE');
      const now = await databaseTime(tx);
      const result = await tx.outboxEvent.updateMany({
        where: { id, status: 'DISPATCHING', claimToken: token },
        data: {
          status,
          ...(status === 'DISPATCHED' ? { dispatchedAt: now } : {}),
          ...(errorCode !== undefined ? { lastError: errorCode } : {}),
        },
      });
      invariant(result.count === 1, 'STALE_LEASE');
    });
  }
}
/** Use this stable key at the future transport boundary, never the rotating claimToken. */
export function outboxDelivery(event: Pick<OutboxEvent, 'id' | 'eventType' | 'payloadJson'>) {
  return {
    deduplicationKey: event.id,
    eventType: event.eventType,
    payload: event.payloadJson,
  } as const;
}
