import type { RuntimeConfig, SecretResolver } from '@vision/shared';
import { assertLocalBootstrap } from '@vision/shared';

import { createRuntimeDependencies } from './runtime-dependencies.js';

export function createLocalDependencies(config: RuntimeConfig, secrets: SecretResolver) {
  assertLocalBootstrap(config);
  return createRuntimeDependencies(config, secrets);
}
