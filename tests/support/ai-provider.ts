import type {
  StructuredProvider,
  ProviderRequest,
  ProviderReply,
} from '../../packages/ai/src/index.js';
import { fakeInputTokens } from '../../packages/ai/src/index.js';
import { ScriptedProvider } from './scripted-provider.js';

export class FakeAIProvider implements StructuredProvider {
  readonly kind = 'FAKE' as const;
  readonly provider = 'deterministic-fixture';
  readonly calls: ProviderRequest[] = [];
  constructor(
    private readonly outcome: (
      input: ProviderRequest,
      signal: AbortSignal,
    ) => Promise<ProviderReply>,
    readonly model = 'fixture-v1',
    readonly maxCost = '0.1',
  ) {}
  estimate(request: ProviderRequest) {
    return { inputTokens: fakeInputTokens(request), maxCost: this.maxCost, currency: 'EUR' };
  }
  async generate(input: ProviderRequest, signal: AbortSignal) {
    this.calls.push(structuredClone(input));
    return this.outcome(input, signal);
  }
  static scripted(outcomes: (ProviderReply | Error)[], model = 'fixture-v1') {
    const queue = new ScriptedProvider<ProviderRequest, ProviderReply>(outcomes);
    return new FakeAIProvider((input) => queue.execute(input), model);
  }
}

export class SimulatedRealAIProvider implements StructuredProvider {
  readonly kind = 'REAL' as const;
  readonly provider = 'simulated-real';
  readonly calls: ProviderRequest[] = [];

  constructor(
    private readonly outcome: (
      input: ProviderRequest,
      signal: AbortSignal,
    ) => Promise<ProviderReply>,
    readonly model = 'simulated-real-v1',
    readonly maxCost = '0.1',
  ) {}

  estimate(request: ProviderRequest) {
    return {
      inputTokens: fakeInputTokens(request),
      maxCost: this.maxCost,
      currency: 'EUR',
    };
  }

  async generate(input: ProviderRequest, signal: AbortSignal) {
    this.calls.push(structuredClone(input));
    return this.outcome(input, signal);
  }
}

export const reply = (output: unknown): ProviderReply => ({
  body: JSON.stringify(output),
  usage: {
    inputTokens: 100,
    outputTokens: 50,
    cachedInputTokens: 0,
    costAmount: '0.01',
    currency: 'EUR',
  },
});
