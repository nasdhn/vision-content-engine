import { z } from 'zod';
import { ModelPolicySchema, BrandKnowledgeSnapshotSchema } from '@vision/contracts';
import { assertNoSecrets, canonicalJson, contentHash, textHash } from '@vision/contracts/canonical';
import { Prisma } from '@vision/database';
import type { Budget, InvocationRepository } from '@vision/database';
import { invariant } from '@vision/domain';
import { getPrompt } from './prompts.js';

export class AiFailure extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
export class ProviderFailure extends Error {
  constructor(
    readonly code: 'NETWORK' | 'PROVIDER_5XX' | 'RATE_LIMIT' | 'PERMANENT',
    readonly billable: boolean = true,
  ) {
    super(code);
  }
}
export type ProviderRequest = {
  envelope: {
    requestId: string;
    capability: string;
    purpose: string;
    locale: 'fr-FR';
    prompt: { key: string; version: string; contentHash: string };
    contracts: { inputSchemaVersion: string; outputSchemaVersion: string };
    knowledgeSnapshot: { id: string; version: number; contentHash: string };
    input: unknown;
  };
  promptContent: string;
  maxOutputTokens: number;
  outputSchema: unknown;
  reasoningLevel?: string;
  repair?: { instruction: string; errors: { code: string; path: string }[] };
};
const UsageSchema = z
  .object({
    inputTokens: z.number().int().nonnegative().optional(),
    outputTokens: z.number().int().nonnegative().optional(),
    cachedInputTokens: z.number().int().nonnegative().optional(),
    costAmount: z
      .string()
      .regex(/^\d+(?:\.\d{1,8})?$/)
      .optional(),
    currency: z.string().regex(/^[A-Z]{3}$/),
  })
  .strict();
export type ProviderReply = { body: string; usage?: z.infer<typeof UsageSchema> };
export interface StructuredProvider {
  readonly kind: 'FAKE';
  readonly provider: string;
  readonly model: string;
  estimate(request: ProviderRequest): { inputTokens: number; maxCost: string; currency: string };
  generate(request: ProviderRequest, signal: AbortSignal): Promise<ProviderReply>;
}
export type InvocationRequest<I> = {
  requestId: string;
  capability: 'CREATOR' | 'CREATIVE_DIRECTOR';
  purpose: string;
  prompt: { key: string; version: string };
  knowledgeSnapshot: { id: string; version: number; contentHash: string };
  input: I;
};
export type ModelPolicy = z.infer<typeof ModelPolicySchema>;
export type Validation<I, O> = {
  input: z.ZodType<I>;
  output: z.ZodType<O>;
  validate(input: I, output: O): void | Promise<void>;
};

async function deadline(provider: StructuredProvider, request: ProviderRequest, timeoutMs: number) {
  const controller = new globalThis.AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      provider.generate(structuredClone(request), controller.signal),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new AiFailure('TIMEOUT'));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
/** No real adapters in Phase 2. Every execution still traverses the production validation/DB path. */
export class AIProviderGateway {
  constructor(
    private readonly repository: InvocationRepository,
    private readonly providers: readonly StructuredProvider[],
    private readonly paused: () => boolean,
  ) {
    invariant(
      providers.length > 0 && providers.every((p) => p.kind === 'FAKE'),
      'REAL_PROVIDERS_DISABLED',
    );
  }
  async generateStructured<I, O>(
    request: InvocationRequest<I>,
    contracts: Validation<I, O>,
    inputPolicy: ModelPolicy,
    budget: Budget,
  ) {
    invariant(!this.paused(), 'AI_GENERATION_PAUSED');
    z.string().uuid().parse(request.requestId);
    const policy = ModelPolicySchema.parse(inputPolicy);
    assertNoSecrets({ purpose: request.purpose, policy, budget });
    invariant(policy.capability === request.capability, 'CAPABILITY_MISMATCH');
    invariant(
      policy.maxInputTokens &&
        policy.maxOutputTokens &&
        policy.maxEstimatedCost !== undefined &&
        policy.maxEstimatedCost >= 0,
      'BOUNDED_POLICY_REQUIRED',
    );
    const prompt = getPrompt(request.prompt.key, request.prompt.version);
    invariant(
      prompt.capability === request.capability && prompt.status === 'ACTIVE',
      'PROMPT_CAPABILITY_MISMATCH',
    );
    const input = contracts.input.parse(request.input);
    assertNoSecrets(input);
    const knowledge = BrandKnowledgeSnapshotSchema.parse(
      (input as Record<string, unknown>).brandKnowledge,
    );
    invariant(
      knowledge.id === request.knowledgeSnapshot.id &&
        knowledge.version === request.knowledgeSnapshot.version &&
        knowledge.contentHash === request.knowledgeSnapshot.contentHash,
      'KNOWLEDGE_CONTEXT_MISMATCH',
    );
    const choices = this.providers.filter(
      (p) =>
        (!policy.preferredProvider || p.provider === policy.preferredProvider) &&
        (!policy.preferredModel || p.model === policy.preferredModel),
    );
    invariant(choices.length > 0, 'PREFERRED_PROVIDER_UNAVAILABLE');
    const primary = choices[0]!;
    const fallback = this.providers.filter((p) => p !== primary);
    const envelope: ProviderRequest['envelope'] = {
      requestId: request.requestId,
      capability: request.capability,
      purpose: request.purpose,
      locale: 'fr-FR',
      prompt: { key: prompt.key, version: prompt.version, contentHash: prompt.contentHash },
      contracts: {
        inputSchemaVersion: prompt.schemaVersion,
        outputSchemaVersion: prompt.schemaVersion,
      },
      knowledgeSnapshot: {
        id: request.knowledgeSnapshot.id,
        version: request.knowledgeSnapshot.version,
        contentHash: request.knowledgeSnapshot.contentHash,
      },
      input,
    };
    const base: ProviderRequest = {
      envelope,
      promptContent: prompt.content,
      maxOutputTokens: policy.maxOutputTokens,
      outputSchema: z.toJSONSchema(contracts.output),
      ...(policy.reasoningLevel ? { reasoningLevel: policy.reasoningLevel } : {}),
    };
    await this.repository.begin({
      id: request.requestId,
      purpose: request.purpose,
      capability: request.capability,
      promptKey: prompt.key,
      promptVersion: prompt.version,
      promptContentHash: prompt.contentHash,
      knowledgeSnapshotId: request.knowledgeSnapshot.id,
      knowledgeContext: knowledge,
      inputSchemaVersion: prompt.schemaVersion,
      outputSchemaVersion: prompt.schemaVersion,
      inputHash: contentHash(envelope),
      policy,
      budget,
      reservation: String(policy.maxEstimatedCost),
      ...(policy.preferredProvider ? { requestedProvider: policy.preferredProvider } : {}),
      ...(policy.preferredModel ? { requestedModel: policy.preferredModel } : {}),
      ...(policy.reasoningLevel ? { reasoningLevel: policy.reasoningLevel } : {}),
    });
    let repair: ProviderRequest['repair'];
    let lastCode = 'ATTEMPTS_EXHAUSTED';
    let terminal: 'FAILED' | 'REJECTED_SCHEMA' = 'FAILED';
    for (let i = 0; i < policy.maxAttempts; i++) {
      const provider =
        i > 0 && policy.fallbackPolicy === 'SAME_CONTRACT_ALLOWED'
          ? (fallback[(i - 1) % fallback.length] ?? primary)
          : primary;
      const call = { ...base, ...(repair ? { repair } : {}) };
      if (this.paused()) {
        lastCode = 'AI_GENERATION_PAUSED';
        break;
      }
      let quote: ReturnType<StructuredProvider['estimate']>;
      try {
        quote = provider.estimate(structuredClone(call));
        invariant(
          Number.isSafeInteger(quote.inputTokens) &&
            quote.inputTokens >= 0 &&
            /^\d+(?:\.\d{1,8})?$/.test(quote.maxCost),
          'INVALID_PROVIDER_ESTIMATE',
        );
      } catch {
        lastCode = 'INVALID_PROVIDER_ESTIMATE';
        break;
      }
      if (quote.inputTokens > policy.maxInputTokens || quote.currency !== budget.currency) {
        lastCode = 'INPUT_OR_CURRENCY_BUDGET';
        break;
      }
      let attempt;
      try {
        attempt = await this.repository.startAttempt(request.requestId, {
          provider: provider.provider,
          model: provider.model,
          requestHash: contentHash(call),
          estimate: quote.maxCost,
          ...(policy.reasoningLevel ? { reasoningLevel: policy.reasoningLevel } : {}),
        });
      } catch (error) {
        if (
          error instanceof Error &&
          ['COST_BUDGET_BLOCK', 'ATTEMPTS_EXHAUSTED'].includes(error.message)
        ) {
          lastCode = error.message;
          break;
        }
        throw error;
      }
      let reply: ProviderReply | undefined;
      let usage: z.infer<typeof UsageSchema> | undefined;
      let output: O | undefined;
      let schemaPassed = false;
      let code: string | undefined;
      let retry = false;
      let attemptStatus: 'SUCCEEDED' | 'FAILED' | 'REJECTED_SCHEMA' = 'FAILED';
      try {
        reply = await deadline(provider, call, policy.timeoutMs);
        usage = reply.usage === undefined ? undefined : UsageSchema.parse(reply.usage);
        invariant(!usage || usage.currency === budget.currency, 'USAGE_CURRENCY_MISMATCH');
        invariant(
          (usage?.inputTokens ?? 0) <= policy.maxInputTokens &&
            (usage?.outputTokens ?? 0) <= policy.maxOutputTokens,
          'TOKEN_BUDGET_EXCEEDED',
        );
        invariant(
          !usage?.costAmount || new Prisma.Decimal(usage.costAmount).lte(quote.maxCost),
          'PROVIDER_COST_BOUND_EXCEEDED',
        );
        let raw: unknown;
        try {
          raw = JSON.parse(reply.body);
        } catch {
          throw new AiFailure('INVALID_JSON');
        }
        const parsed = contracts.output.safeParse(raw);
        if (!parsed.success) {
          repair = {
            instruction:
              'Correct only JSON structure to the same contract. Keep the same task and context.',
            errors: parsed.error.issues.map((issue) => ({
              code: issue.code,
              path: issue.path.join('.'),
            })),
          };
          throw new AiFailure('INVALID_SCHEMA');
        }
        assertNoSecrets(parsed.data);
        schemaPassed = true;
        await contracts.validate(input, parsed.data);
        output = parsed.data;
        attemptStatus = 'SUCCEEDED';
      } catch (error) {
        code =
          error instanceof AiFailure || error instanceof ProviderFailure
            ? error.code
            : error instanceof Error && /^[A-Z][A-Z_]+$/.test(error.message)
              ? error.message
              : 'PROVIDER_OR_VALIDATION_ERROR';
        retry = [
          'NETWORK',
          'PROVIDER_5XX',
          'RATE_LIMIT',
          'TIMEOUT',
          'INVALID_JSON',
          'INVALID_SCHEMA',
        ].includes(code);
        if (['INVALID_JSON', 'INVALID_SCHEMA'].includes(code)) {
          attemptStatus = 'REJECTED_SCHEMA';
          repair ??= {
            instruction:
              'Correct only JSON structure to the same contract. Keep the same task and context.',
            errors: [{ code, path: '' }],
          };
        }
        if (error instanceof ProviderFailure && !error.billable)
          usage = { costAmount: '0', currency: budget.currency };
      }
      await this.repository.finishAttempt(attempt.id, {
        status: attemptStatus,
        ...(reply ? { responseHash: textHash(reply.body) } : {}),
        ...(usage?.inputTokens !== undefined ? { inputTokens: usage.inputTokens } : {}),
        ...(usage?.outputTokens !== undefined ? { outputTokens: usage.outputTokens } : {}),
        ...(usage?.cachedInputTokens !== undefined
          ? { cachedInputTokens: usage.cachedInputTokens }
          : {}),
        ...(usage?.costAmount !== undefined && usage.currency === budget.currency
          ? { costAmount: usage.costAmount }
          : {}),
        costCurrency: budget.currency,
        accountedCost:
          usage?.costAmount !== undefined && usage.currency === budget.currency
            ? usage.costAmount
            : quote.maxCost,
        ...(code ? { failureCode: code } : {}),
        validation: {
          schema: schemaPassed ? 'PASS' : attemptStatus === 'REJECTED_SCHEMA' ? 'FAIL' : 'NOT_RUN',
          ...(code ? { code } : {}),
        },
      });
      if (attemptStatus === 'SUCCEEDED' && output !== undefined) {
        await this.repository.finish(request.requestId, 'SUCCEEDED', contentHash(output));
        return {
          modelInvocationId: request.requestId,
          output,
          validation: {
            schema: 'PASS',
            references: 'PASS',
            businessRules: 'PASS',
            claims: 'PASS',
          } as const,
          warnings: [],
        };
      }
      lastCode = code ?? 'PROVIDER_ERROR';
      terminal = attemptStatus === 'REJECTED_SCHEMA' ? 'REJECTED_SCHEMA' : 'FAILED';
      if (!retry) break;
    }
    await this.repository.finish(request.requestId, terminal, undefined, lastCode);
    throw new AiFailure(lastCode);
  }
}

/** Safe upper input bound for the deterministic fake. A real adapter must supply its own estimator. */
export function fakeInputTokens(request: ProviderRequest) {
  return Buffer.byteLength(canonicalJson(request), 'utf8');
}
