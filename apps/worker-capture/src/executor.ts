import { tmpdir } from 'node:os';
import { CapacityGuard, CAPACITY_SCRATCH_BYTES } from '@vision/media';
import { mkdir, open, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from 'playwright';
import { CaptureScenarioVersionSpecSchema } from '@vision/contracts';
import type { CaptureAssertionSchema, CaptureLocatorSchema } from '@vision/contracts';
import { DomainError, invariant } from '@vision/domain';
import type {
  CaptureAuthStateProvider,
  CaptureFixtureManager,
  PreparedFixture,
} from './fixture.js';

export const CAPTURE_PLAYWRIGHT_VERSION = '1.63.0';
export const CAPTURE_WORKER_VERSION = 'phase4-v1';

type CaptureScenarioSpec = ReturnType<typeof CaptureScenarioVersionSpecSchema.parse>;
type CaptureLocator = ReturnType<typeof CaptureLocatorSchema.parse>;
type CaptureAssertion = ReturnType<typeof CaptureAssertionSchema.parse>;

export type CaptureLocalOutput = {
  key: string;
  role: 'SCREENSHOT' | 'VIDEO' | 'FRAME' | 'TRACE';
  path: string;
  required: boolean;
  diagnostic: boolean;
};

export type CaptureExecutionResult = {
  result: 'SUCCEEDED' | 'FAILED';
  failureCode?: string;
  executedStepCount: number;
  assertions: {
    key: string;
    result: 'PASS' | 'FAIL';
    message?: string;
  }[];
  markedMoments: {
    key: string;
    atMs: number;
    editorialMeaning: string;
  }[];
  files: CaptureLocalOutput[];
  warnings: string[];
  diagnostics: {
    failedStepIndex?: number;
    currentUrl?: string | undefined;
    consoleErrorCount: number;
    pageErrorCount: number;
    requestFailureCount: number;
  };
  runtime: {
    playwrightVersion: string;
    browserVersion: string;
    workerVersion: string;
  };
};

export type CaptureExecutorInput = {
  scenario: unknown;
  input: Readonly<Record<string, unknown>>;
  outputDirectory: string;
  fixtureManager: CaptureFixtureManager;
  authStateProvider: CaptureAuthStateProvider;
  capacity?: CapacityGuard;
};

function safeFilename(value: string) {
  const result = value.replace(/[^A-Za-z0-9._-]/g, '_');
  invariant(result.length > 0, 'CAPTURE_OUTPUT_KEY_INVALID');
  return result;
}

function safeCurrentUrl(page?: Page) {
  if (!page) return undefined;
  try {
    const url = new URL(page.url());
    return `${url.origin}${url.pathname}`;
  } catch {
    return page.url() === 'about:blank' ? 'about:blank' : undefined;
  }
}

function globMatches(value: string, pattern: string) {
  const escaped = pattern
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');

  return new RegExp(`^${escaped}$`).test(value);
}

function validateScenarioInput(
  schema: Record<string, unknown>,
  input: Readonly<Record<string, unknown>>,
) {
  const required = Array.isArray(schema.required)
    ? schema.required.filter((value): value is string => typeof value === 'string')
    : [];

  for (const key of required) {
    invariant(Object.hasOwn(input, key), 'CAPTURE_REQUIRED_INPUT_MISSING');
  }

  if (
    !schema.properties ||
    typeof schema.properties !== 'object' ||
    Array.isArray(schema.properties)
  )
    return;

  for (const [key, definition] of Object.entries(schema.properties as Record<string, unknown>)) {
    if (!Object.hasOwn(input, key)) continue;

    if (!definition || typeof definition !== 'object' || Array.isArray(definition)) continue;

    const rules = definition as Record<string, unknown>;
    const value = input[key];

    if (rules.type === 'string') {
      invariant(typeof value === 'string', 'CAPTURE_INPUT_TYPE_INVALID');

      if (typeof rules.minLength === 'number') {
        invariant(value.length >= rules.minLength, 'CAPTURE_INPUT_TOO_SHORT');
      }
    }
  }
}

function locate(page: Page, descriptor: CaptureLocator): Locator {
  switch (descriptor.strategy) {
    case 'ROLE': {
      const options: { name?: string; exact?: boolean } = {};

      if (descriptor.name !== undefined) options.name = descriptor.name;
      if (descriptor.exact !== undefined) options.exact = descriptor.exact;

      return page.getByRole(descriptor.role as Parameters<Page['getByRole']>[0], options);
    }

    case 'LABEL':
      return page.getByLabel(descriptor.text, {
        ...(descriptor.exact !== undefined ? { exact: descriptor.exact } : {}),
      });

    case 'TEST_ID':
      return page.getByTestId(descriptor.value);

    case 'TEXT':
      return page.getByText(descriptor.text, { exact: descriptor.exact });
  }
}

function inputValue(input: Readonly<Record<string, unknown>>, key: string): string {
  const value = input[key];

  invariant(typeof value === 'string', 'CAPTURE_INPUT_VALUE_INVALID');

  return value;
}

function safeTarget(spec: CaptureScenarioSpec, target: URL, allowedOrigins: readonly string[]) {
  invariant(allowedOrigins.includes(target.origin), 'CAPTURE_ORIGIN_BLOCKED');

  invariant(
    !spec.safety.prohibitedPathPatterns.some(
      (pattern) => target.pathname === pattern || target.pathname.startsWith(`${pattern}/`),
    ),
    'CAPTURE_PROHIBITED_PATH',
  );
}

function enforceCurrentPageSafety(
  spec: CaptureScenarioSpec,
  page: Page,
  allowedOrigins: readonly string[],
) {
  const current = page.url();

  if (current === 'about:blank') return;

  safeTarget(spec, new URL(current), allowedOrigins);
}

function waitUntil(
  value: 'COMMIT' | 'DOM_CONTENT_LOADED' | 'LOAD',
): 'commit' | 'domcontentloaded' | 'load' {
  switch (value) {
    case 'COMMIT':
      return 'commit';
    case 'DOM_CONTENT_LOADED':
      return 'domcontentloaded';
    case 'LOAD':
      return 'load';
  }
}

function playwrightKey(value: 'ENTER' | 'ESCAPE' | 'TAB'): 'Enter' | 'Escape' | 'Tab' {
  switch (value) {
    case 'ENTER':
      return 'Enter';
    case 'ESCAPE':
      return 'Escape';
    case 'TAB':
      return 'Tab';
  }
}

async function validatePng(path: string, viewport: boolean, spec: CaptureScenarioSpec) {
  const info = await stat(path);
  invariant(info.size > 100, 'CAPTURE_SCREENSHOT_EMPTY');
  const handle = await open(path, 'r');
  const bytes = Buffer.alloc(24);
  try {
    const read = await handle.read(bytes, 0, 24, 0);
    invariant(read.bytesRead === 24, 'CAPTURE_SCREENSHOT_INVALID');
  } finally {
    await handle.close();
  }

  invariant(
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
    'CAPTURE_SCREENSHOT_INVALID',
  );

  invariant(bytes.length >= 24, 'CAPTURE_SCREENSHOT_INVALID');

  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);

  invariant(width > 0 && height > 0, 'CAPTURE_SCREENSHOT_INVALID');

  if (viewport) {
    invariant(
      width === spec.browser.viewport.width && height === spec.browser.viewport.height,
      'CAPTURE_SCREENSHOT_GEOMETRY_MISMATCH',
    );
  }
}

async function runAssertion(
  page: Page,
  assertion: CaptureAssertion,
  input: Readonly<Record<string, unknown>>,
  timeout: number,
) {
  switch (assertion.kind) {
    case 'VISIBLE':
      await locate(page, assertion.locator).waitFor({
        state: 'visible',
        timeout,
      });
      return;

    case 'TEXT_CONTAINS': {
      const expected =
        assertion.literal ??
        (assertion.valueFromInput ? inputValue(input, assertion.valueFromInput) : undefined);

      invariant(expected !== undefined, 'CAPTURE_ASSERTION_VALUE_MISSING');

      const target = locate(page, assertion.locator);

      await target.waitFor({ state: 'visible', timeout });

      const text = (await target.textContent()) ?? '';

      invariant(text.includes(expected), 'CAPTURE_ASSERTION_FAILED');
      return;
    }

    case 'URL_MATCHES':
      invariant(globMatches(page.url(), assertion.pattern), 'CAPTURE_ASSERTION_FAILED');
  }
}

function failureCode(error: unknown, deadline: number) {
  if (error instanceof DomainError) return error.code;

  if (Date.now() >= deadline) return 'CAPTURE_TIMEOUT';

  return 'CAPTURE_STEP_FAILED';
}

export async function executeCaptureScenario(
  request: CaptureExecutorInput,
): Promise<CaptureExecutionResult> {
  const scenario = CaptureScenarioVersionSpecSchema.parse(request.scenario);

  invariant(scenario.safety.blockDownloads, 'CAPTURE_DOWNLOAD_UNBOUNDED');
  validateScenarioInput(scenario.inputSchema as Record<string, unknown>, request.input);

  const capacity = request.capacity ?? new CapacityGuard();
  await capacity.require(
    request.outputDirectory,
    CAPACITY_SCRATCH_BYTES + capacity.policy.maxArtifactBytes * (scenario.outputs.length + 3),
  );
  await capacity.require(tmpdir(), CAPACITY_SCRATCH_BYTES);
  await mkdir(request.outputDirectory, {
    recursive: true,
    mode: 0o700,
  });

  const screenshotsDirectory = join(request.outputDirectory, 'screenshots');
  const videoDirectory = join(request.outputDirectory, 'video');

  await mkdir(screenshotsDirectory, { recursive: true, mode: 0o700 });
  await mkdir(videoDirectory, { recursive: true, mode: 0o700 });

  let fixture: PreparedFixture | undefined;
  let browser: Browser | undefined;
  let context: BrowserContext | undefined;
  let page: Page | undefined;
  let traceStarted = false;
  let contextClosed = false;

  const startedAt = Date.now();
  const deadline = startedAt + scenario.timeouts.scenarioMs;

  const assertions: CaptureExecutionResult['assertions'] = [];
  const markedMoments: CaptureExecutionResult['markedMoments'] = [];
  const files: CaptureLocalOutput[] = [];

  let executedStepCount = 0;
  let failedStepIndex: number | undefined;
  let safetyError: DomainError | undefined;

  let consoleErrorCount = 0;
  let pageErrorCount = 0;
  let requestFailureCount = 0;

  const remaining = (preferred: number) => {
    const left = deadline - Date.now();

    invariant(left > 0, 'CAPTURE_TIMEOUT');

    return Math.min(preferred, left);
  };

  const throwSafety = () => {
    if (safetyError) throw safetyError;
  };

  try {
    fixture = await request.fixtureManager.prepare(scenario.fixturePolicy, request.input);

    const runtimeEnvironment = fixture.runtimeEnvironment ?? {
      baseUrl: scenario.environment.baseUrl,
      allowedOrigins: scenario.environment.allowedOrigins,
    };

    const runtimeBaseUrl = new URL(runtimeEnvironment.baseUrl);
    const runtimeAllowedOrigins = [...runtimeEnvironment.allowedOrigins];

    invariant(runtimeAllowedOrigins.length > 0, 'CAPTURE_FIXTURE_ORIGIN_INVALID');

    for (const origin of runtimeAllowedOrigins) {
      const parsed = new URL(origin);

      invariant(
        parsed.origin === origin &&
          parsed.pathname === '/' &&
          parsed.search === '' &&
          parsed.hash === '',
        'CAPTURE_FIXTURE_ORIGIN_INVALID',
      );
    }

    invariant(
      runtimeAllowedOrigins.includes(runtimeBaseUrl.origin),
      'CAPTURE_FIXTURE_ORIGIN_INVALID',
    );

    const storageStatePath = await request.authStateProvider.storageStatePath(
      scenario.auth.authProfileKey,
    );
    invariant(
      !storageStatePath ||
        !scenario.outputs.some((output) => output.role === 'TRACE' && output.required),
      'CAPTURE_AUTH_TRACE_FORBIDDEN',
    );

    browser = await chromium.launch({
      headless: true,
      downloadsPath: join(request.outputDirectory, 'downloads'),
    });

    context = await browser.newContext({
      viewport: scenario.browser.viewport,
      deviceScaleFactor: scenario.browser.deviceScaleFactor,
      locale: scenario.browser.locale,
      timezoneId: scenario.browser.timezoneId,
      reducedMotion: scenario.browser.reducedMotion === 'REDUCE' ? 'reduce' : 'no-preference',
      colorScheme: scenario.browser.colorScheme === 'DARK' ? 'dark' : 'light',
      acceptDownloads: !scenario.safety.blockDownloads,
      serviceWorkers: 'block',
      ...(storageStatePath ? { storageState: storageStatePath } : {}),
      ...(scenario.browser.recordVideo
        ? {
            recordVideo: {
              dir: videoDirectory,
              size: scenario.browser.recordVideoSize ?? scenario.browser.viewport,
            },
          }
        : {}),
    });

    if (!storageStatePath) {
      await context.tracing.start({
        screenshots: true,
        snapshots: true,
        sources: false,
      });

      traceStarted = true;
    }

    await context.route('**/*', async (route) => {
      const request = route.request();

      if (request.resourceType() !== 'document') {
        await route.continue();
        return;
      }

      try {
        safeTarget(scenario, new URL(request.url()), runtimeAllowedOrigins);
        await route.continue();
      } catch (error) {
        safetyError =
          error instanceof DomainError ? error : new DomainError('CAPTURE_ORIGIN_BLOCKED');

        await route.abort('blockedbyclient');
      }
    });

    page = await context.newPage();

    context.on('page', (candidate) => {
      if (candidate === page) return;

      if (
        scenario.safety.blockPopupsByDefault ||
        context!.pages().length > scenario.safety.maximumPages
      ) {
        safetyError = new DomainError('CAPTURE_POPUP_BLOCKED');
        void candidate.close();
      }
    });

    page.on('download', (download) => {
      if (scenario.safety.blockDownloads) {
        safetyError = new DomainError('CAPTURE_DOWNLOAD_BLOCKED');
        void download.cancel();
      }
    });

    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrorCount++;
    });

    page.on('pageerror', () => {
      pageErrorCount++;
    });

    page.on('requestfailed', () => {
      requestFailureCount++;
    });

    const video = page.video();

    for (let index = 0; index < scenario.steps.length; index++) {
      failedStepIndex = index;

      const step = scenario.steps[index]!;

      throwSafety();

      switch (step.type) {
        case 'NAVIGATE': {
          invariant(step.path.startsWith('/'), 'CAPTURE_NAVIGATION_MUST_BE_RELATIVE');

          const target = new URL(step.path, runtimeEnvironment.baseUrl);

          safeTarget(scenario, target, runtimeAllowedOrigins);

          await page.goto(target.toString(), {
            waitUntil: waitUntil(step.waitUntil),
            timeout: remaining(scenario.timeouts.navigationMs),
          });

          break;
        }

        case 'CLICK': {
          await locate(page, step.locator).click({
            timeout: remaining(scenario.timeouts.actionMs),
          });

          if (step.expectedAfter?.locatorVisible) {
            await locate(page, step.expectedAfter.locatorVisible).waitFor({
              state: 'visible',
              timeout: remaining(scenario.timeouts.assertionMs),
            });
          }

          if (step.expectedAfter?.urlPattern) {
            await page.waitForURL(step.expectedAfter.urlPattern, {
              timeout: remaining(scenario.timeouts.assertionMs),
            });
          }

          break;
        }

        case 'FILL': {
          const target = locate(page, step.locator);
          const value = inputValue(request.input, step.valueFromInput);

          if (step.clearFirst) {
            await target.fill('', {
              timeout: remaining(scenario.timeouts.actionMs),
            });
          }

          await target.fill(value, {
            timeout: remaining(scenario.timeouts.actionMs),
          });

          break;
        }

        case 'PRESS':
          if (step.locator) {
            await locate(page, step.locator).press(playwrightKey(step.key), {
              timeout: remaining(scenario.timeouts.actionMs),
            });
          } else {
            await page.keyboard.press(playwrightKey(step.key));
          }
          break;

        case 'WAIT_FOR': {
          const timeout = remaining(step.timeoutMs ?? scenario.timeouts.assertionMs);

          switch (step.condition.kind) {
            case 'VISIBLE':
              await locate(page, step.condition.locator).waitFor({
                state: 'visible',
                timeout,
              });
              break;

            case 'HIDDEN':
              await locate(page, step.condition.locator).waitFor({
                state: 'hidden',
                timeout,
              });
              break;

            case 'ENABLED': {
              const target = locate(page, step.condition.locator);

              await target.waitFor({ state: 'visible', timeout });

              invariant(await target.isEnabled({ timeout }), 'CAPTURE_WAIT_CONDITION_FAILED');
              break;
            }

            case 'URL':
              await page.waitForURL(step.condition.pattern, { timeout });
              break;

            case 'TEXT':
              await locate(page, step.condition.locator)
                .filter({ hasText: step.condition.contains })
                .waitFor({
                  state: 'visible',
                  timeout,
                });
              break;
          }

          break;
        }

        case 'ASSERT': {
          const key = `step-${index}-${step.assertion.kind}`;

          try {
            await runAssertion(
              page,
              step.assertion,
              request.input,
              remaining(scenario.timeouts.assertionMs),
            );

            assertions.push({ key, result: 'PASS' });
          } catch {
            assertions.push({
              key,
              result: 'FAIL',
              message: 'CAPTURE_ASSERTION_FAILED',
            });

            throw new DomainError('CAPTURE_ASSERTION_FAILED');
          }

          break;
        }

        case 'SCREENSHOT': {
          invariant(!step.maskLocatorKeys?.length, 'CAPTURE_MASK_LOCATOR_UNRESOLVED');

          const output = scenario.outputs.find((candidate) => candidate.key === step.outputKey);

          invariant(output?.role === 'SCREENSHOT', 'CAPTURE_OUTPUT_SPEC_MISMATCH');

          const path = join(screenshotsDirectory, `${safeFilename(step.outputKey)}.png`);

          if (step.mode === 'LOCATOR') {
            invariant(step.locator, 'CAPTURE_SCREENSHOT_LOCATOR_REQUIRED');

            await locate(page, step.locator).screenshot({
              path,
              ...(step.omitBackground !== undefined ? { omitBackground: step.omitBackground } : {}),
              timeout: remaining(scenario.timeouts.actionMs),
            });
          } else {
            await page.screenshot({
              path,
              ...(step.omitBackground !== undefined ? { omitBackground: step.omitBackground } : {}),
              timeout: remaining(scenario.timeouts.actionMs),
            });
          }

          await capacity.file(path);
          await validatePng(path, step.mode === 'VIEWPORT', scenario);

          files.push({
            key: output.key,
            role: output.role,
            path,
            required: output.required,
            diagnostic: false,
          });

          break;
        }

        case 'MARK_MOMENT':
          markedMoments.push({
            key: step.key,
            atMs: Date.now() - startedAt,
            editorialMeaning: step.editorialMeaning,
          });
          break;

        case 'VISUAL_SETTLE': {
          invariant(
            step.durationMs <= scenario.timeouts.visualSettleMaxMs,
            'CAPTURE_VISUAL_SETTLE_EXCEEDS_POLICY',
          );

          const settleMs = remaining(step.durationMs);

          invariant(settleMs === step.durationMs, 'CAPTURE_TIMEOUT');

          await new Promise<void>((resolve) => {
            setTimeout(resolve, settleMs);
          });

          break;
        }
      }

      throwSafety();

      enforceCurrentPageSafety(scenario, page, runtimeAllowedOrigins);

      throwSafety();

      executedStepCount++;
      failedStepIndex = undefined;
    }

    for (let index = 0; index < scenario.assertions.length; index++) {
      const assertion = scenario.assertions[index]!;
      const key = `final-${index}-${assertion.kind}`;

      try {
        await runAssertion(
          page,
          assertion,
          request.input,
          remaining(scenario.timeouts.assertionMs),
        );

        assertions.push({ key, result: 'PASS' });
      } catch {
        assertions.push({
          key,
          result: 'FAIL',
          message: 'CAPTURE_ASSERTION_FAILED',
        });

        throw new DomainError('CAPTURE_ASSERTION_FAILED');
      }
    }

    throwSafety();

    const traceOutput = scenario.outputs.find((output) => output.role === 'TRACE');

    if (traceOutput && traceStarted) {
      const tracePath = join(request.outputDirectory, `${safeFilename(traceOutput.key)}.zip`);

      await context.tracing.stop({ path: tracePath });
      traceStarted = false;

      files.push({
        key: traceOutput.key,
        role: 'TRACE',
        path: tracePath,
        required: traceOutput.required,
        diagnostic: false,
      });
    } else if (traceStarted) {
      await context.tracing.stop();
      traceStarted = false;
    }

    const browserVersion = browser.version();

    await context.close();
    contextClosed = true;

    const videoOutput = scenario.outputs.find((output) => output.role === 'VIDEO');

    if (videoOutput) {
      invariant(video, 'CAPTURE_VIDEO_NOT_AVAILABLE');

      const videoPath = await video.path();

      files.push({
        key: videoOutput.key,
        role: 'VIDEO',
        path: videoPath,
        required: videoOutput.required,
        diagnostic: false,
      });
    }

    for (const output of scenario.outputs) {
      if (!output.required) continue;

      invariant(
        files.some(
          (file) => file.key === output.key && file.role === output.role && !file.diagnostic,
        ),
        'CAPTURE_REQUIRED_OUTPUT_MISSING',
      );
    }

    for (const file of files) await capacity.file(file.path);
    return {
      result: 'SUCCEEDED',
      executedStepCount,
      assertions,
      markedMoments,
      files,
      warnings: [],
      diagnostics: {
        consoleErrorCount,
        pageErrorCount,
        requestFailureCount,
        ...(safeCurrentUrl(page) ? { currentUrl: safeCurrentUrl(page) } : {}),
      },
      runtime: {
        playwrightVersion: CAPTURE_PLAYWRIGHT_VERSION,
        browserVersion,
        workerVersion: CAPTURE_WORKER_VERSION,
      },
    };
  } catch (error) {
    const code = safetyError?.code ?? failureCode(error, deadline);

    if (page && !page.isClosed()) {
      const screenshotPath = join(screenshotsDirectory, 'diagnostic-failure.png');

      try {
        await page.screenshot({
          path: screenshotPath,
          timeout: Math.max(100, Math.min(2000, deadline - Date.now())),
        });

        await validatePng(screenshotPath, true, scenario);

        files.push({
          key: 'diagnostic-failure',
          role: 'SCREENSHOT',
          path: screenshotPath,
          required: false,
          diagnostic: true,
        });
      } catch {
        // Diagnostic capture must never replace the original stable failure code.
      }
    }

    if (context && traceStarted) {
      const tracePath = join(request.outputDirectory, 'diagnostic-trace.zip');

      try {
        await context.tracing.stop({ path: tracePath });
        traceStarted = false;

        files.push({
          key: 'diagnostic-trace',
          role: 'TRACE',
          path: tracePath,
          required: false,
          diagnostic: true,
        });
      } catch {
        // Same rule: diagnostics never replace the original failure.
      }
    }

    return {
      result: 'FAILED',
      failureCode: code,
      executedStepCount,
      assertions,
      markedMoments,
      files,
      warnings: [],
      diagnostics: {
        ...(failedStepIndex !== undefined ? { failedStepIndex } : {}),
        ...(safeCurrentUrl(page) ? { currentUrl: safeCurrentUrl(page) } : {}),
        consoleErrorCount,
        pageErrorCount,
        requestFailureCount,
      },
      runtime: {
        playwrightVersion: CAPTURE_PLAYWRIGHT_VERSION,
        browserVersion: browser?.version() ?? 'unavailable',
        workerVersion: CAPTURE_WORKER_VERSION,
      },
    };
  } finally {
    if (context && !contextClosed) {
      try {
        if (traceStarted) await context.tracing.stop();
      } catch {
        // Cleanup only.
      }

      try {
        await context.close();
      } catch {
        // Cleanup only.
      }
    }

    if (browser) {
      try {
        await browser.close();
      } catch {
        // Cleanup only.
      }
    }

    if (fixture?.cleanup) {
      try {
        await fixture.cleanup();
      } catch {
        // Fixture cleanup cannot rewrite the capture result.
      }
    }
  }
}
