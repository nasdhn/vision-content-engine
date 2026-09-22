import type { PublishResult } from './index.js';

export type PublishFailureResult = Exclude<PublishResult, Readonly<{ responseClass: 'SUCCESS' }>>;

export class ProviderPublishError extends Error {
  constructor(readonly result: PublishFailureResult) {
    super(result.failureCode);
    this.name = 'ProviderPublishError';
  }
}

export function providerPublishFailure(error: unknown): PublishFailureResult | null {
  return error instanceof ProviderPublishError ? error.result : null;
}
