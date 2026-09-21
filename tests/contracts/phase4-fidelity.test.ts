import { readFile, readdir } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { z } from 'zod';
import * as runtimeCapture from '../../packages/contracts/src/capture.js';
import * as frozenCapture from '../../docs/spec-artifacts/product-capture/schema';

it('preserves the canonical Phase 4 capture contracts', () => {
  expect(Object.keys(runtimeCapture)).toEqual(Object.keys(frozenCapture));

  for (const [name, contract] of Object.entries(runtimeCapture)) {
    expect(z.toJSONSchema(contract)).toEqual(
      z.toJSONSchema((frozenCapture as Record<string, z.ZodType>)[name]!),
    );
  }
});

it('ships exact copies of the five frozen scenarios and named profile registries', async () => {
  for (const name of ['browser-profiles.json', 'safety-policies.json']) {
    expect(
      JSON.parse(await readFile(`packages/application/capture-seeds/${name}`, 'utf8')),
    ).toEqual(JSON.parse(await readFile(`docs/spec-artifacts/product-capture/${name}`, 'utf8')));
  }

  const names = (await readdir('packages/application/capture-seeds/scenarios'))
    .filter((name) => name.endsWith('.json'))
    .sort();

  expect(names).toHaveLength(5);

  for (const name of names) {
    expect(
      JSON.parse(await readFile(`packages/application/capture-seeds/scenarios/${name}`, 'utf8')),
    ).toEqual(
      JSON.parse(await readFile(`docs/spec-artifacts/product-capture/scenarios/${name}`, 'utf8')),
    );
  }
});
