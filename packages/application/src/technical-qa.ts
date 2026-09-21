import { MediaProbeSchema, RenderPayloadSchema, TechnicalQaReportSchema } from '@vision/contracts';
import { invariant } from '@vision/domain';
import type { z } from 'zod';

type RenderPayload = z.infer<typeof RenderPayloadSchema>;

export type TechnicalQaMeasurements = Readonly<{
  fileSizeBytes: number;
  blackDurationMs: number;
  silenceDurationMs: number;
}>;

function check(
  key: string,
  ok: boolean,
  message?: string,
  data?: unknown,
): z.infer<typeof TechnicalQaReportSchema>['checks'][number] {
  return {
    key,
    status: ok ? 'PASS' : 'FAIL',
    ...(message !== undefined ? { message } : {}),
    ...(data !== undefined ? { data } : {}),
  };
}

function notApplicable(
  key: string,
  message: string,
): z.infer<typeof TechnicalQaReportSchema>['checks'][number] {
  return { key, status: 'NOT_APPLICABLE', message };
}

function normalizedContainer(container: string | undefined) {
  return new Set((container ?? '').split(',').map((part) => part.trim().toLowerCase()));
}

function expectsAudio(payload: RenderPayload) {
  const audio = payload.editingPlan.audio;
  return Boolean(audio.voice || audio.music || audio.sfx.length > 0);
}

function hasMeaningfulVisual(payload: RenderPayload) {
  return (
    payload.editingPlan.timeline.some((item) => item.layer !== 'CAPTION') ||
    payload.editingPlan.presenter.length > 0 ||
    payload.editingPlan.onScreenText.length > 0
  );
}

export function evaluateTechnicalQa(input: {
  payload: unknown;
  probe: unknown;
  measurements: TechnicalQaMeasurements;
}) {
  const payload = RenderPayloadSchema.parse(input.payload);
  const probe = MediaProbeSchema.parse(input.probe);
  const measurements = input.measurements;

  invariant(
    Number.isSafeInteger(measurements.fileSizeBytes) && measurements.fileSizeBytes >= 0,
    'INVALID_QA_MEASUREMENT',
  );
  invariant(
    Number.isSafeInteger(measurements.blackDurationMs) && measurements.blackDurationMs >= 0,
    'INVALID_QA_MEASUREMENT',
  );
  invariant(
    Number.isSafeInteger(measurements.silenceDurationMs) && measurements.silenceDurationMs >= 0,
    'INVALID_QA_MEASUREMENT',
  );

  const checks: z.infer<typeof TechnicalQaReportSchema>['checks'] = [];
  const video = probe.video;
  const audio = probe.audio;
  const expected = payload.renderSettings;
  const expectedDurationMs = payload.editingPlan.masterDurationMs;
  const frameToleranceMs = Math.ceil(2_000 / expected.fps);
  const durationDeltaMs = Math.abs((probe.durationMs ?? -1) - expectedDurationMs);
  const container = normalizedContainer(probe.container);
  const expectedAudio = expectsAudio(payload);

  checks.push(
    check('OUTPUT_SIZE', measurements.fileSizeBytes >= 1024, undefined, {
      fileSizeBytes: measurements.fileSizeBytes,
    }),
  );
  checks.push(check('VIDEO_STREAM', Boolean(video)));

  if (video) {
    checks.push(
      check(
        'DIMENSIONS',
        video.width === expected.width && video.height === expected.height,
        undefined,
        {
          actual: { width: video.width, height: video.height },
          expected: { width: expected.width, height: expected.height },
        },
      ),
    );
    checks.push(
      check('DISPLAY_ORIENTATION', video.height > video.width, undefined, {
        width: video.width,
        height: video.height,
        rotationDeg: video.rotationDeg ?? 0,
      }),
    );
    checks.push(
      check('FPS', Math.abs(video.fps - expected.fps) <= 0.02, undefined, {
        actual: video.fps,
        expected: expected.fps,
      }),
    );
    checks.push(check('VIDEO_CODEC', video.codec === 'h264', undefined, { actual: video.codec }));
    checks.push(
      check('PIXEL_FORMAT', video.pixelFormat === 'yuv420p', undefined, {
        actual: video.pixelFormat,
      }),
    );

    const color = video.color;
    const sdrBt709 =
      color?.hdrKind === 'SDR' &&
      color.primaries === 'bt709' &&
      color.transfer === 'bt709' &&
      color.matrix === 'bt709' &&
      (color.range === 'tv' || color.range === undefined);

    checks.push(
      check('SDR_BT709', sdrBt709, undefined, {
        color: color ?? null,
      }),
    );
    checks.push(
      check('NO_HDR_SIGNALING', color?.hdrKind === 'SDR', undefined, {
        hdrKind: color?.hdrKind ?? null,
      }),
    );
  }

  checks.push(
    check(
      'DURATION',
      probe.durationMs !== undefined && durationDeltaMs <= frameToleranceMs,
      undefined,
      {
        actualMs: probe.durationMs ?? null,
        expectedMs: expectedDurationMs,
        toleranceMs: frameToleranceMs,
      },
    ),
  );

  checks.push(
    check('CONTAINER', container.has('mov') || container.has('mp4'), undefined, {
      actual: probe.container ?? null,
    }),
  );

  if (expectedAudio) {
    checks.push(check('AUDIO_STREAM', Boolean(audio)));
    if (audio) {
      checks.push(
        check('AUDIO_FORMAT', audio.sampleRate === 48_000 && audio.channels === 2, undefined, {
          sampleRate: audio.sampleRate,
          channels: audio.channels,
        }),
      );

      const catastrophicSilenceLimit = Math.max(1, Math.floor(expectedDurationMs * 0.9));
      checks.push(
        check(
          'CATASTROPHIC_SILENCE',
          measurements.silenceDurationMs < catastrophicSilenceLimit,
          undefined,
          {
            silenceDurationMs: measurements.silenceDurationMs,
            catastrophicLimitMs: catastrophicSilenceLimit,
          },
        ),
      );
    }
  } else {
    checks.push(notApplicable('AUDIO_STREAM', 'AudioPlan does not require audio.'));
    checks.push(notApplicable('AUDIO_FORMAT', 'AudioPlan does not require audio.'));
    checks.push(notApplicable('CATASTROPHIC_SILENCE', 'AudioPlan does not require audio.'));
  }

  if (hasMeaningfulVisual(payload)) {
    const catastrophicBlackLimit = Math.max(1, Math.floor(expectedDurationMs * 0.85));
    checks.push(
      check(
        'CATASTROPHIC_BLACK',
        measurements.blackDurationMs < catastrophicBlackLimit,
        undefined,
        {
          blackDurationMs: measurements.blackDurationMs,
          catastrophicLimitMs: catastrophicBlackLimit,
        },
      ),
    );
  } else {
    checks.push(notApplicable('CATASTROPHIC_BLACK', 'No meaningful visual content is required.'));
  }

  const result = checks.some((item) => item.status === 'FAIL') ? 'FAIL' : 'PASS';

  return TechnicalQaReportSchema.parse({
    result,
    probe,
    checks,
    rendererVersion: payload.provenance.rendererVersion,
    colorProfileKey: payload.provenance.colorProfileKey,
    codecProfileKey: payload.provenance.codecProfileKey,
    audioProfileKey: payload.provenance.audioProfileKey,
  });
}
