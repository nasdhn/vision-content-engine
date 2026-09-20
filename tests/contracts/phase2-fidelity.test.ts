import { readFile, readdir } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { z } from 'zod';
import * as runtimeCreator from '../../packages/contracts/src/creator.js';
import * as frozenCreator from '../../docs/spec-artifacts/ai-contracts/creator';
import * as runtimeDirector from '../../packages/contracts/src/creative-director.js';
import * as frozenDirector from '../../docs/spec-artifacts/ai-contracts/creative-director';
import * as runtimeShared from '../../packages/contracts/src/shared.js';
import * as frozenShared from '../../docs/spec-artifacts/ai-contracts/shared';
import * as runtimePattern from '../../packages/contracts/src/pattern.js';
import * as frozenPattern from '../../docs/spec-artifacts/pattern-library/schema';
import { getPrompt } from '../../packages/ai/src/prompts.js';

it('preserves the canonical Phase 2 Zod contracts exactly', () => {
  for (const [runtime, frozen] of [
    [runtimeCreator, frozenCreator],
    [runtimeDirector, frozenDirector],
    [runtimeShared, frozenShared],
    [runtimePattern, frozenPattern],
  ]) {
    expect(Object.keys(runtime!)).toEqual(Object.keys(frozen!));
    for (const [name, contract] of Object.entries(runtime!)) {
      expect(z.toJSONSchema(contract)).toEqual(
        z.toJSONSchema((frozen as Record<string, z.ZodType>)[name]!),
      );
    }
  }
});
it('ships all eight seeds without semantic edits to the frozen artifacts', async () => {
  const names = (await readdir('packages/application/pattern-seeds')).sort();
  expect(names).toHaveLength(8);
  for (const name of names)
    expect(
      JSON.parse(await readFile(`packages/application/pattern-seeds/${name}`, 'utf8')),
    ).toEqual(
      JSON.parse(await readFile(`docs/spec-artifacts/pattern-library/seeds/${name}`, 'utf8')),
    );
});
it('pins immutable v1 prompt content; future edits require a new artifact version', () => {
  expect(getPrompt('creator', '1.0.0').contentHash).toBe(
    'ecd7a961de8710786b8b5ef4e04501de96554df225aca79250d719c85a53a0ea',
  );
  expect(getPrompt('creative-director', '1.0.0').contentHash).toBe(
    'f8944f9f5de860d18cb2311682ec27a06a8fed55ff0c0cda95c0c6c5fc050a2f',
  );
});
