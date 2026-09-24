import { invariant } from '@vision/domain';
import { assertNoSecrets } from '@vision/contracts/canonical';
import { Prisma } from './generated/prisma/client.js';
export type Transaction = Prisma.TransactionClient;
export type Actor = Readonly<{ actorType: 'USER' | 'SYSTEM' | 'WORKER' | 'AI'; actorId?: string }>;
export type OutboxInput = Pick<
  Prisma.OutboxEventUncheckedCreateInput,
  'eventType' | 'aggregateType' | 'aggregateId' | 'payloadJson' | 'availableAt'
>;
export const tables = [
  'Asset',
  'RecordingRequest',
  'Campaign',
  'Brief',
  'Concept',
  'Script',
  'CreativePlan',
  'EditingPlan',
  'Template',
  'EditingProfile',
  'Pattern',
  'CaptureScenario',
  'CaptureRun',
  'Render',
  'Publication',
  'PlatformAccount',
  'WorkflowRun',
  'JobAttempt',
  'Recommendation',
  'OutboxEvent',
] as const;
export type LockTable = (typeof tables)[number];
export async function lock(
  tx: Transaction,
  table: LockTable,
  id: string,
  missingCode = 'NOT_FOUND',
): Promise<void> {
  invariant(tables.includes(table), 'INVALID_LOCK_TABLE');
  const rows = await tx.$queryRaw<{ id: string }[]>(
    Prisma.sql`SELECT "id" FROM ${Prisma.raw(`"${table}"`)} WHERE "id" = ${id}::uuid FOR UPDATE`,
  );
  invariant(rows.length === 1, missingCode);
}
export async function databaseTime(tx: Transaction): Promise<Date> {
  const [row] = await tx.$queryRaw<
    { now: Date }[]
  >`SELECT clock_timestamp()::timestamptz(3) AS now`;
  invariant(row, 'DATABASE_CLOCK_UNAVAILABLE');
  return row.now;
}
export async function audit(
  tx: Transaction,
  actor: Actor,
  action: string,
  subjectType: string,
  subjectId: string,
  subjectVersionId?: string,
) {
  return tx.auditEvent.create({
    data: {
      ...actor,
      action,
      subjectType,
      subjectId,
      ...(subjectVersionId ? { subjectVersionId } : {}),
    },
  });
}
export async function emit(tx: Transaction, input: OutboxInput) {
  assertNoSecrets(input.payloadJson);
  return tx.outboxEvent.create({
    data: {
      eventType: input.eventType,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      payloadJson: input.payloadJson,
      ...(input.availableAt !== undefined ? { availableAt: input.availableAt } : {}),
    },
  });
}
export async function changed(
  tx: Transaction,
  actor: Actor,
  action: string,
  subjectType: string,
  subjectId: string,
  versionId?: string,
) {
  await audit(tx, actor, action, subjectType, subjectId, versionId);
  await emit(tx, {
    eventType: action,
    aggregateType: subjectType,
    aggregateId: subjectId,
    payloadJson: { id: subjectId, ...(versionId ? { versionId } : {}) },
  });
}
