import { readFile } from 'node:fs/promises';

import { expect, it } from 'vitest';
import { z } from 'zod';

import * as frozenV10 from '../../docs/spec-artifacts/ai-contracts/editing-intelligence';
import * as frozenV11 from '../../docs/spec-artifacts/ai-contracts/editing-intelligence-v1.1';
import * as runtime from '../../packages/contracts/src/editing-intelligence.js';

it('preserves the historical Editing Intelligence 1.0 contracts at runtime', () => {
  for (const name of [
    'EditingIntelligenceInputSchema',
    'EditingIntelligenceOutputSchema',
  ] as const) {
    expect(z.toJSONSchema(runtime[name])).toEqual(z.toJSONSchema(frozenV10[name]));
  }
});

it('preserves the frozen Editing Intelligence 1.1 blocker contracts at runtime', () => {
  const names = [
    'EditingBlockerReasonCodeSchema',
    'EditingBlockerRecoverabilitySchema',
    'EditingBlockerEvidenceSchema',
    'EditingBlockerRequiredActionSchema',
    'EditingBlockerSpecSchema',
    'EditingIntelligencePlanResultSchema',
    'EditingIntelligenceBlockedResultSchema',
    'EditingIntelligenceOutputV11Schema',
  ] as const;

  for (const name of names) {
    expect(z.toJSONSchema(runtime[name])).toEqual(z.toJSONSchema(frozenV11[name]));
  }
});

it('pins the Editing Intelligence 1.1 prompt artifact exactly', async () => {
  const runtimePrompt = JSON.parse(
    await readFile('packages/ai/prompts/editing-intelligence.v1.1.json', 'utf8'),
  );
  const frozenPrompt = JSON.parse(
    await readFile(
      'docs/spec-artifacts/ai-contracts/editing-intelligence-prompt.v1.1.json',
      'utf8',
    ),
  );
  expect(runtimePrompt).toEqual(frozenPrompt);
  expect(runtimePrompt).toMatchObject({
    key: 'editing-intelligence',
    version: '1.1.0',
    schemaVersion: '1.1.0',
    capability: 'EDITING_INTELLIGENCE',
    status: 'ACTIVE',
  });
});
