import { inspect } from 'node:util';
import { mkdtemp, writeFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  EnvironmentSecretResolver,
  accountCredentialResolver,
  captureAuthStateProvider,
  s3CredentialProvider,
  umamiCredentialResolver,
} from '../../packages/shared/src/secrets.js';
import type { SecretId, SecretResolver } from '../../packages/shared/src/secrets.js';
import { assertNoSecrets } from '../../packages/contracts/src/canonical.js';
import { AIProviderGateway } from '../../packages/ai/src/gateway.js';
import type { StructuredProvider } from '../../packages/ai/src/gateway.js';
import { InvocationRepository } from '../../packages/database/src/index.js';

const sentinel = ['VERY', 'FAKE', 'RUNTIME', 'CREDENTIAL', 'DO_NOT_USE'].join('_');

describe('Phase 10B secret boundary', () => {
  it('resolves only known authorized identifiers and reads the current value without caching', () => {
    const environment = { INSTAGRAM_ACCESS_TOKEN: sentinel };
    const resolver = new EnvironmentSecretResolver(environment, ['INSTAGRAM_ACCESS_TOKEN']);
    expect(resolver.resolve('INSTAGRAM_ACCESS_TOKEN')).toBe(sentinel);
    environment.INSTAGRAM_ACCESS_TOKEN = `${sentinel}_ROTATED`;
    expect(resolver.resolve('INSTAGRAM_ACCESS_TOKEN')).toBe(`${sentinel}_ROTATED`);
    expect(() => resolver.resolve('YOUTUBE_ACCESS_TOKEN')).toThrow('SECRET_ACCESS_DENIED');
    expect(() => resolver.resolve('UNSUPPORTED' as SecretId)).toThrow('UNKNOWN_SECRET_IDENTIFIER');
    expect(() => new EnvironmentSecretResolver({}, ['UNSUPPORTED' as SecretId])).toThrow(
      'UNKNOWN_SECRET_IDENTIFIER',
    );
    expect(() => JSON.stringify(resolver)).toThrow('SECRET_RESOLVER_NOT_SERIALIZABLE');
    expect(inspect(resolver)).not.toContain(sentinel);
  });

  it('does not require disabled provider secrets at construction and fails closed on missing values', () => {
    for (const value of [undefined, '', '  ', 'GENERATED_BY_LOCAL_INIT']) {
      const resolver = new EnvironmentSecretResolver({ UMAMI_BEARER_TOKEN: value }, [
        'UMAMI_BEARER_TOKEN',
      ]);
      expect(() => resolver.resolve('UMAMI_BEARER_TOKEN')).toThrow('REQUIRED_SECRET_MISSING');
    }
    const resolver = new EnvironmentSecretResolver(
      {
        get UMAMI_BEARER_TOKEN(): string {
          throw new Error(sentinel);
        },
      },
      ['UMAMI_BEARER_TOKEN'],
    );
    expect(() => resolver.resolve('UMAMI_BEARER_TOKEN')).toThrow('SECRET_SOURCE_UNAVAILABLE');
  });

  it('resolves at adapter invocation only, enforces account binding and never logs credentials', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const resolve = vi.fn(() => sentinel);
      const resolver = { resolve };
      const account = accountCredentialResolver(resolver, 'YOUTUBE_ACCESS_TOKEN', 'account-1', {
        grantedScopes: ['analytics-scope'],
      });
      const umami = umamiCredentialResolver(
        resolver,
        'https://stats.example.test/api',
        'website-1',
      );
      const storage = s3CredentialProvider(resolver);
      expect(resolve).not.toHaveBeenCalled();
      await expect(account.resolve('other-account')).rejects.toThrow('CREDENTIAL_ACCOUNT_MISMATCH');
      expect(resolve).not.toHaveBeenCalled();
      expect((await account.resolve('account-1')).accessToken).toBe(sentinel);
      expect(umami.resolve().bearerToken).toBe(sentinel);
      expect((await storage()).secretAccessKey).toBe(sentinel);
      expect(resolve.mock.calls).toHaveLength(4);
      expect(log).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
      error.mockRestore();
    }
  });

  it('does not propagate secret-bearing resolver exceptions through adapter factories', async () => {
    const resolver: SecretResolver = {
      resolve() {
        throw new Error(sentinel);
      },
    };
    await expect(
      accountCredentialResolver(resolver, 'INSTAGRAM_ACCESS_TOKEN', 'account').resolve('account'),
    ).rejects.toThrow('REQUIRED_SECRET_UNAVAILABLE');
    await expect(s3CredentialProvider(resolver)()).rejects.toThrow('REQUIRED_SECRET_UNAVAILABLE');
    expect(() => umamiCredentialResolver(resolver, 'endpoint', 'site').resolve()).toThrow(
      'REQUIRED_SECRET_UNAVAILABLE',
    );
  });

  it('loads only the configured private capture-state file, without reading or serializing its contents', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'vce-secret-boundary-'));
    try {
      const path = join(directory, 'state.json');
      await writeFile(path, JSON.stringify({ cookies: [{ value: sentinel }] }), { mode: 0o600 });
      const resolver = new EnvironmentSecretResolver({ CAPTURE_STORAGE_STATE_PATH: path }, [
        'CAPTURE_STORAGE_STATE_PATH',
      ]);
      const auth = captureAuthStateProvider(resolver, 'profile');
      await expect(auth.storageStatePath('other')).rejects.toThrow('CAPTURE_AUTH_PROFILE_MISMATCH');
      expect(await auth.storageStatePath('profile')).toBe(path);
      expect(JSON.stringify(auth)).not.toContain(sentinel);
      await chmod(path, 0o644);
      await expect(auth.storageStatePath('profile')).rejects.toThrow(
        'CAPTURE_AUTH_STATE_UNAVAILABLE',
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('rejects credential fields recursively while allowing non-secret business references', () => {
    for (const key of [
      'password',
      'accessToken',
      'refreshToken',
      'Authorization',
      'api_key',
      'cookies',
      'storageState',
      'storageStatePath',
      'credentials',
    ]) {
      expect(() => assertNoSecrets({ nested: [{ [key]: sentinel }] })).toThrow('SECRET_IN_CONTEXT');
    }
    expect(() =>
      assertNoSecrets({
        credentialsRef: 'instagram-primary',
        authProfileKey: 'capture-profile',
        credentialsConfigured: true,
      }),
    ).not.toThrow();
  });

  it('keeps the AI gateway fake-only instead of inventing a live credential path', () => {
    expect(
      () =>
        new AIProviderGateway(
          {} as InvocationRepository,
          [{ kind: 'REAL' } as unknown as StructuredProvider],
          () => false,
        ),
    ).toThrow('REAL_PROVIDERS_DISABLED');
  });
});

it('rejects credentials before ModelInvocation persistence is attempted', async () => {
  const transaction = vi.fn();
  const repository = new InvocationRepository({ $transaction: transaction } as never);
  await expect(repository.begin({ policy: { accessToken: sentinel } } as never)).rejects.toThrow(
    'SECRET_IN_CONTEXT',
  );
  await expect(
    repository.finishAttempt('unused', { validation: { cookies: sentinel } } as never),
  ).rejects.toThrow('SECRET_IN_CONTEXT');
  expect(transaction).not.toHaveBeenCalled();
});
