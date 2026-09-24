import { randomUUID } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import {
  StructuredLogger,
  sanitizeLogValue,
  safeError,
  observeOperation,
} from '../../packages/observability/src/index.js';

const sentinel = ['LOG', 'REDACTION', 'SENTINEL', 'DO_NOT_USE'].join('_');

it('redacts sensitive keys recursively in objects and arrays while preserving safe references', () => {
  const keys = [
    'password',
    'accessKey',
    'bearerToken',
    'secret',
    'apiKey',
    'api_key',
    'accessToken',
    'access_token',
    'refreshToken',
    'refresh_token',
    'clientSecret',
    'client_secret',
    'authorization',
    'Authorization',
    'cookie',
    'Cookie',
    'set-cookie',
    'session',
    'sessionToken',
    'csrfToken',
    'signedUrl',
    'signedURL',
    'presignedURL',
    'storageState',
    'credentials',
    'headers',
    'body',
    'payloadJson',
    'prompt',
    'env',
  ];
  const input = {
    nested: [{ config: Object.fromEntries(keys.map((key) => [key, sentinel])) }],
    operationId: randomUUID(),
    provider: 'YOUTUBE',
    credentialRef: 'youtube-primary',
    secretRef: 'capture-profile',
  };
  const safe = sanitizeLogValue(input);
  expect(JSON.stringify(safe)).not.toContain(sentinel);
  expect(safe).toMatchObject({
    operationId: input.operationId,
    provider: 'YOUTUBE',
    credentialRef: 'youtube-primary',
    secretRef: 'capture-profile',
  });
  for (const key of keys) {
    expect(sanitizeLogValue({ nested: [{ [key]: sentinel }] })).toEqual({
      nested: [{ [key]: '[REDACTED]' }],
    });
  }
});

it('drops complete URLs and authorization text, including query, fragment and userinfo', () => {
  for (const value of [
    `https://user:${sentinel}@example.test/a?X-Amz-Signature=${sentinel}#${sentinel}`,
    `https://example.test/${sentinel}`,
    `Bearer ${sentinel}`,
    `request failed at https://example.test/?token=${sentinel}`,
  ]) {
    expect(sanitizeLogValue({ value })).toEqual({ value: '[REDACTED]' });
  }
});

it('projects errors without messages, stack, causes, getters or SDK metadata', () => {
  const error = Object.assign(new Error(sentinel, { cause: new Error(sentinel) }), {
    name: sentinel,
    config: { headers: { authorization: sentinel } },
  });
  expect(safeError(error)).toEqual({ name: 'Error', errorCode: 'UNKNOWN_ERROR' });
  expect(safeError(new Error('STALE_LEASE')).errorCode).toBe('STALE_LEASE');
  expect(safeError({ code: 'AUTH_REQUIRED', message: sentinel }).errorCode).toBe('AUTH_REQUIRED');
  expect(JSON.stringify(sanitizeLogValue([error]))).not.toContain(sentinel);
});

it('bounds cycles, arrays, depth, strings and binary values without invoking user code', () => {
  const getter = vi.fn(() => {
    throw new Error(sentinel);
  });
  const value: Record<string, unknown> = {
    count: 12n,
    date: new Date('2026-09-24T00:00:00Z'),
    ignored: undefined,
    fn: () => sentinel,
    binary: Buffer.from(sentinel),
    toJSON: getter,
  };
  value.self = value;
  Object.defineProperty(value, 'danger', { get: getter, enumerable: true });
  const result = sanitizeLogValue(value);
  expect(result).toMatchObject({
    count: '12',
    date: '2026-09-24T00:00:00.000Z',
    self: '[CIRCULAR]',
    binary: '[BINARY]',
    danger: '[ACCESSOR]',
  });
  expect(getter).not.toHaveBeenCalled();
  expect(JSON.stringify(result)).not.toContain(sentinel);
  expect(
    JSON.stringify(sanitizeLogValue(Array(10000).fill('x'.repeat(10000)))).length,
  ).toBeLessThan(1024);
  expect(() =>
    JSON.stringify(sanitizeLogValue(new Proxy({}, { getPrototypeOf: getter }))),
  ).not.toThrow();
});

it('writes bounded JSON lines, validates operational fields, and never emits arbitrary payloads', () => {
  const lines: string[] = [];
  const logger = new StructuredLogger('worker-ai', (line) => lines.push(line));
  const operationId = randomUUID();
  logger.log('info', 'job.completed', {
    operationId,
    provider: 'FAKE',
    durationMs: 123,
    status: 'SUCCEEDED',
    error: new Error(sentinel),
    body: sentinel,
    accessToken: sentinel,
  } as never);
  logger.log('debug', 'job.completed');
  expect(lines).toHaveLength(1);
  expect(JSON.parse(lines[0]!)).toMatchObject({
    level: 'info',
    event: 'job.completed',
    component: 'worker-ai',
    operationId,
    provider: 'FAKE',
    durationMs: 123,
    status: 'SUCCEEDED',
  });
  expect(JSON.parse(lines[0]!).timestamp).toMatch(/^\d{4}-/);
  expect(lines.join('')).not.toContain(sentinel);
  logger.log('error', 'job.failed', {
    operationId: sentinel,
    provider: sentinel,
    errorCode: sentinel,
  });
  expect(lines.join('')).not.toContain(sentinel);
});

it('keeps stdout/stderr routing and logging failures independent from business results', async () => {
  const info = vi.spyOn(console, 'log').mockImplementation(() => {});
  const error = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const logger = new StructuredLogger('control');
    logger.log('info', 'queue.enqueued');
    logger.log('warn', 'queue.enqueue_failed');
    expect(info).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledTimes(1);
    const broken = new StructuredLogger('worker-ai', () => {
      throw new Error(sentinel);
    });
    const result = { kind: 'SUCCEEDED', payload: sentinel };
    await expect(observeOperation(broken, {}, async () => result)).resolves.toBe(result);
    const original = new Error(sentinel);
    await expect(
      observeOperation(broken, {}, async () => {
        throw original;
      }),
    ).rejects.toBe(original);
    const hostile = new Proxy(
      {},
      {
        getOwnPropertyDescriptor() {
          throw original;
        },
      },
    );
    expect(() => broken.log('error', 'runtime.failed', hostile)).not.toThrow();
  } finally {
    info.mockRestore();
    error.mockRestore();
  }
});
