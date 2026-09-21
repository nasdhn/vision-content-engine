import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { CaptureScenarioRegistry } from '../../packages/application/src/index.js';
import {
  executeCaptureScenario,
  type CaptureAuthStateProvider,
  type CaptureFixtureManager,
} from '../../apps/worker-capture/src/index.js';

const captureOrigin = 'http:' + '//127.0.0.1:3201';

class LocalCaptureFixtureManager implements CaptureFixtureManager {
  async prepare() {
    return {
      runtimeEnvironment: {
        baseUrl: captureOrigin,
        allowedOrigins: [captureOrigin],
      },
    };
  }
}

const noAuthState: CaptureAuthStateProvider = {
  async storageStatePath() {
    return undefined;
  },
};

const registry = new CaptureScenarioRegistry();

async function scenarioWithSteps(steps: unknown[]) {
  const resolved = await registry.getByKey('AGENT_QUERY_TO_RESULTS');

  const spec = structuredClone(resolved.spec);

  return {
    ...spec,
    browser: {
      ...spec.browser,
      recordVideo: false,
    },
    steps,
    outputs: [],
    assertions: [],
  };
}

async function runCapture(
  scenario: unknown,
  authStateProvider: CaptureAuthStateProvider = noAuthState,
) {
  const outputDirectory = await mkdtemp(join(tmpdir(), 'vce-capture-safety-'));

  try {
    const result = await executeCaptureScenario({
      scenario,
      input: {
        query: 'fixture',
      },
      outputDirectory,
      fixtureManager: new LocalCaptureFixtureManager(),
      authStateProvider,
    });

    return {
      result,
      outputDirectory,
      async cleanup() {
        await rm(outputDirectory, {
          recursive: true,
          force: true,
        });
      },
    };
  } catch (error) {
    await rm(outputDirectory, {
      recursive: true,
      force: true,
    });

    throw error;
  }
}

test.describe('Phase 4 Product Capture runtime safety', () => {
  test('uses a fresh browser context with no cookie, localStorage or sessionStorage leakage', async () => {
    const scenario = await scenarioWithSteps([
      {
        type: 'NAVIGATE',
        path: '/isolation',
        waitUntil: 'DOM_CONTENT_LOADED',
      },
      {
        type: 'ASSERT',
        assertion: {
          kind: 'TEXT_CONTAINS',
          locator: {
            strategy: 'TEST_ID',
            value: 'isolation-state',
          },
          literal: 'clean',
        },
      },
    ]);

    const first = await runCapture(scenario);

    try {
      expect(first.result.result).toBe('SUCCEEDED');
    } finally {
      await first.cleanup();
    }

    const second = await runCapture(scenario);

    try {
      expect(second.result.result).toBe('SUCCEEDED');
    } finally {
      await second.cleanup();
    }
  });

  test('loads secret-backed Playwright storage state through the auth provider boundary', async () => {
    const scenario = await scenarioWithSteps([
      {
        type: 'NAVIGATE',
        path: '/auth-state',
        waitUntil: 'DOM_CONTENT_LOADED',
      },
      {
        type: 'ASSERT',
        assertion: {
          kind: 'TEXT_CONTAINS',
          locator: {
            strategy: 'TEST_ID',
            value: 'auth-state',
          },
          literal: 'ready',
        },
      },
    ]);

    const stateDirectory = await mkdtemp(join(tmpdir(), 'vce-capture-auth-'));

    const statePath = join(stateDirectory, 'storage-state.json');

    await writeFile(
      statePath,
      JSON.stringify({
        cookies: [
          {
            name: 'vce-auth',
            value: 'ready',
            domain: '127.0.0.1',
            path: '/',
            expires: -1,
            httpOnly: false,
            secure: false,
            sameSite: 'Lax',
          },
        ],
        origins: [
          {
            origin: captureOrigin,
            localStorage: [
              {
                name: 'vce-auth',
                value: 'ready',
              },
            ],
          },
        ],
      }),
      {
        mode: 0o600,
      },
    );

    const authProvider: CaptureAuthStateProvider = {
      async storageStatePath() {
        return statePath;
      },
    };

    try {
      const capture = await runCapture(scenario, authProvider);

      try {
        expect(capture.result.result).toBe('SUCCEEDED');
      } finally {
        await capture.cleanup();
      }
    } finally {
      await rm(stateDirectory, {
        recursive: true,
        force: true,
      });
    }
  });

  test('blocks prohibited Vision paths before navigation', async () => {
    const scenario = await scenarioWithSteps([
      {
        type: 'NAVIGATE',
        path: '/admin',
        waitUntil: 'DOM_CONTENT_LOADED',
      },
    ]);

    const capture = await runCapture(scenario);

    try {
      expect(capture.result).toMatchObject({
        result: 'FAILED',
        failureCode: 'CAPTURE_PROHIBITED_PATH',
        executedStepCount: 0,
      });

      const diagnosticScreenshot = capture.result.files.find(
        (file) => file.role === 'SCREENSHOT' && file.diagnostic,
      );

      const diagnosticTrace = capture.result.files.find(
        (file) => file.role === 'TRACE' && file.diagnostic,
      );

      expect(diagnosticScreenshot).toBeDefined();
      expect(diagnosticTrace).toBeDefined();

      expect((await stat(diagnosticScreenshot!.path)).size).toBeGreaterThan(100);

      expect((await stat(diagnosticTrace!.path)).size).toBeGreaterThan(100);
    } finally {
      await capture.cleanup();
    }
  });

  test('blocks a document redirect outside the allowed origin', async () => {
    const scenario = await scenarioWithSteps([
      {
        type: 'NAVIGATE',
        path: '/redirect-blocked',
        waitUntil: 'DOM_CONTENT_LOADED',
      },
    ]);

    const capture = await runCapture(scenario);

    try {
      expect(capture.result.result).toBe('FAILED');
      expect(capture.result.failureCode).toBe('CAPTURE_ORIGIN_BLOCKED');
    } finally {
      await capture.cleanup();
    }
  });

  test('blocks popup creation', async () => {
    const scenario = await scenarioWithSteps([
      {
        type: 'NAVIGATE',
        path: '/popup',
        waitUntil: 'DOM_CONTENT_LOADED',
      },
      {
        type: 'CLICK',
        locator: {
          strategy: 'TEST_ID',
          value: 'open-popup',
        },
      },
      {
        type: 'VISUAL_SETTLE',
        durationMs: 100,
        reason: 'Allow the popup event to be observed.',
      },
    ]);

    const capture = await runCapture(scenario);

    try {
      expect(capture.result.result).toBe('FAILED');
      expect(capture.result.failureCode).toBe('CAPTURE_POPUP_BLOCKED');
    } finally {
      await capture.cleanup();
    }
  });

  test('blocks downloads', async () => {
    const scenario = await scenarioWithSteps([
      {
        type: 'NAVIGATE',
        path: '/download',
        waitUntil: 'DOM_CONTENT_LOADED',
      },
      {
        type: 'CLICK',
        locator: {
          strategy: 'TEST_ID',
          value: 'start-download',
        },
      },
      {
        type: 'VISUAL_SETTLE',
        durationMs: 100,
        reason: 'Allow the download event to be observed.',
      },
    ]);

    const capture = await runCapture(scenario);

    try {
      expect(capture.result.result).toBe('FAILED');
      expect(capture.result.failureCode).toBe('CAPTURE_DOWNLOAD_BLOCKED');
    } finally {
      await capture.cleanup();
    }
  });
});
