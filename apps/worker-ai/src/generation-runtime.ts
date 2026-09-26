import {
  AIProviderGateway,
  GROQ_GPT_OSS_120B_MODEL,
  GROQ_PROVIDER_ID,
  GroqStructuredProvider,
} from '@vision/ai';
import { AIContentService } from '@vision/application';
import { InvocationRepository } from '@vision/database';
import type { PrismaClient } from '@vision/database';
import { StructuredLogger } from '@vision/observability';
import { groqApiKeyProvider, isRealProviderActivationEnabled } from '@vision/shared';
import type { RuntimeConfig, SecretResolver } from '@vision/shared';

export type AIGenerationRuntimeInput = Readonly<{
  db: PrismaClient;
  config: RuntimeConfig;
  secrets: SecretResolver;
  fetchImpl?: typeof fetch;
  logger?: StructuredLogger;
}>;

export type AIGenerationRuntimeComposition = Readonly<{
  provider: GroqStructuredProvider;
  gateway: AIProviderGateway;
  service: AIContentService;
}>;

export function createAIGenerationRuntime(
  input: AIGenerationRuntimeInput,
): AIGenerationRuntimeComposition {
  const provider = new GroqStructuredProvider(
    groqApiKeyProvider(input.secrets),
    input.fetchImpl ?? globalThis.fetch,
  );

  const gateway = new AIProviderGateway(
    new InvocationRepository(input.db),
    [provider],
    () => input.config.PAUSE_AI_GENERATION,
    input.logger ?? new StructuredLogger('worker-ai'),
    () => isRealProviderActivationEnabled(input.config),
  );

  return {
    provider,
    gateway,
    service: new AIContentService(input.db, gateway),
  };
}

export const AI_GENERATION_PROVIDER = Object.freeze({
  provider: GROQ_PROVIDER_ID,
  model: GROQ_GPT_OSS_120B_MODEL,
});
