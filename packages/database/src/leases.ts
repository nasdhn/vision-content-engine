import { randomUUID } from 'node:crypto';
import { invariant, leaseConfig } from '@vision/domain';
import type { LeaseConfig } from '@vision/domain';
import { Prisma } from './generated/prisma/client.js';
import type { PrismaClient, JobAttempt, OutboxEvent } from './generated/prisma/client.js';
import { audit, changed, databaseTime, lock } from './transaction.js';
import { UnitOfWork } from './persistence.js';

/** Recovery eligibility is explicit per job type; no default blind retry. */
export type RecoveryPolicy = 'SAFE_RETRY' | 'RECONCILE' | 'MANUAL';
export type RecoveryPolicies = Readonly<Record<string, RecoveryPolicy>>;
export type JobClaimIdentity = Readonly<{
  queueName: string;
  jobType: string;
  operationId: string;
  workflowRunId: string | null;
}>;
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
  async claimJobById(
    id: string,
    workerId: string,
    policy: RecoveryPolicy,
    expected: JobClaimIdentity,
  ) {
    invariant(workerId.trim(), 'OWNER_REQUIRED');
    return this.client.$transaction(async (tx) => {
      await lock(tx, 'JobAttempt', id, 'JOB_ATTEMPT_NOT_FOUND');
      const row = await tx.jobAttempt.findUniqueOrThrow({ where: { id } });
      invariant(
        row.queueName === expected.queueName &&
          row.jobType === expected.jobType &&
          row.operationId === expected.operationId &&
          row.workflowRunId === expected.workflowRunId,
        'JOB_CLAIM_IDENTITY_MISMATCH',
      );
      if (row.status === 'SUCCEEDED') return { kind: 'ALREADY_DONE', job: row } as const;
      if (row.status === 'FAILED' || row.status === 'CANCELLED') {
        return { kind: 'TERMINAL', job: row } as const;
      }
      const now = await databaseTime(tx);
      if (row.status === 'RUNNING') {
        const leaseExpiresAt = row.leaseExpiresAt;
        if (leaseExpiresAt === null) {
          return { kind: 'RECOVERY_REQUIRED', job: row, policy } as const;
        }
        if (leaseExpiresAt.getTime() > now.getTime()) {
          return { kind: 'BUSY', job: row } as const;
        }
        if (policy !== 'SAFE_RETRY') {
          return { kind: 'RECOVERY_REQUIRED', job: row, policy } as const;
        }
      }
      invariant(row.status === 'QUEUED' || row.status === 'RUNNING', 'JOB_NOT_RUNNABLE');
      const recovered = row.status === 'RUNNING';
      const result = await tx.jobAttempt.update({
        where: { id },
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
        recovered ? 'JobAttempt.recovered' : 'JobAttempt.claimed',
        'JobAttempt',
        id,
      );
      return { kind: 'READY', recovered, job: result } as const;
    });
  }

  async withJobLease<T>(
    id: string,
    token: string,
    work: (unit: UnitOfWork) => Promise<T>,
  ): Promise<T> {
    return this.client.$transaction(async (tx) => {
      await lock(tx, 'JobAttempt', id, 'STALE_LEASE');
      const owners = await tx.$queryRaw<{ workerId: string }[]>`
        SELECT "workerId" FROM "JobAttempt" WHERE "id" = ${id}::uuid
          AND "status" = 'RUNNING' AND "leaseToken" = ${token}::uuid
          AND "leaseExpiresAt" > clock_timestamp()`;
      const owner = owners[0];
      invariant(owner?.workerId, 'STALE_LEASE');
      return work(new UnitOfWork(tx, { actorType: 'WORKER', actorId: owner.workerId }));
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
  async claimOutbox(owner: string, eventTypes?: readonly string[]) {
    invariant(owner.trim(), 'OWNER_REQUIRED');
    if (eventTypes !== undefined) invariant(eventTypes.length > 0, 'EVENT_TYPES_REQUIRED');
    return this.client.$transaction(async (tx) => {
      const rows =
        eventTypes === undefined
          ? await tx.$queryRaw<OutboxEvent[]>`
            SELECT * FROM "OutboxEvent" WHERE
              ("status" = 'PENDING' AND "availableAt" <= clock_timestamp()) OR
              ("status" = 'DISPATCHING' AND "claimExpiresAt" <= clock_timestamp())
            ORDER BY "availableAt", "id" FOR UPDATE SKIP LOCKED LIMIT 1`
          : await tx.$queryRaw<OutboxEvent[]>(Prisma.sql`
            SELECT * FROM "OutboxEvent" WHERE (
              ("status" = 'PENDING' AND "availableAt" <= clock_timestamp()) OR
              ("status" = 'DISPATCHING' AND "claimExpiresAt" <= clock_timestamp())
            ) AND "eventType" = ANY(${[...eventTypes]}::text[])
            ORDER BY "availableAt", "id" FOR UPDATE SKIP LOCKED LIMIT 1`);
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
      const result =
        status === 'DISPATCHED'
          ? await tx.$executeRaw`
              WITH t AS MATERIALIZED (SELECT clock_timestamp()::timestamptz(3) AS now)
              UPDATE "OutboxEvent" SET "status" = 'DISPATCHED', "dispatchedAt" = t.now,
                "lastError" = COALESCE(${errorCode ?? null}::text, "lastError")
              FROM t WHERE "id" = ${id}::uuid AND "status" = 'DISPATCHING'
                AND "claimToken" = ${token}::uuid AND "claimExpiresAt" > t.now`
          : await tx.$executeRaw`
              WITH t AS MATERIALIZED (SELECT clock_timestamp()::timestamptz(3) AS now)
              UPDATE "OutboxEvent" SET "status" = 'FAILED',
                "lastError" = COALESCE(${errorCode ?? null}::text, "lastError")
              FROM t WHERE "id" = ${id}::uuid AND "status" = 'DISPATCHING'
                AND "claimToken" = ${token}::uuid AND "claimExpiresAt" > t.now`;
      invariant(result === 1, 'STALE_LEASE');
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
