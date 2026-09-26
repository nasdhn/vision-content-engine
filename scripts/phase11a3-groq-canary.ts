import 'dotenv/config';

import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';

import {
  AIProviderGateway,
  GROQ_GPT_OSS_120B_MODEL,
  GROQ_PROVIDER_ID,
  GroqStructuredProvider,
  getPrompt,
  type ModelPolicy,
  type ProviderRequest,
  validateCreator,
} from '../packages/ai/src/index.js';

import {
  BrandKnowledgeSnapshotSchema,
  CreatorInputSchema,
  CreatorOutputSchema,
} from '../packages/contracts/src/index.js';

import {
  createDatabaseClient,
  InvocationRepository,
  KnowledgePayloadSchema,
} from '../packages/database/src/index.js';

import {
  EnvironmentSecretResolver,
  groqApiKeyProvider,
  isRealProviderActivationEnabled,
  parseConfig,
} from '../packages/shared/src/index.js';

const CANARY_KNOWLEDGE_KEY = 'phase11-ai-canary';
const CANARY_PURPOSE = 'phase11a3-groq-canary';

const EXECUTION_CONFIRMATION = 'EXECUTE_ONE_GROQ_CALL';

const HARD_LIMIT_USD = 0.01;
const MAX_INPUT_TOKENS = 20_000;
const MAX_OUTPUT_TOKENS = 1_024;
const TIMEOUT_MS = 30_000;

function mode() {
  const args = process.argv.slice(2);

  if (args.length === 0 || (args.length === 1 && args[0] === '--dry-run')) {
    return 'DRY_RUN' as const;
  }

  if (args.length === 1 && args[0] === '--execute') {
    return 'EXECUTE' as const;
  }

  throw new Error('CANARY_USAGE_INVALID');
}

function assertPersistentDefaultsSafe() {
  const config = parseConfig(process.env);

  if (
    config.VCE_ENV !== 'LOCAL' ||
    config.VCE_REAL_PROVIDERS_ENABLED !== 'false' ||
    !config.PAUSE_AI_GENERATION
  ) {
    throw new Error('CANARY_PERSISTENT_DEFAULTS_UNSAFE');
  }

  return config;
}

async function assertExecutionAuthorized() {
  if (process.env.AI_CANARY_CONFIRM !== EXECUTION_CONFIRMATION) {
    throw new Error('CANARY_EXECUTION_CONFIRMATION_REQUIRED');
  }

  const dotenv = await readFile(new URL('../.env', import.meta.url), 'utf8');

  if (/^GROQ_API_KEY\s*=/m.test(dotenv)) {
    throw new Error('CANARY_GROQ_KEY_MUST_NOT_BE_STORED_IN_DOTENV');
  }

  if (typeof process.env.GROQ_API_KEY !== 'string' || !process.env.GROQ_API_KEY.trim()) {
    throw new Error('CANARY_GROQ_API_KEY_REQUIRED_IN_SHELL');
  }
}

function activationConfig() {
  const config = parseConfig({
    ...process.env,

    // Ephemeral activation only for this dedicated process.
    // The persisted .env stays LOCAL / paused / providers disabled.
    VCE_ENV: 'STAGING_CAPTURE',
    VCE_REAL_PROVIDERS_ENABLED: 'true',
    PAUSE_AI_GENERATION: 'false',
  });

  if (!isRealProviderActivationEnabled(config) || config.PAUSE_AI_GENERATION) {
    throw new Error('CANARY_EPHEMERAL_ACTIVATION_FAILED');
  }

  return config;
}

async function main() {
  const runMode = mode();

  assertPersistentDefaultsSafe();

  if (runMode === 'EXECUTE') {
    await assertExecutionAuthorized();
  }

  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error('DATABASE_URL_REQUIRED');
  }

  const db = createDatabaseClient(databaseUrl);

  try {
    const snapshotRow = await db.knowledgeSnapshot.findFirst({
      where: {
        key: CANARY_KNOWLEDGE_KEY,
        status: 'ACTIVE',
        effectiveAt: {
          lte: new Date(),
        },
      },
      orderBy: {
        version: 'desc',
      },
    });

    if (!snapshotRow) {
      throw new Error('AI_CANARY_KNOWLEDGE_REQUIRED');
    }

    const knowledge = BrandKnowledgeSnapshotSchema.parse({
      ...KnowledgePayloadSchema.parse(snapshotRow.payloadJson),

      id: snapshotRow.id,
      key: snapshotRow.key,
      version: snapshotRow.version,
      contentHash: snapshotRow.contentHash,
      effectiveAt: snapshotRow.effectiveAt.toISOString(),
    });

    const patternVersionId = randomUUID();

    const input = CreatorInputSchema.parse({
      briefVersion: {
        id: randomUUID(),

        payload: {
          objective: 'Valider techniquement une génération structurée minimale pour Vision.',
          constraints: [
            'Produire exactement un concept.',
            'Ne produire aucune affirmation factuelle.',
            'Ne produire aucune affirmation chiffrée.',
            'factualClaims doit rester vide.',
            'Ne pas écrire de chiffre dans les champs textuels.',
          ],
        },
      },

      ideas: [
        {
          id: randomUUID(),
          title: 'Canary technique Vision',
          description:
            'Concept synthétique sans chiffre et sans affirmation factuelle, destiné uniquement à vérifier la chaîne de génération.',
        },
      ],

      patternCandidates: [
        {
          patternVersionId,
          name: 'CANARY_TECHNIQUE',
          description: 'Pattern synthétique minimal réservé à la validation technique du provider.',
          whenToUse: 'Uniquement pendant le canary technique de génération.',
          hookStructure: {
            mode: 'simple',
          },
          storyStructure: {
            mode: 'single-concept',
          },
          visualStructure: {
            mode: 'green-screen',
          },
          ctaStyle: {
            mode: 'none',
          },
        },
      ],

      brandKnowledge: knowledge,

      contentMemory: [],

      generationConstraints: {
        requestedConceptCount: 1,

        targetPlatforms: ['TIKTOK'],

        allowedPrimaryFormats: ['GREEN_SCREEN_EXPLAINER'],

        diversity: {
          maxSamePatternCount: 1,
          maxSameAngleCount: 1,
        },

        explorationPolicy: {
          mode: 'BALANCED',
          notes:
            'Canary technique uniquement. Aucun chiffre ni affirmation factuelle dans le contenu.',
        },
      },
    });

    const requestId = randomUUID();
    const prompt = getPrompt('creator', '1.0.0');

    const providerRequest: ProviderRequest = {
      envelope: {
        requestId,
        capability: 'CREATOR',
        purpose: CANARY_PURPOSE,
        locale: 'fr-FR',

        prompt: {
          key: prompt.key,
          version: prompt.version,
          contentHash: prompt.contentHash,
        },

        contracts: {
          inputSchemaVersion: prompt.schemaVersion,
          outputSchemaVersion: prompt.schemaVersion,
        },

        knowledgeSnapshot: {
          id: knowledge.id,
          version: knowledge.version,
          contentHash: knowledge.contentHash,
        },

        input,
      },

      promptContent: prompt.content,

      maxOutputTokens: MAX_OUTPUT_TOKENS,

      outputSchema: z.toJSONSchema(CreatorOutputSchema),

      reasoningLevel: 'low',
    };

    let drySecretResolved = false;
    let dryNetworkCalled = false;

    const dryProvider = new GroqStructuredProvider(
      () => {
        drySecretResolved = true;
        throw new Error('CANARY_DRY_SECRET_FORBIDDEN');
      },

      (async () => {
        dryNetworkCalled = true;
        throw new Error('CANARY_DRY_NETWORK_FORBIDDEN');
      }) as typeof fetch,
    );

    const quote = dryProvider.estimate(providerRequest);

    if (drySecretResolved || dryNetworkCalled) {
      throw new Error('CANARY_DRY_SIDE_EFFECT_DETECTED');
    }

    if (quote.currency !== 'USD') {
      throw new Error('CANARY_CURRENCY_MUST_BE_USD');
    }

    if (quote.inputTokens > MAX_INPUT_TOKENS) {
      throw new Error(`CANARY_INPUT_LIMIT_EXCEEDED:${quote.inputTokens}`);
    }

    if (Number(quote.maxCost) > HARD_LIMIT_USD) {
      throw new Error(`CANARY_ESTIMATE_EXCEEDS_HARD_LIMIT:${quote.maxCost}`);
    }

    console.log('===== PHASE 11A-3 CANARY ENVELOPE =====');
    console.log(`mode=${runMode}`);
    console.log(`requestId=${requestId}`);
    console.log(`knowledge.id=${knowledge.id}`);
    console.log(`knowledge.key=${knowledge.key}`);
    console.log(`knowledge.version=${knowledge.version}`);
    console.log(`provider=${GROQ_PROVIDER_ID}`);
    console.log(`model=${GROQ_GPT_OSS_120B_MODEL}`);
    console.log('reasoningLevel=low');
    console.log(`maxInputTokens=${MAX_INPUT_TOKENS}`);
    console.log(`maxOutputTokens=${MAX_OUTPUT_TOKENS}`);
    console.log(`estimatedInputTokens=${quote.inputTokens}`);
    console.log(`estimatedMaxCostUsd=${quote.maxCost}`);
    console.log(`hardLimitUsd=${HARD_LIMIT_USD.toFixed(8)}`);

    if (runMode === 'DRY_RUN') {
      console.log('credentialResolved=false');
      console.log('networkCalled=false');
      console.log('PASS: Phase 11A-3 harness dry-run completed with zero provider calls.');

      return;
    }

    const config = activationConfig();

    const secrets = new EnvironmentSecretResolver(process.env, ['GROQ_API_KEY']);

    const provider = new GroqStructuredProvider(groqApiKeyProvider(secrets));

    const gateway = new AIProviderGateway(
      new InvocationRepository(db),

      [provider],

      () => config.PAUSE_AI_GENERATION,

      undefined,

      () => isRealProviderActivationEnabled(config),
    );

    const policy: ModelPolicy = {
      capability: 'CREATOR',

      preferredProvider: GROQ_PROVIDER_ID,
      preferredModel: GROQ_GPT_OSS_120B_MODEL,

      reasoningLevel: 'low',

      maxAttempts: 1,
      timeoutMs: TIMEOUT_MS,

      fallbackPolicy: 'NONE',

      maxInputTokens: MAX_INPUT_TOKENS,
      maxOutputTokens: MAX_OUTPUT_TOKENS,

      // Absolute reservation ceiling. The provider estimate must also fit it.
      maxEstimatedCost: HARD_LIMIT_USD,
    };

    const now = Date.now();

    const budget = {
      key: `phase11a3:${requestId}`,

      from: new Date(now - 60_000).toISOString(),
      to: new Date(now + 10 * 60_000).toISOString(),

      limit: HARD_LIMIT_USD.toFixed(8),
      currency: 'USD',
    };

    let gatewayError: unknown = null;
    let result: Awaited<ReturnType<typeof gateway.generateStructured>> | undefined;

    try {
      result = await gateway.generateStructured(
        {
          requestId,

          capability: 'CREATOR',

          purpose: CANARY_PURPOSE,

          prompt: {
            key: 'creator',
            version: '1.0.0',
          },

          knowledgeSnapshot: {
            id: knowledge.id,
            version: knowledge.version,
            contentHash: knowledge.contentHash,
          },

          input,
        },

        {
          input: CreatorInputSchema,
          output: CreatorOutputSchema,

          validate: (validatedInput, output) =>
            validateCreator(validatedInput, output, {
              minDurationSec: 5,
              maxDurationSec: 60,
              recentHooks: [],
              now: new Date(),
            }),
        },

        policy,

        budget,
      );
    } catch (error) {
      gatewayError = error;
    }

    const invocation = await db.modelInvocation.findUnique({
      where: {
        id: requestId,
      },

      include: {
        attempts: {
          orderBy: {
            attemptNumber: 'asc',
          },
        },

        costEntries: {
          orderBy: {
            occurredAt: 'asc',
          },
        },
      },
    });

    if (!invocation) {
      throw gatewayError ?? new Error('CANARY_INVOCATION_NOT_PERSISTED');
    }

    console.log('');
    console.log('===== DURABLE CANARY EVIDENCE =====');

    console.log(`invocation.id=${invocation.id}`);
    console.log(`invocation.status=${invocation.status}`);
    console.log(`invocation.attemptCount=${invocation.attemptCount}`);

    for (const attempt of invocation.attempts) {
      console.log(`attempt.number=${attempt.attemptNumber}`);
      console.log(`attempt.status=${attempt.status}`);
      console.log(`attempt.provider=${attempt.provider}`);
      console.log(`attempt.model=${attempt.model}`);

      console.log(`attempt.inputTokens=${attempt.inputTokens ?? 'UNKNOWN'}`);

      console.log(`attempt.outputTokens=${attempt.outputTokens ?? 'UNKNOWN'}`);

      console.log(`attempt.cachedInputTokens=${attempt.cachedInputTokens ?? 'UNKNOWN'}`);

      console.log(`attempt.costAmount=${attempt.costAmount?.toString() ?? 'UNKNOWN'}`);

      console.log(`attempt.costCurrency=${attempt.costCurrency}`);

      if (attempt.failureCode) {
        console.log(`attempt.failureCode=${attempt.failureCode}`);
      }
    }

    for (const cost of invocation.costEntries) {
      console.log(`cost.provider=${cost.provider ?? 'UNKNOWN'}`);
      console.log(`cost.amount=${cost.amount.toString()}`);
      console.log(`cost.currency=${cost.currency}`);
    }

    const linkedConceptVersions = await db.conceptVersion.count({
      where: {
        creatorModelInvocationId: requestId,
      },
    });

    console.log(`linkedConceptVersions=${linkedConceptVersions}`);

    if (linkedConceptVersions !== 0) {
      throw new Error('CANARY_CREATED_BUSINESS_CONCEPT');
    }

    if (invocation.attempts.length !== 1) {
      throw new Error('CANARY_MUST_HAVE_EXACTLY_ONE_ATTEMPT');
    }

    if (gatewayError) {
      throw gatewayError;
    }

    if (!result) {
      throw new Error('CANARY_RESULT_MISSING');
    }

    if (invocation.status !== 'SUCCEEDED') {
      throw new Error('CANARY_INVOCATION_NOT_SUCCEEDED');
    }

    const attempt = invocation.attempts[0]!;

    if (attempt.provider !== GROQ_PROVIDER_ID || attempt.model !== GROQ_GPT_OSS_120B_MODEL) {
      throw new Error('CANARY_PROVIDER_OR_MODEL_MISMATCH');
    }

    if (attempt.costAmount === null || attempt.costCurrency !== 'USD') {
      throw new Error('CANARY_ACTUAL_COST_MISSING');
    }

    if (Number(attempt.costAmount.toString()) > HARD_LIMIT_USD) {
      throw new Error('CANARY_ACTUAL_COST_EXCEEDS_HARD_LIMIT');
    }

    if (invocation.costEntries.length !== 1) {
      throw new Error('CANARY_COST_ENTRY_REQUIRED');
    }

    console.log('');
    console.log(`modelInvocationId=${result.modelInvocationId}`);

    console.log('PASS: Phase 11A-3 completed one bounded real Groq invocation.');
  } finally {
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(
    `PHASE_11A3_CANARY_FAILED:${error instanceof Error ? error.message : 'UNKNOWN_ERROR'}`,
  );

  process.exitCode = 1;
});
