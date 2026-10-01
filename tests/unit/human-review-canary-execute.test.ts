import { describe, expect, it } from 'vitest';

import { parseConfig } from '../../packages/shared/src/index.js';

import {
  HUMAN_REVIEW_CANARY_CONFIRMATION,
  assertHumanReviewCanaryConfirmation,
  assertHumanReviewCanaryEnvironment,
  parseHumanReviewCanaryArgs,
} from '../../scripts/phase11d2-human-review-canary-execute.js';

import { configFixture } from '../support/config.js';

describe('Phase 11D-2 Human Review canary execution boundary', () => {
  it('requires an explicit human approval confirmation and absolute evidence directory', () => {
    expect(HUMAN_REVIEW_CANARY_CONFIRMATION).toBe('APPROVE_DISPOSABLE_HUMAN_REVIEW_CANARY');

    expect(
      parseHumanReviewCanaryArgs([
        '--confirm',
        HUMAN_REVIEW_CANARY_CONFIRMATION,
        '--output-dir',
        '/tmp/vce-human-review',
      ]),
    ).toEqual({
      confirmation: HUMAN_REVIEW_CANARY_CONFIRMATION,
      outputDirectory: '/tmp/vce-human-review',
    });

    expect(() => assertHumanReviewCanaryConfirmation('wrong')).toThrow(
      'HUMAN_REVIEW_CANARY_CONFIRMATION_INVALID',
    );
  });

  it('requires LOCAL with all persistent work classes paused', () => {
    expect(() => assertHumanReviewCanaryEnvironment(parseConfig(configFixture))).not.toThrow();

    expect(() =>
      assertHumanReviewCanaryEnvironment(
        parseConfig({
          ...configFixture,
          PAUSE_ALL_PUBLISHING: 'false',
        }),
      ),
    ).toThrow('HUMAN_REVIEW_CANARY_ENVIRONMENT_INVALID');

    expect(() =>
      assertHumanReviewCanaryEnvironment(
        parseConfig({
          ...configFixture,
          VCE_ENV: 'PRODUCTION',
        }),
      ),
    ).toThrow();
  });
});
