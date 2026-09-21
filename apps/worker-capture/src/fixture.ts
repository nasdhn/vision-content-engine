import type { CaptureFixturePolicySchema } from '@vision/contracts';

export type CaptureFixturePolicy = ReturnType<typeof CaptureFixturePolicySchema.parse>;

export type CaptureRuntimeEnvironment = {
  /**
   * Trusted runtime override used by deterministic/local fixtures.
   *
   * This is runtime configuration, never scenario/AI data.
   * Production fixtures normally leave it undefined and therefore use
   * the immutable environment declared by CaptureScenarioVersion.
   */
  baseUrl: string;
  allowedOrigins: readonly string[];
};

export type PreparedFixture = {
  runtimeEnvironment?: CaptureRuntimeEnvironment;
  cleanup?: () => Promise<void>;
};

export interface CaptureFixtureManager {
  prepare(
    policy: CaptureFixturePolicy,
    input: Readonly<Record<string, unknown>>,
  ): Promise<PreparedFixture>;
}

export interface CaptureAuthStateProvider {
  /**
   * Returns a secret-backed Playwright storage-state file path.
   * The path itself is runtime configuration and never scenario data.
   */
  storageStatePath(authProfileKey: string): Promise<string | undefined>;
}
