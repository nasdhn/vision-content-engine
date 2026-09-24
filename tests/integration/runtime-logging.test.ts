import { randomUUID } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { createApi } from '../../apps/api/src/app.js';
import { StructuredLogger } from '../../packages/observability/src/index.js';
import { AnalyticsWorkerOrchestrator } from '../../apps/worker-analytics/src/index.js';
import { StaticAnalyticsCollectorRegistry } from '../../packages/analytics/src/index.js';
import { Persistence } from '../../packages/database/src/index.js';
import {
  EnvironmentSecretResolver,
  accountCredentialResolver,
} from '../../packages/shared/src/secrets.js';
import { BullMqPublishTransport } from '../../apps/control/src/index.js';

const sentinel = ['LOG', 'RUNTIME', 'SENTINEL', 'DO_NOT_USE'].join('_');

it('logs an API auth failure without request keys, headers, cookies or query', async () => {
  const lines: string[] = [];
  const origin = 'http://localhost:5174';
  const app = await createApi(
    { postgres: async () => {}, redis: async () => {}, storage: async () => {} },
    { auth: { accessKey: 'valid-local-key-'.repeat(4), origin } },
    new StructuredLogger('api', (line) => lines.push(line)),
  );
  try {
    await app.listen(0, '127.0.0.1');
    const response = await fetch(`${await app.getUrl()}/api/session?token=${sentinel}`, {
      method: 'POST',
      headers: {
        Origin: origin,
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sentinel}`,
        Cookie: `fixture=${sentinel}`,
      },
      body: JSON.stringify({ accessKey: sentinel.repeat(2) }),
    });
    expect(response.status).toBe(401);
    await response.text();
    expect(lines.map((line) => JSON.parse(line))).toContainEqual(
      expect.objectContaining({
        component: 'api',
        event: 'auth.login_failed',
        errorCode: 'AUTH_FAILED',
        statusCode: 401,
        durationMs: expect.any(Number),
      }),
    );
    expect(lines.join('')).not.toContain(sentinel);
  } finally {
    await app.close();
  }
});

it('correlates a worker/provider failure while preserving the original failure and transaction count', async () => {
  const output = vi.spyOn(console, 'error').mockImplementation(() => {});
  const failure = Object.assign(new Error(sentinel), { credentials: { accessToken: sentinel } });
  const transaction = vi
    .spyOn(Persistence.prototype, 'transaction')
    .mockResolvedValue({ kind: 'READY', snapshot: {} });
  const credentials = accountCredentialResolver(
    new EnvironmentSecretResolver({ YOUTUBE_ACCESS_TOKEN: sentinel }, ['YOUTUBE_ACCESS_TOKEN']),
    'YOUTUBE_ACCESS_TOKEN',
    'fixture-account',
  );
  const collect = vi.fn(async () => {
    expect((await credentials.resolve('fixture-account')).accessToken).toBe(sentinel);
    throw failure;
  });
  const worker = new AnalyticsWorkerOrchestrator(
    {} as never,
    new StaticAnalyticsCollectorRegistry([{ platform: 'YOUTUBE', isRealProvider: false, collect }]),
    { realProvidersEnabled: false },
  );
  const job = {
    schemaVersion: 'v1',
    kind: 'COLLECT_PLATFORM_METRICS',
    outboxEventId: randomUUID(),
    workflowRunId: randomUUID(),
    jobAttemptId: randomUUID(),
    publicationId: randomUUID(),
    platformAccountId: randomUUID(),
    platform: 'YOUTUBE',
    adapterKey: 'YOUTUBE_ANALYTICS_V1',
    windowKey: 'T_PLUS_24H',
    collectionOperationId: randomUUID(),
    scheduledFor: '2026-09-24T00:00:00Z',
  };
  try {
    await expect(worker.process(job)).rejects.toBe(failure);
    expect(collect).toHaveBeenCalledTimes(1);
    expect(transaction).toHaveBeenCalledTimes(1);
    const lines = output.mock.calls.map(([line]) => String(line));
    expect(lines.map((line) => JSON.parse(line))).toContainEqual(
      expect.objectContaining({
        component: 'worker-analytics',
        event: 'job.failed',
        collectionOperationId: job.collectionOperationId,
        workflowRunId: job.workflowRunId,
        jobAttemptId: job.jobAttemptId,
        publicationId: job.publicationId,
        error: { name: 'Error', errorCode: 'UNKNOWN_ERROR' },
      }),
    );
    expect(lines.join('')).not.toContain(sentinel);
  } finally {
    transaction.mockRestore();
    output.mockRestore();
  }
});

it('logs control enqueue failures with canonical operation and Outbox IDs, without serializing the job', async () => {
  const output = vi.spyOn(console, 'error').mockImplementation(() => {});
  const failure = new Error(sentinel);
  const add = vi.fn(async () => {
    throw failure;
  });
  const transport = new BullMqPublishTransport({ add, on: vi.fn() } as never);
  const job = {
    kind: 'PUBLISH' as const,
    outboxEventId: randomUUID(),
    operationId: randomUUID(),
    publicationId: randomUUID(),
    publicationAttemptId: randomUUID(),
  };
  try {
    await expect(transport.enqueue(job)).rejects.toBe(failure);
    expect(add).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(output.mock.calls[0]![0]))).toMatchObject({
      component: 'control',
      event: 'queue.enqueue_failed',
      operationId: job.operationId,
      outboxEventId: job.outboxEventId,
    });
    expect(JSON.stringify(output.mock.calls)).not.toContain(sentinel);
  } finally {
    output.mockRestore();
  }
});
