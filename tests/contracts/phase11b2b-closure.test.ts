import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { parseConfig } from '../../packages/shared/src/index.js';
import {
  CAPTURE_CANARY_CONFIRMATION,
  assertCaptureCanaryConfirmation,
  assertCaptureCanaryExecutionEnvironment,
  parseCaptureCanaryExecuteArgs,
} from '../../scripts/phase11b2-capture-canary-execute.js';
import { configFixture } from '../support/config.js';

const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
  scripts: Record<string, string>;
};

const doc = readFileSync('docs/PHASE_11B_CAPTURE_ACTIVATION.md', 'utf8');

describe('Phase 11B-2B closure contract', () => {
  it('freezes the explicit reviewed execution command', () => {
    expect(
      parseCaptureCanaryExecuteArgs([
        '--confirm',
        CAPTURE_CANARY_CONFIRMATION,
        '--storage-state',
        '/tmp/state.json',
      ]),
    ).toEqual({
      confirmation: 'EXECUTE_PRICING_PAGE_CAPTURE_DEMO',
      storageStatePath: '/tmp/state.json',
    });

    expect(() => assertCaptureCanaryConfirmation('wrong')).toThrow(
      'CAPTURE_CANARY_CONFIRMATION_INVALID',
    );
  });

  it('permits Capture execution only in explicitly unpaused STAGING_CAPTURE', () => {
    expect(() => assertCaptureCanaryExecutionEnvironment(parseConfig(configFixture))).toThrow(
      'CAPTURE_CANARY_EXECUTION_ENVIRONMENT_INVALID',
    );

    expect(() =>
      assertCaptureCanaryExecutionEnvironment(
        parseConfig({
          ...configFixture,
          VCE_ENV: 'STAGING_CAPTURE',
          PAUSE_CAPTURE: 'false',
        }),
      ),
    ).not.toThrow();

    expect(() =>
      assertCaptureCanaryExecutionEnvironment(
        parseConfig({
          ...configFixture,
          VCE_ENV: 'PRODUCTION',
          PAUSE_CAPTURE: 'false',
        }),
      ),
    ).toThrow('CAPTURE_CANARY_EXECUTION_ENVIRONMENT_INVALID');
  });

  it('freezes the reproducible 11B-2B gate', () => {
    expect(pkg.scripts['canary:capture:execute']).toBe(
      'tsx scripts/phase11b2-capture-canary-execute.ts',
    );

    expect(pkg.scripts['check:phase11b2b']).toContain('tests/contracts/phase11b2b-closure.test.ts');
  });

  it('records code closure without claiming the real canary ran', () => {
    expect(doc).toContain('**Status:** 11B-2B COMPLETE');

    expect(doc).toContain('11B-2B explicit execution command: DONE');

    expect(doc).toContain('real authenticated Capture canary: NOT STARTED');
  });
});
