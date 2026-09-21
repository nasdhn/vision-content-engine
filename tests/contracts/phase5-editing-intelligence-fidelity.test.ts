import { expect, it } from 'vitest';
import { z } from 'zod';

import * as frozen from '../../docs/spec-artifacts/ai-contracts/editing-intelligence';
import * as runtime from '../../packages/contracts/src/editing-intelligence.js';

it('preserves the frozen Editing Intelligence AI contracts at runtime', () => {
  expect(Object.keys(runtime)).toEqual(Object.keys(frozen));

  for (const [name, contract] of Object.entries(runtime)) {
    expect(z.toJSONSchema(contract)).toEqual(
      z.toJSONSchema((frozen as Record<string, z.ZodType>)[name]!),
    );
  }
});
