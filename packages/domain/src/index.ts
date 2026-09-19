/** Pure domain rules. No database, transport or provider dependency. */
export class DomainError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'DomainError';
  }
}
export function invariant(condition: unknown, code: string): asserts condition {
  if (!condition) throw new DomainError(code);
}
export function assertSameLineage(expected: string, actual: string): void {
  invariant(expected === actual, 'LINEAGE_MISMATCH');
}
export function assertHuman(actor: { actorType: string; actorId?: string | null }): void {
  invariant(actor.actorType === 'USER' && !!actor.actorId?.trim(), 'HUMAN_APPROVAL_REQUIRED');
}
export function assertInstant(value: Date): void {
  invariant(value instanceof Date && Number.isFinite(value.getTime()), 'INVALID_INSTANT');
}
export function parseInstant(value: string): Date {
  invariant(/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value), 'OFFSET_REQUIRED');
  const date = new Date(value);
  assertInstant(date);
  return date;
}
export type LeaseConfig = Readonly<{ durationMs: number; heartbeatIntervalMs: number }>;
export function leaseConfig(input: LeaseConfig): LeaseConfig {
  invariant(
    Number.isSafeInteger(input.durationMs) && input.durationMs > 0,
    'INVALID_LEASE_DURATION',
  );
  invariant(
    Number.isSafeInteger(input.heartbeatIntervalMs) &&
      input.heartbeatIntervalMs > 0 &&
      input.heartbeatIntervalMs < input.durationMs,
    'INVALID_HEARTBEAT_INTERVAL',
  );
  return Object.freeze({ ...input });
}
export const transitions = {
  workflow: {
    PENDING: ['RUNNING', 'CANCELLED'],
    RUNNING: ['WAITING', 'SUCCEEDED', 'FAILED', 'CANCELLED'],
    WAITING: ['RUNNING', 'FAILED', 'CANCELLED'],
    SUCCEEDED: [],
    FAILED: [],
    CANCELLED: [],
  },
  job: {
    QUEUED: ['RUNNING', 'CANCELLED'],
    RUNNING: ['SUCCEEDED', 'FAILED', 'CANCELLED'],
    SUCCEEDED: [],
    FAILED: [],
    CANCELLED: [],
  },
  outbox: {
    PENDING: ['DISPATCHING'],
    DISPATCHING: ['DISPATCHED', 'FAILED'],
    DISPATCHED: [],
    FAILED: [],
  },
  concept: {
    DRAFT: ['AWAITING_REVIEW', 'ARCHIVED'],
    AWAITING_REVIEW: ['APPROVED', 'REJECTED', 'ARCHIVED'],
    APPROVED: ['DRAFT', 'ARCHIVED'],
    REJECTED: ['DRAFT', 'ARCHIVED'],
    ARCHIVED: [],
  },
  render: {
    REQUESTED: ['QUEUED', 'CANCELLED'],
    QUEUED: ['RENDERING', 'FAILED', 'CANCELLED'],
    RENDERING: ['TECHNICAL_QA', 'FAILED', 'CANCELLED'],
    TECHNICAL_QA: ['CREATIVE_QA', 'FAILED', 'CANCELLED'],
    CREATIVE_QA: ['READY_FOR_REVIEW', 'FAILED', 'CANCELLED'],
    READY_FOR_REVIEW: ['APPROVED', 'REJECTED', 'CANCELLED'],
    APPROVED: [],
    REJECTED: [],
    FAILED: [],
    CANCELLED: [],
  },
} as const;
export function assertTransition(
  machine: keyof typeof transitions,
  from: string,
  to: string,
): void {
  const states: Readonly<Record<string, readonly string[]>> = transitions[machine];
  invariant(states[from]?.includes(to), 'INVALID_TRANSITION');
}
/** A lease expiry is never evidence of remote absence. */
export function assertPublicationRetry(status: string, absenceEstablished: boolean): void {
  invariant(status !== 'PUBLISHING_UNKNOWN' || absenceEstablished, 'RECONCILIATION_REQUIRED');
}
