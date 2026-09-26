import { describe, expect, it, vi } from 'vitest';
import {
  GROQ_CHAT_COMPLETIONS_ENDPOINT,
  GROQ_GPT_OSS_120B_MODEL,
  GROQ_PROVIDER_ID,
  GroqStructuredProvider,
} from '../../packages/ai/src/groq.js';
import type { ProviderRequest } from '../../packages/ai/src/gateway.js';

const sentinel = ['FAKE', 'GROQ', 'KEY', 'DO_NOT_USE'].join('_');

function request(overrides: Partial<ProviderRequest> = {}): ProviderRequest {
  return {
    envelope: {
      requestId: '8bb0ada6-fdcb-4e7f-aeae-01c30f39167c',
      capability: 'CREATOR',
      purpose: 'phase11a2-test',
      locale: 'fr-FR',
      prompt: {
        key: 'creator',
        version: 'v1',
        contentHash: 'prompt-hash',
      },
      contracts: {
        inputSchemaVersion: 'v1',
        outputSchemaVersion: 'v1',
      },
      knowledgeSnapshot: {
        id: 'knowledge-id',
        version: 1,
        contentHash: 'knowledge-hash',
      },
      input: {
        topic: 'test',
      },
    },
    promptContent: 'Create the requested content.',
    maxOutputTokens: 512,
    outputSchema: {
      type: 'object',
      properties: {
        ok: { type: 'boolean' },
      },
      required: ['ok'],
      additionalProperties: false,
    },
    ...overrides,
  };
}

describe('GroqStructuredProvider', () => {
  it('is a REAL provider and estimates conservatively without resolving credentials or networking', () => {
    const apiKey = vi.fn(() => sentinel);
    const calls: unknown[] = [];

    const fetchImpl = (async (...args: unknown[]) => {
      calls.push(args);
      throw new Error('unexpected network');
    }) as unknown as typeof fetch;

    const provider = new GroqStructuredProvider(apiKey, fetchImpl);
    const estimate = provider.estimate(request());

    expect(provider.kind).toBe('REAL');
    expect(provider.provider).toBe(GROQ_PROVIDER_ID);
    expect(provider.model).toBe(GROQ_GPT_OSS_120B_MODEL);

    expect(estimate.currency).toBe('USD');
    expect(estimate.inputTokens).toBeGreaterThan(4_096);
    expect(estimate.maxCost).toMatch(/^\d+\.\d{8}$/);

    expect(apiKey).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
  });

  it('resolves the secret only at invocation, maps the request and returns conservative usage', async () => {
    const apiKey = vi.fn(() => sentinel);
    const calls: Array<{
      input: Parameters<typeof fetch>[0];
      init?: RequestInit;
    }> = [];

    const fetchImpl = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      calls.push(init === undefined ? { input } : { input, init });

      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: '{"ok":true}',
              },
            },
          ],
          usage: {
            prompt_tokens: 100,
            completion_tokens: 20,
            prompt_tokens_details: {
              cached_tokens: 40,
            },
          },
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        },
      );
    }) as typeof fetch;

    const provider = new GroqStructuredProvider(apiKey, fetchImpl);

    const reply = await provider.generate(
      request({ reasoningLevel: 'high' }),
      new AbortController().signal,
    );

    expect(apiKey).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(1);
    expect(String(calls[0]!.input)).toBe(GROQ_CHAT_COMPLETIONS_ENDPOINT);

    const headers = calls[0]!.init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${sentinel}`);

    const rawBody = String(calls[0]!.init?.body);
    expect(rawBody).not.toContain(sentinel);

    const body = JSON.parse(rawBody) as Record<string, unknown>;

    expect(body).toMatchObject({
      model: GROQ_GPT_OSS_120B_MODEL,
      response_format: {
        type: 'json_object',
      },
      max_completion_tokens: 512,
      include_reasoning: false,
      citation_options: 'disabled',
      stream: false,
      reasoning_effort: 'high',
    });

    expect(reply).toEqual({
      body: '{"ok":true}',
      usage: {
        inputTokens: 100,
        outputTokens: 20,
        cachedInputTokens: 40,
        costAmount: '0.00002700',
        currency: 'USD',
      },
    });
  });

  it.each([
    [429, 'RATE_LIMIT'],
    [503, 'PROVIDER_5XX'],
    [401, 'PERMANENT'],
    [408, 'NETWORK'],
  ] as const)('maps HTTP %s to %s without marking it billable', async (status, code) => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ error: 'safe-fixture' }), {
        status,
        headers: {
          'Content-Type': 'application/json',
        },
      })) as typeof fetch;

    const provider = new GroqStructuredProvider(() => sentinel, fetchImpl);

    await expect(provider.generate(request(), new AbortController().signal)).rejects.toMatchObject({
      code,
      billable: false,
    });
  });

  it('maps transport failures to a nonbillable NETWORK failure', async () => {
    const fetchImpl = (async () => {
      throw new Error('fixture transport failure');
    }) as typeof fetch;

    const provider = new GroqStructuredProvider(() => sentinel, fetchImpl);

    await expect(provider.generate(request(), new AbortController().signal)).rejects.toMatchObject({
      code: 'NETWORK',
      billable: false,
    });
  });

  it('fails before secret resolution for unsupported reasoning or output limits', async () => {
    const apiKey = vi.fn(() => sentinel);
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const provider = new GroqStructuredProvider(apiKey, fetchImpl);

    await expect(
      provider.generate(request({ reasoningLevel: 'max' }), new AbortController().signal),
    ).rejects.toMatchObject({
      code: 'PERMANENT',
      billable: false,
    });

    await expect(
      provider.generate(request({ maxOutputTokens: 65_537 }), new AbortController().signal),
    ).rejects.toMatchObject({
      code: 'PERMANENT',
      billable: false,
    });

    expect(apiKey).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('treats malformed successful responses conservatively as billable', async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ choices: [] }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
        },
      })) as typeof fetch;

    const provider = new GroqStructuredProvider(() => sentinel, fetchImpl);

    await expect(provider.generate(request(), new AbortController().signal)).rejects.toMatchObject({
      code: 'PERMANENT',
      billable: true,
    });
  });
});
