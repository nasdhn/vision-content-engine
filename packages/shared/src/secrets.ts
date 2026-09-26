import { lstat } from 'node:fs/promises';
import { isAbsolute } from 'node:path';

// Existing bootstrap names; provider names are explicit runtime-only additions, not activation flags.
export const SECRET_IDS = [
  'DATABASE_URL',
  'REDIS_URL',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
  'VCE_LOCAL_ACCESS_KEY',
  'VCE_VISION_ATTRIBUTION_INGEST_SECRET',
  'GROQ_API_KEY',
  'INSTAGRAM_ACCESS_TOKEN',
  'YOUTUBE_ACCESS_TOKEN',
  'UMAMI_BEARER_TOKEN',
  'CAPTURE_STORAGE_STATE_PATH',
] as const;
export type SecretId = (typeof SECRET_IDS)[number];
export interface SecretResolver {
  resolve(id: SecretId): string;
}

/** Runtime-only capability object. Never include it in DTOs, queue jobs or persistence inputs. */
export class EnvironmentSecretResolver implements SecretResolver {
  #environment: Readonly<Record<string, string | undefined>>;
  #allowed: ReadonlySet<SecretId>;

  constructor(
    environment: Readonly<Record<string, string | undefined>>,
    allowed: readonly SecretId[],
  ) {
    if (allowed.some((id) => !SECRET_IDS.includes(id)))
      throw new Error('UNKNOWN_SECRET_IDENTIFIER');
    this.#environment = environment;
    this.#allowed = new Set(allowed);
  }

  resolve(id: SecretId): string {
    if (!SECRET_IDS.includes(id)) throw new Error('UNKNOWN_SECRET_IDENTIFIER');
    if (!this.#allowed.has(id)) throw new Error('SECRET_ACCESS_DENIED');
    let value: string | undefined;
    try {
      value = this.#environment[id];
    } catch {
      throw new Error('SECRET_SOURCE_UNAVAILABLE');
    }
    if (typeof value !== 'string' || !value.trim() || value === 'GENERATED_BY_LOCAL_INIT') {
      throw new Error('REQUIRED_SECRET_MISSING');
    }
    return value;
  }

  toJSON(): never {
    throw new Error('SECRET_RESOLVER_NOT_SERIALIZABLE');
  }
}

// These factories match the existing provider-specific DI interfaces structurally.
// They do not select adapters, enable providers or accept account IDs from jobs as secret IDs.
function required(secrets: SecretResolver, id: SecretId) {
  try {
    const value = secrets.resolve(id);
    if (typeof value !== 'string' || !value.trim()) throw new Error();
    return value;
  } catch {
    throw new Error('REQUIRED_SECRET_UNAVAILABLE');
  }
}

export function groqApiKeyProvider(secrets: SecretResolver) {
  return () => required(secrets, 'GROQ_API_KEY');
}

export function accountCredentialResolver(
  secrets: SecretResolver,
  id: 'INSTAGRAM_ACCESS_TOKEN' | 'YOUTUBE_ACCESS_TOKEN',
  accountId: string,
  metadata: { expiresAt?: string; grantedScopes?: readonly string[] } = {},
) {
  const expiresAt = metadata.expiresAt;
  const grantedScopes = Object.freeze([...(metadata.grantedScopes ?? [])]);
  return {
    async resolve(requestedAccountId: string) {
      if (requestedAccountId !== accountId) throw new Error('CREDENTIAL_ACCOUNT_MISMATCH');
      return {
        accessToken: required(secrets, id),
        grantedScopes,
        ...(expiresAt === undefined ? {} : { expiresAt }),
      };
    },
  };
}

export function umamiCredentialResolver(
  secrets: SecretResolver,
  endpoint: string,
  websiteId: string,
) {
  return {
    resolve: () => ({ endpoint, websiteId, bearerToken: required(secrets, 'UMAMI_BEARER_TOKEN') }),
  };
}

export function s3CredentialProvider(secrets: SecretResolver) {
  return async () => ({
    accessKeyId: required(secrets, 'S3_ACCESS_KEY_ID'),
    secretAccessKey: required(secrets, 'S3_SECRET_ACCESS_KEY'),
  });
}

export function captureAuthStateProvider(secrets: SecretResolver, authProfileKey: string) {
  return {
    async storageStatePath(requestedProfileKey: string) {
      if (requestedProfileKey !== authProfileKey) throw new Error('CAPTURE_AUTH_PROFILE_MISMATCH');
      const path = required(secrets, 'CAPTURE_STORAGE_STATE_PATH');
      try {
        if (!isAbsolute(path)) throw new Error();
        const info = await lstat(path);
        if (!info.isFile() || (info.mode & 0o077) !== 0 || info.size > 1_048_576) throw new Error();
      } catch {
        throw new Error('CAPTURE_AUTH_STATE_UNAVAILABLE');
      }
      return path;
    },
  };
}
