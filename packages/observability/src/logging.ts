export const REDACTED = '[REDACTED]';
const LIMIT = '[LIMIT]';
const sensitive =
  /password|secret|apikey|accesskey|providedkey|expectedkey|token|accesstoken|refreshtoken|authorization|cookie|session|csrf|signedurl|storagestate|credentials|headers|payload|body|prompt|snapshot|^env$|stderr|stdout/i;
const reference = /^(?:secretRef|credentialRef|credentialsRef)$/;
const safeCodes = new Set([
  'INSUFFICIENT_LOCAL_CAPACITY',
  'LOCAL_CAPACITY_UNAVAILABLE',
  'INVALID_CAPACITY_REQUEST',
  'INVALID_CAPACITY_POLICY',
  'ARTIFACT_TOO_LARGE',
  'INVALID_ARTIFACT_SIZE',
  'ARTIFACT_NOT_FILE',
  'ARTIFACT_SIZE_MISMATCH',
  'INVALID_TEMP_OWNER',
  'TEMP_ROOT_MISMATCH',
  'TEMP_OWNER_MISMATCH',
  'TEMP_CLEANUP_LIMIT',

  'BUDGET_REQUIRED',
  'INVALID_BUDGET',
  'INVALID_MODEL_POLICY',
  'BOUNDED_POLICY_REQUIRED',
  'INVALID_COST_AMOUNT',
  'BUDGET_RESERVATION_MISMATCH',
  'BUDGET_WINDOW_CLOSED',
  'BUDGET_POLICY_CONFLICT',
  'BUDGET_LEDGER_INCOMPLETE',
  'BUDGET_WINDOW_OVERLAP',
  'INVOCATION_ALREADY_EXISTS',
  'ATTEMPT_ALREADY_RUNNING',
  'COST_ACCOUNTING_MISMATCH',
  'COST_ACCOUNTING_UNDERSTATED',

  'UNKNOWN_ERROR',
  'AUTH_FAILED',
  'AUTH_REQUIRED',
  'AUTH_INVALID_INPUT',
  'AUTH_UNAVAILABLE',
  'AUTH_RATE_LIMITED',
  'ORIGIN_REJECTED',
  'CSRF_REJECTED',
  'STALE_LEASE',
  'REQUIRED_SECRET_MISSING',
  'REQUIRED_SECRET_UNAVAILABLE',
  'SECRET_ACCESS_DENIED',
  'BOOTSTRAP_STARTUP_FAILED',
  'REAL_PROVIDERS_DISABLED',
  'REAL_ANALYTICS_PROVIDERS_DISABLED',
  'PUBLISHING_PAUSED',
  'UNCLASSIFIED_PROVIDER_ERROR',
  'CAPTURE_WORKER_FAILED',
  'CAPTURE_STEP_FAILED',
  'CAPTURE_TIMEOUT',
  'CAPTURE_AUTH_TRACE_FORBIDDEN',
  'INTERNAL_RENDER_ERROR',
  'REMOTION_RENDER_FAILED',
  'FFMPEG_FAILED',
  'OBJECT_UPLOAD_FAILED',
  'INPUT_ASSET_MISSING',
  'INPUT_CHECKSUM_MISMATCH',
  'INPUT_PROBE_FAILED',
  'OUTPUT_MISSING',
  'TECHNICAL_QA_FAILED',
  'COST_BUDGET_BLOCK',
  'ATTEMPTS_EXHAUSTED',
  'AI_GENERATION_PAUSED',
  'INVALID_RECOMMENDATION_TRANSITION',
  'UMAMI_AUTH_REQUIRED',
  'UMAMI_SOURCE_UNAVAILABLE',
  'INVALID_DISTRIBUTION_OUTBOX',
  'INVALID_ANALYTICS_OUTBOX',
  'INVALID_WEEKLY_ANALYSIS_OUTBOX',
  'PUBLISH_QUEUE_ENQUEUE_FAILED',
  'ANALYTICS_QUEUE_ENQUEUE_FAILED',
  'WEEKLY_ANALYSIS_QUEUE_ENQUEUE_FAILED',
]);
function own(value: unknown, key: string): unknown {
  if (!value || typeof value !== 'object') return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && 'value' in descriptor ? descriptor.value : undefined;
}
function code(value: unknown) {
  return typeof value === 'string' && safeCodes.has(value) ? value : 'UNKNOWN_ERROR';
}
/** Never retain free-form messages, stack, cause, custom names or SDK request/response data. */
export function safeError(error: unknown): { name: string; errorCode: string } {
  try {
    const explicit = own(error, 'code') ?? own(error, 'errorCode');
    return { name: 'Error', errorCode: code(explicit ?? own(error, 'message')) };
  } catch {
    return { name: 'Error', errorCode: 'UNKNOWN_ERROR' };
  }
}

/** Defense in depth for bounded metadata; runtime logs additionally use a field allowlist. */
export function sanitizeLogValue(input: unknown): unknown {
  const seen = new WeakSet<object>();
  let remaining = 100;
  function visit(value: unknown, depth: number): unknown {
    if (--remaining < 0 || depth > 5) return LIMIT;
    if (typeof value === 'string') {
      if (value.length > 512) return LIMIT;
      // URLs are unnecessary for runtime correlation. Drop the entire value, including query/fragment.
      if (
        /\b(?:https?|postgres(?:ql)?|rediss?):\/\/|Bearer\s|-----BEGIN|\b(?:sk-|ghp_)/i.test(value)
      )
        return REDACTED;
      return value;
    }
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'bigint')
      return value > 10n ** 127n || value < -(10n ** 127n) ? LIMIT : value.toString();
    if (!value || typeof value !== 'object') return '[OMITTED]';
    if (value instanceof Error) return safeError(value);
    if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString() : null;
    if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return '[BINARY]';
    if (seen.has(value)) return '[CIRCULAR]';
    seen.add(value);
    if (Array.isArray(value)) {
      const result: unknown[] = [];
      for (let i = 0; i < Math.min(value.length, 20) && remaining > 0; i++)
        result.push(visit(own(value, String(i)), depth + 1));
      if (value.length > result.length) result.push(LIMIT);
      return result;
    }
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
      return '[OBJECT]';
    const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    let count = 0;
    for (const key in value) {
      if (++count > 20 || remaining <= 0) {
        result.truncated = LIMIT;
        break;
      }
      if (!Object.hasOwn(value, key)) continue;
      if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(key)) continue;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      result[key] =
        sensitive.test(key.replace(/[-_]/g, '')) && !reference.test(key)
          ? REDACTED
          : descriptor && 'value' in descriptor
            ? visit(descriptor.value, depth + 1)
            : '[ACCESSOR]';
    }
    return result;
  }
  try {
    return visit(input, 0);
  } catch {
    return '[UNSERIALIZABLE]';
  }
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogComponent =
  | 'api'
  | 'control'
  | 'worker-ai'
  | 'worker-capture'
  | 'worker-render'
  | 'worker-publish'
  | 'worker-analytics';
export type LogEvent =
  | 'capacity.check_failed'
  | 'capacity.insufficient'
  | 'temp.cleanup_completed'
  | 'temp.cleanup_failed'
  | 'artifact.too_large'
  | 'budget.reserved'
  | 'budget.denied'
  | 'budget.finalized'
  | 'provider_call.denied'
  | 'worker.started'
  | 'worker.stopped'
  | 'heartbeat.failed'
  | 'queue.health_read_failed'
  | 'dependency.not_ready'
  | 'runtime.started'
  | 'runtime.failed'
  | 'api.request_completed'
  | 'auth.login_failed'
  | 'job.completed'
  | 'job.failed'
  | 'queue.enqueued'
  | 'queue.enqueue_failed'
  | 'provider.failed';
const components: readonly LogComponent[] = [
  'api',
  'control',
  'worker-ai',
  'worker-capture',
  'worker-render',
  'worker-publish',
  'worker-analytics',
];
const events: readonly LogEvent[] = [
  'capacity.check_failed',
  'capacity.insufficient',
  'temp.cleanup_completed',
  'temp.cleanup_failed',
  'artifact.too_large',

  'budget.reserved',
  'budget.denied',
  'budget.finalized',
  'provider_call.denied',

  'worker.started',
  'worker.stopped',
  'heartbeat.failed',
  'queue.health_read_failed',
  'dependency.not_ready',

  'runtime.started',
  'runtime.failed',
  'api.request_completed',
  'auth.login_failed',
  'job.completed',
  'job.failed',
  'queue.enqueued',
  'queue.enqueue_failed',
  'provider.failed',
];
const levels: readonly LogLevel[] = ['debug', 'info', 'warn', 'error'];
const identifiers = [
  'instanceId',
  'operationId',
  'collectionOperationId',
  'workflowRunId',
  'jobAttemptId',
  'publicationId',
  'publicationAttemptId',
  'outboxEventId',
  'renderId',
  'renderAttemptId',
  'captureRunId',
  'experimentId',
] as const;
const enums: Record<string, readonly string[]> = {
  platform: ['INSTAGRAM', 'YOUTUBE', 'TIKTOK'],
  provider: ['FAKE', 'INSTAGRAM', 'YOUTUBE', 'UMAMI', 'deterministic-fixture'],
  queue: ['capture', 'render', 'vce-publication', 'vce-analytics', 'ai'],
  status: [
    'SUCCEEDED',
    'FAILED',
    'PAUSED',
    'IDLE',
    'NONE',
    'READY',
    'DISPATCHED',
    'RETRY_AFTER_LEASE',
    'BLOCKED',
    'PUBLISHED',
    'RECONCILIATION_ERROR',
    'COMPLETED',
    'SKIP',
    'ALREADY_DONE',
    'BUSY',
    'TERMINAL',
    'COLLECTED',
    'EXISTING',
    'FAILED_PREFLIGHT',
    'UNKNOWN_REDELIVERY',
    'PUBLISHING_UNKNOWN',
    'RETRY_QUEUED',
    'UNKNOWN',
  ],
  method: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'],
};
export type LogFields = Partial<
  Record<
    | (typeof identifiers)[number]
    | 'provider'
    | 'platform'
    | 'queue'
    | 'status'
    | 'method'
    | 'attempt'
    | 'statusCode'
    | 'requiredBytes'
    | 'freeBytes'
    | 'artifactSizeBytes'
    | 'durationMs'
    | 'errorCode'
    | 'error',
    unknown
  >
>;
export type LogSink = (line: string, level: LogLevel) => void;
const defaultSink: LogSink = (line, level) => {
  // console handles stream failures without adding raw objects; only serialized safe events reach it.
  if (level === 'warn' || level === 'error') console.error(line);
  else console.log(line);
};

export class StructuredLogger {
  constructor(
    private readonly component: LogComponent,
    private readonly sink: LogSink = defaultSink,
    private readonly minimum: LogLevel = 'info',
  ) {}
  log(level: LogLevel, event: LogEvent, fields: LogFields = {}): void {
    try {
      if (
        !levels.includes(level) ||
        !levels.includes(this.minimum) ||
        levels.indexOf(level) < levels.indexOf(this.minimum) ||
        !components.includes(this.component) ||
        !events.includes(event)
      )
        return;
      const output: Record<string, unknown> = {
        timestamp: new Date().toISOString(),
        level,
        component: this.component,
        event,
      };
      for (const key of identifiers) {
        const value = own(fields, key);
        if (
          typeof value === 'string' &&
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
        )
          output[key] = value;
      }
      for (const [key, allowed] of Object.entries(enums)) {
        const value = own(fields, key);
        if (typeof value === 'string' && allowed.includes(value)) output[key] = value;
      }
      for (const key of [
        'durationMs',
        'attempt',
        'statusCode',
        'requiredBytes',
        'freeBytes',
        'artifactSizeBytes',
      ]) {
        const value = own(fields, key);
        if (typeof value === 'number' && Number.isFinite(value) && value >= 0)
          output[key] = Math.min(value, Number.MAX_SAFE_INTEGER);
      }
      if (own(fields, 'errorCode') !== undefined) output.errorCode = code(own(fields, 'errorCode'));
      if (own(fields, 'error') !== undefined) output.error = safeError(own(fields, 'error'));
      this.sink(JSON.stringify(sanitizeLogValue(output)), level);
    } catch {
      /* Logging is best effort and must never alter canonical work. */
    }
  }
}

/** Preserve values, exceptions and transaction ordering; never serialize the operation result. */
export async function observeOperation<T>(
  logger: StructuredLogger,
  fields: LogFields,
  work: () => Promise<T>,
  kind: 'job' | 'outbox' = 'job',
): Promise<T> {
  const started = Date.now();
  try {
    const result = await work();
    let outcome: LogFields = {};
    try {
      outcome = {
        status: own(result, 'kind') ?? own(result, 'status') ?? 'SUCCEEDED',
        errorCode: own(result, 'failureCode'),
      };
    } catch {
      /* Ignore untrusted result access; preserve the result. */
    }
    try {
      logger.log(
        outcome.status === 'FAILED' ? 'warn' : 'info',
        kind === 'outbox' ? 'queue.enqueued' : 'job.completed',
        {
          ...fields,
          ...outcome,
          durationMs: Date.now() - started,
        },
      );
    } catch {
      /* Isolate custom loggers too. */
    }
    return result;
  } catch (error) {
    try {
      logger.log('error', kind === 'outbox' ? 'queue.enqueue_failed' : 'job.failed', {
        ...fields,
        error,
        durationMs: Date.now() - started,
      });
    } catch {
      /* Preserve original exception. */
    }
    throw error;
  }
}
