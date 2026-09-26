import { describe, expect, it } from 'vitest';
import {
  parseConfig,
  assertLocalBootstrap,
  isRealProviderActivationEnabled,
} from '../../packages/shared/src/index.js';
import { configFixture } from '../support/config.js';

describe('bootstrap configuration safety', () => {
  it('defaults all required kill switches to paused and remote providers to disabled', () => {
    const config = parseConfig(configFixture);
    expect(
      Object.entries(config)
        .filter(([key]) => key.startsWith('PAUSE_'))
        .map(([, value]) => value),
    ).toEqual([true, true, true, true, true]);
    expect(config.VCE_REAL_PROVIDERS_ENABLED).toBe('false');
    expect(Object.isFrozen(config)).toBe(true);
  });
  it('parses false literally and rejects misspelled booleans or application keys', () => {
    expect(parseConfig({ ...configFixture, PAUSE_CAPTURE: 'false' }).PAUSE_CAPTURE).toBe(false);
    expect(() => parseConfig({ ...configFixture, PAUSE_CAPTURE: 'FALSE' })).toThrow();
    expect(() => parseConfig({ ...configFixture, PAUSE_CAPTUR: 'false' })).toThrow();
  });
  it('ignores unrelated shell variables and rejects missing dependencies', () => {
    expect(() => parseConfig({ ...configFixture, PATH: '/bin' })).not.toThrow();
    expect(() => parseConfig({ ...configFixture, DATABASE_URL: undefined })).toThrow(
      'DATABASE_URL',
    );
  });
  it('accepts only strong optional Vision attribution ingest secrets', () => {
    expect(
      parseConfig({ ...configFixture, VCE_VISION_ATTRIBUTION_INGEST_SECRET: 'x'.repeat(64) })
        .VCE_VISION_ATTRIBUTION_INGEST_SECRET,
    ).toHaveLength(64);
    expect(() =>
      parseConfig({ ...configFixture, VCE_VISION_ATTRIBUTION_INGEST_SECRET: 'too-short' }),
    ).toThrow('VCE_VISION_ATTRIBUTION_INGEST_SECRET');
  });
  it('does not reflect secret-bearing input values in validation errors', () => {
    expect(() =>
      parseConfig({ ...configFixture, DATABASE_URL: 'invalid-sensitive-value' }),
    ).toThrow('Invalid runtime configuration fields: DATABASE_URL');
  });
  it('keeps LOCAL fake-only while permitting explicit nonlocal Phase 11 activation', () => {
    const localReal = parseConfig({
      ...configFixture,
      VCE_REAL_PROVIDERS_ENABLED: 'true',
    });

    expect(localReal.VCE_REAL_PROVIDERS_ENABLED).toBe('true');
    expect(isRealProviderActivationEnabled(localReal)).toBe(false);
    expect(() => assertLocalBootstrap(localReal)).toThrow();

    const productionReal = parseConfig({
      ...configFixture,
      VCE_ENV: 'PRODUCTION',
      VCE_REAL_PROVIDERS_ENABLED: 'true',
    });

    expect(isRealProviderActivationEnabled(productionReal)).toBe(true);

    expect(() =>
      parseConfig({
        ...configFixture,
        VCE_ENV: 'PRODUCTION',
        VCE_REAL_PROVIDERS_ENABLED: 'TRUE',
      }),
    ).toThrow('VCE_REAL_PROVIDERS_ENABLED');

    expect(() =>
      assertLocalBootstrap(parseConfig({ ...configFixture, VCE_ENV: 'PRODUCTION' })),
    ).toThrow();

    expect(() =>
      assertLocalBootstrap(
        parseConfig({ ...configFixture, S3_ENDPOINT: 'https://storage.example.test' }),
      ),
    ).toThrow();

    expect(() => assertLocalBootstrap(parseConfig(configFixture))).not.toThrow();
  });
});

it('validates finite capacity configuration with conservative local defaults', () => {
  const defaults = parseConfig(configFixture);
  expect(defaults.VCE_MIN_LOCAL_FREE_BYTES).toBe(256 * 1024 * 1024);
  expect(defaults.VCE_MAX_UPLOAD_BYTES).toBe(512 * 1024 * 1024);
  expect(defaults.VCE_MAX_ARTIFACT_BYTES).toBe(512 * 1024 * 1024);
  for (const key of [
    'VCE_MIN_LOCAL_FREE_BYTES',
    'VCE_MAX_UPLOAD_BYTES',
    'VCE_MAX_ARTIFACT_BYTES',
  ]) {
    for (const value of ['0', '-1', 'NaN', 'Infinity', '1.5', '9007199254740992'])
      expect(() => parseConfig({ ...configFixture, [key]: value })).toThrow(key);
  }
  expect(parseConfig({ ...configFixture, VCE_MAX_UPLOAD_BYTES: '1024' }).VCE_MAX_UPLOAD_BYTES).toBe(
    1024,
  );
});
