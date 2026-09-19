import { expect, it } from 'vitest';
import {
  assertHuman,
  assertPublicationRetry,
  assertTransition,
  leaseConfig,
  parseInstant,
} from '../../packages/domain/src/index.js';
it('requires human actors for both gates', () => {
  expect(() => assertHuman({ actorType: 'SYSTEM', actorId: 'system' })).toThrow(
    'HUMAN_APPROVAL_REQUIRED',
  );
  expect(() => assertHuman({ actorType: 'USER' })).toThrow('HUMAN_APPROVAL_REQUIRED');
  expect(() => assertHuman({ actorType: 'USER', actorId: 'reviewer' })).not.toThrow();
});
it('rejects terminal resurrection and skipped workflow states', () => {
  for (const state of ['SUCCEEDED', 'FAILED', 'CANCELLED'])
    expect(() => assertTransition('workflow', state, 'RUNNING')).toThrow('INVALID_TRANSITION');
  expect(() => assertTransition('workflow', 'PENDING', 'SUCCEEDED')).toThrow('INVALID_TRANSITION');
  expect(() => assertTransition('render', 'REQUESTED', 'APPROVED')).toThrow('INVALID_TRANSITION');
  expect(() => assertTransition('workflow', 'WAITING', 'RUNNING')).not.toThrow();
  expect(() => assertTransition('job', 'SUCCEEDED', 'RUNNING')).toThrow('INVALID_TRANSITION');
  expect(() => assertTransition('outbox', 'DISPATCHED', 'DISPATCHING')).toThrow(
    'INVALID_TRANSITION',
  );
});
it('keeps ambiguous publishing effects behind reconciliation', () => {
  expect(() => assertPublicationRetry('PUBLISHING_UNKNOWN', false)).toThrow(
    'RECONCILIATION_REQUIRED',
  );
  expect(() => assertPublicationRetry('PUBLISHING_UNKNOWN', true)).not.toThrow();
});
it('normalizes offset timestamps to UTC and rejects offset-free input', () => {
  expect(parseInstant('2026-09-19T13:00:00+02:00').toISOString()).toBe('2026-09-19T11:00:00.000Z');
  expect(() => parseInstant('2026-09-19T13:00:00')).toThrow('OFFSET_REQUIRED');
  expect(() => parseInstant('badTbadZ')).toThrow('INVALID_INSTANT');
});
it('validates configuration without a normative lease duration', () => {
  expect(leaseConfig({ durationMs: 1000, heartbeatIntervalMs: 100 })).toEqual({
    durationMs: 1000,
    heartbeatIntervalMs: 100,
  });
  expect(() => leaseConfig({ durationMs: 0, heartbeatIntervalMs: 1 })).toThrow();
  expect(() => leaseConfig({ durationMs: 100, heartbeatIntervalMs: 100 })).toThrow();
});
