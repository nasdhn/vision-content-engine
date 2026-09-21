import { z } from 'zod';

export const CaptureLocatorSchema = z.discriminatedUnion('strategy', [
  z
    .object({
      strategy: z.literal('ROLE'),
      role: z.string().min(1),
      name: z.string().optional(),
      exact: z.boolean().optional(),
    })
    .strict(),

  z
    .object({
      strategy: z.literal('LABEL'),
      text: z.string().min(1),
      exact: z.boolean().optional(),
    })
    .strict(),

  z
    .object({
      strategy: z.literal('TEST_ID'),
      value: z.string().min(1),
    })
    .strict(),

  z
    .object({
      strategy: z.literal('TEXT'),
      text: z.string().min(1),
      exact: z.boolean(),
    })
    .strict(),
]);

export const BrowserProfileSchema = z
  .object({
    browser: z.literal('CHROMIUM'),
    viewport: z
      .object({
        width: z.number().int().positive(),
        height: z.number().int().positive(),
      })
      .strict(),
    deviceScaleFactor: z.number().positive(),
    locale: z.literal('fr-FR'),
    timezoneId: z.literal('Europe/Paris'),
    reducedMotion: z.enum(['NO_PREFERENCE', 'REDUCE']),
    colorScheme: z.enum(['LIGHT', 'DARK']),
    recordVideo: z.boolean(),
    recordVideoSize: z
      .object({
        width: z.number().int().positive(),
        height: z.number().int().positive(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const CaptureFixturePolicySchema = z
  .object({
    mode: z.enum(['SEEDED_DEMO_DATA', 'CONTROLLED_QUERY_LIVE_PROVIDER', 'PREPARED_STATE']),
    resetBeforeRun: z.boolean(),
    fixtureVersion: z.string().optional(),
    variabilityNotes: z.array(z.string()),
  })
  .strict();

const NavigateStep = z
  .object({
    type: z.literal('NAVIGATE'),
    path: z.string().min(1),
    waitUntil: z.enum(['COMMIT', 'DOM_CONTENT_LOADED', 'LOAD']),
  })
  .strict();

const ClickStep = z
  .object({
    type: z.literal('CLICK'),
    locator: CaptureLocatorSchema,
    expectedAfter: z
      .object({
        locatorVisible: CaptureLocatorSchema.optional(),
        urlPattern: z.string().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

const FillStep = z
  .object({
    type: z.literal('FILL'),
    locator: CaptureLocatorSchema,
    valueFromInput: z.string().min(1),
    clearFirst: z.boolean(),
  })
  .strict();

const PressStep = z
  .object({
    type: z.literal('PRESS'),
    locator: CaptureLocatorSchema.optional(),
    key: z.enum(['ENTER', 'ESCAPE', 'TAB']),
  })
  .strict();

const WaitForStep = z
  .object({
    type: z.literal('WAIT_FOR'),
    condition: z.union([
      z
        .object({
          kind: z.literal('VISIBLE'),
          locator: CaptureLocatorSchema,
        })
        .strict(),
      z
        .object({
          kind: z.literal('HIDDEN'),
          locator: CaptureLocatorSchema,
        })
        .strict(),
      z
        .object({
          kind: z.literal('ENABLED'),
          locator: CaptureLocatorSchema,
        })
        .strict(),
      z
        .object({
          kind: z.literal('URL'),
          pattern: z.string().min(1),
        })
        .strict(),
      z
        .object({
          kind: z.literal('TEXT'),
          locator: CaptureLocatorSchema,
          contains: z.string().min(1),
        })
        .strict(),
    ]),
    timeoutMs: z.number().int().positive().optional(),
  })
  .strict();

export const CaptureAssertionSchema = z.union([
  z
    .object({
      kind: z.literal('VISIBLE'),
      locator: CaptureLocatorSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('TEXT_CONTAINS'),
      locator: CaptureLocatorSchema,
      valueFromInput: z.string().optional(),
      literal: z.string().optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('URL_MATCHES'),
      pattern: z.string().min(1),
    })
    .strict(),
]);

const AssertStep = z
  .object({
    type: z.literal('ASSERT'),
    assertion: CaptureAssertionSchema,
  })
  .strict();

const ScreenshotStep = z
  .object({
    type: z.literal('SCREENSHOT'),
    outputKey: z.string().min(1),
    mode: z.enum(['VIEWPORT', 'LOCATOR']),
    locator: CaptureLocatorSchema.optional(),
    maskLocatorKeys: z.array(z.string()).optional(),
    omitBackground: z.boolean().optional(),
  })
  .strict();

const MarkMomentStep = z
  .object({
    type: z.literal('MARK_MOMENT'),
    key: z.string().min(1),
    editorialMeaning: z.string().min(1),
  })
  .strict();

const VisualSettleStep = z
  .object({
    type: z.literal('VISUAL_SETTLE'),
    durationMs: z.number().int().nonnegative(),
    reason: z.string().min(1),
  })
  .strict();

export const CaptureStepSchema = z.discriminatedUnion('type', [
  NavigateStep,
  ClickStep,
  FillStep,
  PressStep,
  WaitForStep,
  AssertStep,
  ScreenshotStep,
  MarkMomentStep,
  VisualSettleStep,
]);

export const CaptureOutputSpecSchema = z
  .object({
    key: z.string().min(1),
    role: z.enum(['SCREENSHOT', 'VIDEO', 'FRAME', 'TRACE']),
    required: z.boolean(),
    editorialDescription: z.string().min(1),
  })
  .strict();

export const CaptureSafetyPolicySchema = z
  .object({
    allowedOrigins: z.array(z.string().url()).min(1),
    blockDownloads: z.boolean(),
    blockPopupsByDefault: z.boolean(),
    allowClipboardWrite: z.boolean(),
    allowFileUpload: z.boolean(),
    maximumPages: z.number().int().positive(),
    prohibitedPathPatterns: z.array(z.string()),
  })
  .strict();

export const CaptureTimeoutPolicySchema = z
  .object({
    scenarioMs: z.number().int().positive(),
    navigationMs: z.number().int().positive(),
    actionMs: z.number().int().positive(),
    assertionMs: z.number().int().positive(),
    visualSettleMaxMs: z.number().int().positive(),
  })
  .strict();

export const CaptureScenarioVersionSpecSchema = z
  .object({
    identity: z
      .object({
        captureScenarioVersionId: z.string().uuid(),
        scenarioKey: z.string().min(1),
        version: z.number().int().positive(),
        name: z.string().min(1),
      })
      .strict(),
    environment: z
      .object({
        environmentKey: z.string().min(1),
        allowedOrigins: z.array(z.string().url()).min(1),
        baseUrl: z.string().url(),
      })
      .strict(),
    auth: z
      .object({
        authProfileKey: z.string().min(1),
      })
      .strict(),
    browser: BrowserProfileSchema,
    inputSchema: z.record(z.string(), z.unknown()),
    fixturePolicy: CaptureFixturePolicySchema,
    steps: z.array(CaptureStepSchema).min(1),
    outputs: z.array(CaptureOutputSpecSchema),
    assertions: z.array(CaptureAssertionSchema),
    safety: CaptureSafetyPolicySchema,
    timeouts: CaptureTimeoutPolicySchema,
  })
  .strict();

export const CaptureRunReportSchema = z
  .object({
    result: z.enum(['SUCCEEDED', 'FAILED']),
    executedStepCount: z.number().int().nonnegative(),
    assertions: z.array(
      z
        .object({
          key: z.string().min(1),
          result: z.enum(['PASS', 'FAIL']),
          message: z.string().optional(),
        })
        .strict(),
    ),
    markedMoments: z.array(
      z
        .object({
          key: z.string().min(1),
          atMs: z.number().int().nonnegative(),
          editorialMeaning: z.string().min(1),
        })
        .strict(),
    ),
    outputs: z.array(
      z
        .object({
          key: z.string().min(1),
          assetId: z.string().uuid(),
          role: z.enum(['SCREENSHOT', 'VIDEO', 'FRAME', 'TRACE']),
        })
        .strict(),
    ),
    warnings: z.array(z.string()),
    runtime: z
      .object({
        playwrightVersion: z.string().min(1),
        browserVersion: z.string().min(1),
        workerVersion: z.string().min(1),
      })
      .strict(),
  })
  .strict();
