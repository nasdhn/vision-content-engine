import 'dotenv/config';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Queue } from 'bullmq';
import { BullMqWeeklyAnalysisTransport } from '../../apps/control/src/index.js';
import {
  WEEKLY_ANALYSIS_QUEUE_NAME,
  WeeklyAnalysisQueueJobSchema,
  weeklyAnalysisOperationKeyFor,
} from '../../packages/contracts/src/weekly-analysis.js';
import type {
  WeeklyAnalysisPlan,
  WeeklyAnalysisQueueJob,
} from '../../packages/contracts/src/weekly-analysis.js';

const redisUrl = new URL(process.env.REDIS_URL ?? '');
if (!['localhost', '127.0.0.1', '[::1]'].includes(redisUrl.hostname)) {
  throw new Error('BULLMQ_SMOKE_REQUIRES_LOCAL_REDIS');
}
const plan: WeeklyAnalysisPlan = {
  analysisWindow: { from: '2026-09-14T00:00:00.000Z', to: '2026-09-21T00:00:00.000Z' },
  measurementWindow: 'T_PLUS_24H',
  evidencePolicyVersion: 'EVIDENCE_POLICY_RUNTIME_V1',
  analystPromptVersion: '1.0.0',
  contextBuilderVersion: 'WEEKLY_ANALYSIS_CONTEXT_V1',
  knowledgeSnapshot: { id: randomUUID(), version: 1, contentHash: 'a'.repeat(64) },
  policy: {
    capability: 'ANALYST',
    maxAttempts: 1,
    timeoutMs: 1_000,
    fallbackPolicy: 'NONE',
    maxInputTokens: 10_000,
    maxOutputTokens: 1_000,
    maxEstimatedCost: 0.1,
  },
  budget: {
    key: 'learning-local-smoke',
    from: '2026-01-01T00:00:00.000Z',
    to: '2027-01-01T00:00:00.000Z',
    limit: '1.00000000',
    currency: 'EUR',
  },
};
const job = WeeklyAnalysisQueueJobSchema.parse({
  ...plan,
  schemaVersion: 'v1',
  kind: 'WEEKLY_ANALYSIS',
  outboxEventId: randomUUID(),
  workflowRunId: randomUUID(),
  jobAttemptId: randomUUID(),
  operationId: randomUUID(),
  analysisOperationKey: weeklyAnalysisOperationKeyFor(plan),
});
// An isolated queue exercises production transport without starting a worker/provider.
const queue = new Queue<WeeklyAnalysisQueueJob>(
  `${WEEKLY_ANALYSIS_QUEUE_NAME}-learning-smoke-${randomUUID()}`,
  {
    connection: {
      host: redisUrl.hostname,
      port: Number(redisUrl.port || 6379),
      ...(redisUrl.password ? { password: decodeURIComponent(redisUrl.password) } : {}),
    },
  },
);
const transport = new BullMqWeeklyAnalysisTransport(queue);
try {
  await transport.enqueue(job);
  await transport.enqueue(job);
  const stored = await queue.getJob(`outbox-${job.outboxEventId}`);
  assert.ok(stored, 'LEARNING_BULLMQ_JOB_NOT_FOUND');
  assert.deepEqual(WeeklyAnalysisQueueJobSchema.parse(stored.data), job);
  assert.equal(stored.name, 'WEEKLY_ANALYSIS');
  assert.equal((await queue.getWaiting()).length, 1, 'LEARNING_BULLMQ_DEDUPLICATION_FAILED');
  const restoredPlan = {
    analysisWindow: stored.data.analysisWindow,
    measurementWindow: stored.data.measurementWindow,
    evidencePolicyVersion: stored.data.evidencePolicyVersion,
    analystPromptVersion: stored.data.analystPromptVersion,
    contextBuilderVersion: stored.data.contextBuilderVersion,
    knowledgeSnapshot: stored.data.knowledgeSnapshot,
    policy: stored.data.policy,
    budget: stored.data.budget,
  };
  assert.equal(weeklyAnalysisOperationKeyFor(restoredPlan), job.analysisOperationKey);
  assert.equal(/credential|secret|authorization/i.test(JSON.stringify(stored.data)), false);
  assert.equal(
    WeeklyAnalysisQueueJobSchema.safeParse({ ...stored.data, credential: 'forbidden' }).success,
    false,
  );
  console.log(
    'PASS: Learning BullMQ preserves one secret-free job, frozen window and operation identity.',
  );
} finally {
  try {
    await queue.obliterate({ force: true });
  } finally {
    await transport.close();
  }
}
