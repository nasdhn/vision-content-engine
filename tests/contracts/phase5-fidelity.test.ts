import { readFile, readdir } from 'node:fs/promises';

import { expect, it } from 'vitest';
import { z } from 'zod';

import * as frozenEditing from '../../docs/spec-artifacts/editing-intelligence/schema';
import * as runtimeEditing from '../../packages/contracts/src/editing.js';

it('preserves the canonical Phase 5 Editing Intelligence Zod contracts', () => {
  expect(Object.keys(runtimeEditing)).toEqual(Object.keys(frozenEditing));

  for (const [name, contract] of Object.entries(runtimeEditing)) {
    expect(z.toJSONSchema(contract)).toEqual(
      z.toJSONSchema((frozenEditing as Record<string, z.ZodType>)[name]!),
    );
  }
});

it('ships all seven EditingProfile seeds without semantic edits', async () => {
  const runtimeDirectory = 'packages/application/editing-profile-seeds';

  const frozenDirectory = 'docs/spec-artifacts/editing-intelligence/profiles';

  const runtimeNames = (await readdir(runtimeDirectory))
    .filter((name) => name.endsWith('.json'))
    .sort();

  const frozenNames = (await readdir(frozenDirectory))
    .filter((name) => name.endsWith('.json'))
    .sort();

  expect(runtimeNames).toEqual(frozenNames);

  expect(runtimeNames).toHaveLength(7);

  for (const name of runtimeNames) {
    const runtime = JSON.parse(await readFile(`${runtimeDirectory}/${name}`, 'utf8'));

    const frozen = JSON.parse(await readFile(`${frozenDirectory}/${name}`, 'utf8'));

    expect(runtime).toEqual(frozen);

    expect(() => runtimeEditing.EditingProfileVersionSpecSchema.parse(runtime)).not.toThrow();
  }
});
