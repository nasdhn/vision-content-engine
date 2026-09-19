import { z } from 'zod';

const boolean = z.enum(['true', 'false']).transform((value) => value === 'true');
const secret = z
  .string()
  .min(1)
  .refine((value) => value !== 'GENERATED_BY_LOCAL_INIT');
const url = (protocols: string[]) =>
  z
    .string()
    .url()
    .refine((value) => {
      const parsed = URL.parse(value);
      return parsed !== null && protocols.includes(parsed.protocol);
    });

const environmentSchema = z
  .object({
    VCE_ENV: z.enum(['LOCAL', 'STAGING_CAPTURE', 'PRODUCTION']).default('LOCAL'),
    VCE_API_HOST: z.literal('127.0.0.1').default('127.0.0.1'),
    VCE_API_PORT: z.coerce.number().int().min(1024).max(65535).default(3100),
    DATABASE_URL: url(['postgresql:', 'postgres:']),
    REDIS_URL: url(['redis:', 'rediss:']),
    S3_ENDPOINT: url(['http:', 'https:']),
    S3_REGION: z.string().min(1),
    S3_BUCKET: z.string().regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/),
    S3_ACCESS_KEY_ID: secret,
    S3_SECRET_ACCESS_KEY: secret,
    PAUSE_ALL_PUBLISHING: boolean.default(true),
    PAUSE_AI_GENERATION: boolean.default(true),
    PAUSE_CAPTURE: boolean.default(true),
    PAUSE_RENDERING: boolean.default(true),
    PAUSE_ANALYTICS_COLLECTION: boolean.default(true),
    VCE_REAL_PROVIDERS_ENABLED: z.literal('false').default('false'),
  })
  .strict();

export type RuntimeConfig = z.infer<typeof environmentSchema>;

/** The only environment-to-runtime boundary. Errors never include supplied values. */
export function parseConfig(
  environment: Readonly<Record<string, string | undefined>>,
): RuntimeConfig {
  const keys = Object.keys(environmentSchema.shape);
  if (Object.keys(environment).some((key) => /^(VCE_|PAUSE_)/.test(key) && !keys.includes(key))) {
    throw new Error('Unknown application configuration key');
  }
  const input = Object.fromEntries(keys.map((key) => [key, environment[key]]));
  const result = environmentSchema.safeParse(input);
  if (!result.success) {
    const fields = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))];
    throw new Error(`Invalid runtime configuration fields: ${fields.join(', ')}`);
  }
  return Object.freeze(result.data);
}

/** Phase 0 has no production auth or remote providers; only loopback dependencies are allowed. */
export function assertLocalBootstrap(config: RuntimeConfig): void {
  const endpoints = [config.DATABASE_URL, config.REDIS_URL, config.S3_ENDPOINT];
  if (
    config.VCE_ENV !== 'LOCAL' ||
    endpoints.some(
      (endpoint) => !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(endpoint).hostname),
    )
  ) {
    throw new Error('Phase 0 bootstrap requires LOCAL loopback dependencies');
  }
}
