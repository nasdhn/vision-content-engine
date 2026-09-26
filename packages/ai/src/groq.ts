import { z } from 'zod';
import { canonicalJson } from '@vision/contracts/canonical';
import {
  ProviderFailure,
  type ProviderReply,
  type ProviderRequest,
  type StructuredProvider,
} from './gateway.js';

export const GROQ_PROVIDER_ID = 'groq';
export const GROQ_GPT_OSS_120B_MODEL = 'openai/gpt-oss-120b';
export const GROQ_CHAT_COMPLETIONS_ENDPOINT = [
  'https:',
  '',
  'api.groq.com',
  'openai',
  'v1',
  'chat',
  'completions',
].join('/');

export const GROQ_GPT_OSS_120B_PRICING = Object.freeze({
  verifiedAt: '2026-09-26',
  currency: 'USD',
  inputUsdPerMillionTokens: '0.15',
  outputUsdPerMillionTokens: '0.60',
});

const GROQ_MAX_OUTPUT_TOKENS = 65_536;
const CONSERVATIVE_PROTOCOL_OVERHEAD_TOKENS = 4_096;

const COST_SCALE = 100_000_000n;

// USD/token represented in 1e-8 USD units.
// $0.15 / 1M input tokens = 15 * 1e-8 USD/token.
// $0.60 / 1M output tokens = 60 * 1e-8 USD/token.
const INPUT_COST_UNITS = 15n;
const OUTPUT_COST_UNITS = 60n;

const GroqReasoningEffortSchema = z.enum(['low', 'medium', 'high']);

const GroqUsageSchema = z
  .object({
    prompt_tokens: z.number().int().nonnegative(),
    completion_tokens: z.number().int().nonnegative(),
    prompt_tokens_details: z
      .object({
        cached_tokens: z.number().int().nonnegative().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

const GroqResponseSchema = z
  .object({
    choices: z
      .array(
        z
          .object({
            message: z
              .object({
                content: z.string().nullable(),
              })
              .passthrough(),
          })
          .passthrough(),
      )
      .min(1),
    usage: GroqUsageSchema.optional(),
  })
  .passthrough();

function formatCostUnits(units: bigint): string {
  const whole = units / COST_SCALE;
  const fraction = (units % COST_SCALE).toString().padStart(8, '0');
  return `${whole}.${fraction}`;
}

function conservativeUsdCost(inputTokens: number, outputTokens: number): string {
  return formatCostUnits(
    BigInt(inputTokens) * INPUT_COST_UNITS + BigInt(outputTokens) * OUTPUT_COST_UNITS,
  );
}

function reasoningEffort(value: string | undefined) {
  if (value === undefined) return undefined;

  const parsed = GroqReasoningEffortSchema.safeParse(value);
  if (!parsed.success) throw new ProviderFailure('PERMANENT', false);

  return parsed.data;
}

function requestBody(request: ProviderRequest) {
  if (request.maxOutputTokens > GROQ_MAX_OUTPUT_TOKENS) {
    throw new ProviderFailure('PERMANENT', false);
  }

  const reasoning = reasoningEffort(request.reasoningLevel);

  const userContent = canonicalJson({
    instruction:
      'Return exactly one JSON object. Do not use markdown fences. The object must satisfy outputSchema.',
    envelope: request.envelope,
    outputSchema: request.outputSchema,
    ...(request.repair ? { repair: request.repair } : {}),
  });

  return {
    model: GROQ_GPT_OSS_120B_MODEL,
    messages: [
      {
        role: 'system',
        content: request.promptContent,
      },
      {
        role: 'user',
        content: userContent,
      },
    ],
    // Gateway-side Zod validation and repair remain canonical. We deliberately
    // avoid coupling frozen contracts to a provider-specific strict-schema subset.
    response_format: {
      type: 'json_object',
    },
    max_completion_tokens: request.maxOutputTokens,
    include_reasoning: false,
    citation_options: 'disabled',
    stream: false,
    ...(reasoning ? { reasoning_effort: reasoning } : {}),
  };
}

function conservativeInputTokens(request: ProviderRequest): number {
  const body = requestBody(request);

  // Deliberately conservative: count every UTF-8 request byte as one input
  // token and add a fixed protocol allowance. This overestimates normal BPE
  // usage and therefore never relies on an optimistic tokenizer estimate.
  return Buffer.byteLength(canonicalJson(body), 'utf8') + CONSERVATIVE_PROTOCOL_OVERHEAD_TOKENS;
}

function providerFailureForStatus(status: number) {
  if (status === 429) return new ProviderFailure('RATE_LIMIT', false);
  if (status === 408) return new ProviderFailure('NETWORK', false);
  if (status >= 500) return new ProviderFailure('PROVIDER_5XX', false);
  return new ProviderFailure('PERMANENT', false);
}

export class GroqStructuredProvider implements StructuredProvider {
  readonly kind = 'REAL' as const;
  readonly provider = GROQ_PROVIDER_ID;
  readonly model = GROQ_GPT_OSS_120B_MODEL;

  constructor(
    private readonly apiKeyProvider: () => string,
    private readonly fetchImpl: typeof fetch = globalThis.fetch,
  ) {}

  estimate(request: ProviderRequest) {
    const inputTokens = conservativeInputTokens(request);

    return {
      inputTokens,
      maxCost: conservativeUsdCost(inputTokens, request.maxOutputTokens),
      currency: 'USD',
    };
  }

  async generate(request: ProviderRequest, signal: AbortSignal): Promise<ProviderReply> {
    const body = requestBody(request);

    const apiKey = this.apiKeyProvider();
    if (typeof apiKey !== 'string' || !apiKey.trim()) {
      throw new Error('REQUIRED_SECRET_UNAVAILABLE');
    }

    let response: Response;

    try {
      response = await this.fetchImpl(GROQ_CHAT_COMPLETIONS_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal,
      });
    } catch (error) {
      // The outer gateway deadline owns timeout classification.
      if (signal.aborted) throw error;
      throw new ProviderFailure('NETWORK', false);
    }

    if (!response.ok) {
      throw providerFailureForStatus(response.status);
    }

    let payload: unknown;

    try {
      payload = await response.json();
    } catch {
      // A successful HTTP request may already be billable, so malformed
      // success responses are conservatively treated as billable.
      throw new ProviderFailure('PERMANENT');
    }

    const parsed = GroqResponseSchema.safeParse(payload);
    if (!parsed.success) {
      throw new ProviderFailure('PERMANENT');
    }

    const content = parsed.data.choices[0]?.message.content;
    if (typeof content !== 'string' || !content.trim()) {
      throw new ProviderFailure('PERMANENT');
    }

    const usage = parsed.data.usage;

    if (!usage) {
      return { body: content };
    }

    const cachedInputTokens = Math.min(
      usage.prompt_tokens,
      usage.prompt_tokens_details?.cached_tokens ?? 0,
    );

    return {
      body: content,
      usage: {
        inputTokens: usage.prompt_tokens,
        outputTokens: usage.completion_tokens,
        cachedInputTokens,
        // Intentionally account cached tokens at the full input price.
        // The durable gateway therefore remains conservative even when
        // Groq applies a prompt-cache discount.
        costAmount: conservativeUsdCost(usage.prompt_tokens, usage.completion_tokens),
        currency: 'USD',
      },
    };
  }
}
