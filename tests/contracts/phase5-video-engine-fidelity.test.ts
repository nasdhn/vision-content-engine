import { expect, it } from 'vitest';
import { z } from 'zod';

import * as frozenVideoEngine from '../../docs/spec-artifacts/video-engine/schema';
import * as runtimeVideoEngine from '../../packages/contracts/src/video-engine.js';

it('preserves the frozen Video Engine Zod contracts at runtime', () => {
  expect(Object.keys(runtimeVideoEngine)).toEqual(Object.keys(frozenVideoEngine));

  for (const [name, contract] of Object.entries(runtimeVideoEngine)) {
    expect(z.toJSONSchema(contract)).toEqual(
      z.toJSONSchema((frozenVideoEngine as Record<string, z.ZodType>)[name]!),
    );
  }
});
