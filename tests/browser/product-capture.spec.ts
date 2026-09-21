import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { CaptureScenarioRegistry } from '../../packages/application/src/index.js';
import { probeFile } from '../../packages/media/src/index.js';
import {
  executeCaptureScenario,
  type CaptureAuthStateProvider,
  type CaptureFixtureManager,
} from '../../apps/worker-capture/src/index.js';

const captureOrigin = 'http:' + '//127.0.0.1:3201';

class LocalCaptureFixtureManager implements CaptureFixtureManager {
  prepareCount = 0;
  cleanupCount = 0;

  async prepare() {
    this.prepareCount++;

    return {
      runtimeEnvironment: {
        baseUrl: captureOrigin,
        allowedOrigins: [captureOrigin],
      },
      cleanup: async () => {
        this.cleanupCount++;
      },
    };
  }
}

const noAuthState: CaptureAuthStateProvider = {
  async storageStatePath() {
    return undefined;
  },
};

test.describe('Phase 4 Product Capture worker', () => {
  test('executes AGENT_QUERY_TO_RESULTS against the deterministic local Vision fixture', async () => {
    test.setTimeout(60_000);

    const outputDirectory = await mkdtemp(join(tmpdir(), 'vce-product-capture-'));

    const fixtureManager = new LocalCaptureFixtureManager();

    try {
      const registry = new CaptureScenarioRegistry();
      const resolved = await registry.getByKey('AGENT_QUERY_TO_RESULTS');

      const result = await executeCaptureScenario({
        scenario: resolved.spec,
        input: {
          query: 'Trouve-moi des entreprises à Lyon',
        },
        outputDirectory,
        fixtureManager,
        authStateProvider: noAuthState,
      });

      expect(result.result).toBe('SUCCEEDED');
      expect(result.failureCode).toBeUndefined();

      expect(result.executedStepCount).toBe(resolved.spec.steps.length);

      expect(fixtureManager.prepareCount).toBe(1);
      expect(fixtureManager.cleanupCount).toBe(1);

      expect(result.diagnostics.currentUrl).toBe(`${captureOrigin}/agent`);

      expect(result.assertions).toContainEqual({
        key: 'step-1-VISIBLE',
        result: 'PASS',
      });

      expect(result.markedMoments).toHaveLength(1);

      const resultMoment = result.markedMoments[0];

      expect(resultMoment).toMatchObject({
        key: 'RESULT_VISIBLE',
        editorialMeaning: 'First stable moment where the result list is visible.',
      });

      expect(resultMoment?.atMs).toBeGreaterThanOrEqual(0);

      const screenshot = result.files.find(
        (file) => file.key === 'results' && file.role === 'SCREENSHOT' && !file.diagnostic,
      );

      expect(screenshot).toBeDefined();

      const screenshotStat = await stat(screenshot!.path);

      expect(screenshotStat.isFile()).toBe(true);
      expect(screenshotStat.size).toBeGreaterThan(100);

      const video = result.files.find(
        (file) => file.key === 'video' && file.role === 'VIDEO' && !file.diagnostic,
      );

      expect(video).toBeDefined();

      const videoStat = await stat(video!.path);

      expect(videoStat.isFile()).toBe(true);
      expect(videoStat.size).toBeGreaterThan(100);

      /*
       * executeCaptureScenario() only resolves the video output after
       * BrowserContext.close(). A successful ffprobe here therefore also
       * proves that the returned Playwright video is finalized/readable.
       */
      const probe = await probeFile(video!.path);

      expect(probe.durationMs).toBeGreaterThan(0);
      expect(probe.video).toBeDefined();
      expect(probe.video?.width).toBe(
        resolved.spec.browser.recordVideoSize?.width ?? resolved.spec.browser.viewport.width,
      );
      expect(probe.video?.height).toBe(
        resolved.spec.browser.recordVideoSize?.height ?? resolved.spec.browser.viewport.height,
      );

      expect(result.files.filter((file) => !file.diagnostic)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            key: 'results',
            role: 'SCREENSHOT',
          }),
          expect.objectContaining({
            key: 'video',
            role: 'VIDEO',
          }),
        ]),
      );
    } finally {
      await rm(outputDirectory, {
        recursive: true,
        force: true,
      });
    }
  });
});
