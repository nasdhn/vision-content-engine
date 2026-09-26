import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { GROQ_GPT_OSS_120B_MODEL, GROQ_PROVIDER_ID } from '../../packages/ai/src/index.js';
import { AIContentService } from '../../packages/application/src/index.js';
import { CreatorInputSchema, CreatorOutputSchema } from '../../packages/contracts/src/index.js';
import type { PrismaClient } from '../../packages/database/src/index.js';
import { parseConfig, type SecretResolver } from '../../packages/shared/src/index.js';

import { createAIGenerationRuntime } from '../../apps/worker-ai/src/generation-runtime.js';

import creatorFixture from '../fixtures/phase2/creator-input.json' with { type: 'json' };
import { configFixture } from '../support/config.js';

function forbiddenDatabase() {
  let touches = 0;

  const db = new Proxy(
    {},
    {
      get() {
        touches += 1;
        throw new Error('UNIT_DATABASE_ACCESS_FORBIDDEN');
      },
    },
  ) as PrismaClient;

  return {
    db,
    touches: () => touches,
  };
}

function forbiddenSecrets() {
  let reads = 0;

  const secrets: SecretResolver = {
    resolve() {
      reads += 1;
      throw new Error('UNIT_SECRET_ACCESS_FORBIDDEN');
    },
  };

  return {
    secrets,
    reads: () => reads,
  };
}

function forbiddenNetwork() {
  let calls = 0;

  const fetchImpl = (async () => {
    calls += 1;
    throw new Error('UNIT_NETWORK_ACCESS_FORBIDDEN');
  }) as typeof fetch;

  return {
    fetchImpl,
    calls: () => calls,
  };
}

describe('Phase 11A-4A AI generation runtime composition', () => {
  it('constructs Groq -> gateway -> AIContentService with zero side effects', () => {
    const config = parseConfig(configFixture);

    const database = forbiddenDatabase();
    const secret = forbiddenSecrets();
    const network = forbiddenNetwork();

    const runtime = createAIGenerationRuntime({
      db: database.db,
      config,
      secrets: secret.secrets,
      fetchImpl: network.fetchImpl,
    });

    expect(config.VCE_ENV).toBe('LOCAL');
    expect(config.VCE_REAL_PROVIDERS_ENABLED).toBe('false');
    expect(config.PAUSE_AI_GENERATION).toBe(true);

    expect(runtime.provider.kind).toBe('REAL');
    expect(runtime.provider.provider).toBe(GROQ_PROVIDER_ID);
    expect(runtime.provider.model).toBe(GROQ_GPT_OSS_120B_MODEL);

    expect(runtime.service).toBeInstanceOf(AIContentService);

    expect(database.touches()).toBe(0);
    expect(secret.reads()).toBe(0);
    expect(network.calls()).toBe(0);
  });

  it('rejects default LOCAL execution at the pause barrier before DB, secret or network access', async () => {
    const config = parseConfig(configFixture);

    const database = forbiddenDatabase();
    const secret = forbiddenSecrets();
    const network = forbiddenNetwork();

    const runtime = createAIGenerationRuntime({
      db: database.db,
      config,
      secrets: secret.secrets,
      fetchImpl: network.fetchImpl,
    });

    const input = CreatorInputSchema.parse(structuredClone(creatorFixture));

    await expect(
      runtime.gateway.generateStructured(
        {
          requestId: randomUUID(),
          capability: 'CREATOR',
          purpose: 'phase11a4a-local-fail-closed',

          prompt: {
            key: 'creator',
            version: '1.0.0',
          },

          knowledgeSnapshot: {
            id: input.brandKnowledge.id,
            version: input.brandKnowledge.version,
            contentHash: input.brandKnowledge.contentHash,
          },

          input,
        },

        {
          input: CreatorInputSchema,
          output: CreatorOutputSchema,
          validate: () => {},
        },

        {
          capability: 'CREATOR',

          preferredProvider: GROQ_PROVIDER_ID,
          preferredModel: GROQ_GPT_OSS_120B_MODEL,

          reasoningLevel: 'low',

          maxAttempts: 1,
          timeoutMs: 1_000,

          fallbackPolicy: 'NONE',

          maxInputTokens: 20_000,
          maxOutputTokens: 1_024,

          maxEstimatedCost: 0.01,
        },

        {
          key: 'phase11a4a-unit-budget',

          from: '2020-01-01T00:00:00.000Z',
          to: '2100-01-01T00:00:00.000Z',

          limit: '0.01000000',
          currency: 'USD',
        },
      ),
    ).rejects.toThrow('AI_GENERATION_PAUSED');

    expect(database.touches()).toBe(0);
    expect(secret.reads()).toBe(0);
    expect(network.calls()).toBe(0);
  });

  it('rejects a non-LOCAL unpaused real provider while the activation gate remains disabled', async () => {
    const config = parseConfig({
      ...configFixture,
      VCE_ENV: 'STAGING_CAPTURE',
      VCE_REAL_PROVIDERS_ENABLED: 'false',
      PAUSE_AI_GENERATION: 'false',
    });

    const database = forbiddenDatabase();
    const secret = forbiddenSecrets();
    const network = forbiddenNetwork();

    const runtime = createAIGenerationRuntime({
      db: database.db,
      config,
      secrets: secret.secrets,
      fetchImpl: network.fetchImpl,
    });

    const input = CreatorInputSchema.parse(structuredClone(creatorFixture));

    await expect(
      runtime.gateway.generateStructured(
        {
          requestId: randomUUID(),
          capability: 'CREATOR',
          purpose: 'phase11a4a-real-provider-disabled',

          prompt: {
            key: 'creator',
            version: '1.0.0',
          },

          knowledgeSnapshot: {
            id: input.brandKnowledge.id,
            version: input.brandKnowledge.version,
            contentHash: input.brandKnowledge.contentHash,
          },

          input,
        },

        {
          input: CreatorInputSchema,
          output: CreatorOutputSchema,
          validate: () => {},
        },

        {
          capability: 'CREATOR',

          preferredProvider: GROQ_PROVIDER_ID,
          preferredModel: GROQ_GPT_OSS_120B_MODEL,

          reasoningLevel: 'low',

          maxAttempts: 1,
          timeoutMs: 1_000,

          fallbackPolicy: 'NONE',

          maxInputTokens: 20_000,
          maxOutputTokens: 1_024,

          maxEstimatedCost: 0.01,
        },

        {
          key: 'phase11a4a-provider-gate-budget',

          from: '2020-01-01T00:00:00.000Z',
          to: '2100-01-01T00:00:00.000Z',

          limit: '0.01000000',
          currency: 'USD',
        },
      ),
    ).rejects.toThrow('REAL_PROVIDERS_DISABLED');

    expect(database.touches()).toBe(0);
    expect(secret.reads()).toBe(0);
    expect(network.calls()).toBe(0);
  });

  it('keeps secret and network lazy after explicit non-LOCAL activation at construction time', () => {
    const config = parseConfig({
      ...configFixture,

      VCE_ENV: 'STAGING_CAPTURE',
      VCE_REAL_PROVIDERS_ENABLED: 'true',
      PAUSE_AI_GENERATION: 'false',
    });

    const database = forbiddenDatabase();
    const secret = forbiddenSecrets();
    const network = forbiddenNetwork();

    const runtime = createAIGenerationRuntime({
      db: database.db,
      config,
      secrets: secret.secrets,
      fetchImpl: network.fetchImpl,
    });

    expect(config.VCE_ENV).toBe('STAGING_CAPTURE');
    expect(config.VCE_REAL_PROVIDERS_ENABLED).toBe('true');
    expect(config.PAUSE_AI_GENERATION).toBe(false);

    expect(runtime.provider.kind).toBe('REAL');

    expect(database.touches()).toBe(0);
    expect(secret.reads()).toBe(0);
    expect(network.calls()).toBe(0);
  });
});
