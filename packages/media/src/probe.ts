import { execFile } from 'node:child_process';
import { z } from 'zod';
import { invariant } from '@vision/domain';

const stream = z.object({
  codec_type: z.string(),
  codec_name: z.string().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  avg_frame_rate: z.string().optional(),
  pix_fmt: z.string().optional(),
  duration: z.string().optional(),
  sample_rate: z.string().optional(),
  channels: z.number().optional(),
  color_primaries: z.string().optional(),
  color_transfer: z.string().optional(),
  color_space: z.string().optional(),
  color_range: z.string().optional(),
  tags: z.object({ rotate: z.string().optional() }).optional(),
  side_data_list: z
    .array(
      z
        .object({ side_data_type: z.string().optional(), rotation: z.number().optional() })
        .passthrough(),
    )
    .optional(),
});
const output = z.object({
  streams: z.array(stream),
  format: z.object({ format_name: z.string(), duration: z.string().optional() }),
});
export type MediaProbe = {
  probeVersion: string;
  container: string;
  durationMs: number;
  video?: {
    codec: string;
    width: number;
    height: number;
    fps: number;
    pixelFormat?: string;
    rotationDeg: number;
    color: {
      primaries?: string;
      transfer?: string;
      matrix?: string;
      range?: string;
      hdrKind: 'SDR';
    };
  };
  audio?: { codec: string; sampleRate: number; channels: number };
};
export function parseProbe(raw: unknown): MediaProbe {
  const data = output.parse(raw);
  const v = data.streams.find((s) => s.codec_type === 'video');
  const a = data.streams.find((s) => s.codec_type === 'audio');
  invariant(v || a, 'NO_MEDIA_STREAM');
  invariant(
    data.streams.filter((s) => s.codec_type === 'video').length <= 1 &&
      data.streams.filter((s) => s.codec_type === 'audio').length <= 1,
    'UNSUPPORTED_MULTI_STREAM',
  );
  const durationMs = Math.round(Number(data.format.duration ?? v?.duration ?? a?.duration) * 1000);
  invariant(Number.isSafeInteger(durationMs) && durationMs > 0, 'INVALID_MEDIA_DURATION');
  const result: MediaProbe = {
    probeVersion: 'ffprobe-v1',
    container: data.format.format_name,
    durationMs,
  };
  if (v) {
    const hdr =
      ['smpte2084', 'arib-std-b67'].includes(v.color_transfer ?? '') ||
      v.color_primaries === 'bt2020' ||
      ['bt2020nc', 'bt2020c', 'ictcp'].includes(v.color_space ?? '') ||
      v.side_data_list?.some((s) =>
        /dovi|dolby|mastering display|content light/i.test(s.side_data_type ?? ''),
      ) ||
      /(?:p010|p012|p016|p10|p12|p16)/.test(v.pix_fmt ?? '');
    invariant(!hdr, 'UNSUPPORTED_HDR_COLOR');
    invariant(
      v.width && v.height && v.width <= 8192 && v.height <= 8192,
      'INVALID_VIDEO_DIMENSIONS',
    );
    invariant(
      v.codec_name &&
        ['h264', 'hevc', 'vp8', 'vp9', 'av1', 'prores', 'mpeg4'].includes(v.codec_name),
      'UNSUPPORTED_VIDEO_CODEC',
    );
    const [n, d] = (v.avg_frame_rate ?? '').split('/').map(Number);
    const fps = n! / d!;
    invariant(Number.isFinite(fps) && fps > 0 && fps <= 240, 'INVALID_FRAME_RATE');
    const rotation =
      v.side_data_list?.find((s) => s.rotation !== undefined)?.rotation ??
      Number(v.tags?.rotate ?? 0);
    invariant(Number.isFinite(rotation) && rotation % 90 === 0, 'UNSUPPORTED_ROTATION');
    const rotated = Math.abs(rotation % 180) === 90;
    result.video = {
      codec: v.codec_name,
      width: rotated ? v.height : v.width,
      height: rotated ? v.width : v.height,
      fps,
      rotationDeg: rotation,
      ...(v.pix_fmt ? { pixelFormat: v.pix_fmt } : {}),
      color: {
        hdrKind: 'SDR',
        ...(v.color_primaries ? { primaries: v.color_primaries } : {}),
        ...(v.color_transfer ? { transfer: v.color_transfer } : {}),
        ...(v.color_space ? { matrix: v.color_space } : {}),
        ...(v.color_range ? { range: v.color_range } : {}),
      },
    };
  }
  if (a) {
    const sampleRate = Number(a.sample_rate);
    invariant(
      a.codec_name &&
        Number.isSafeInteger(sampleRate) &&
        sampleRate > 0 &&
        a.channels &&
        a.channels > 0,
      'INVALID_AUDIO_STREAM',
    );
    result.audio = { codec: a.codec_name, sampleRate, channels: a.channels };
  }
  return result;
}
/** Arguments are fixed; input is an owned temporary file, never a user URL or command. */
export function probeFile(path: string): Promise<MediaProbe> {
  return new Promise((resolve, reject) => {
    execFile(
      'ffprobe',
      [
        '-v',
        'error',
        '-protocol_whitelist',
        'file',
        '-format_whitelist',
        'mov,matroska,webm,wav,mp3,ogg,flac',
        '-show_streams',
        '-show_format',
        '-of',
        'json',
        path,
      ],
      { timeout: 30000, maxBuffer: 1024 * 1024, encoding: 'utf8' },
      (error, stdout) => {
        if (error) {
          reject(new Error('MEDIA_UNREADABLE'));
          return;
        }
        try {
          resolve(parseProbe(JSON.parse(stdout)));
        } catch (e) {
          reject(e);
        }
      },
    );
  });
}
export function recordingFeedback(probe: MediaProbe, type: string, targetDurationSec?: number) {
  invariant(type !== 'VOICE' || probe.audio, 'AUDIO_MISSING');
  invariant(
    !['GREEN_SCREEN_VIDEO', 'SCREEN_VIDEO', 'BROLL'].includes(type) || probe.video,
    'VIDEO_MISSING',
  );

  return [
    ...(targetDurationSec && probe.durationMs < targetDurationSec * 1000
      ? ['SHORTER_THAN_TARGET']
      : []),
    ...(targetDurationSec && probe.durationMs > targetDurationSec * 1000
      ? ['LONGER_THAN_TARGET']
      : []),
    ...(probe.video && probe.video.width > probe.video.height ? ['LANDSCAPE_SOURCE'] : []),
    ...(type === 'GREEN_SCREEN_VIDEO' && !probe.audio ? ['AUDIO_MISSING'] : []),
    ...(type === 'GREEN_SCREEN_VIDEO' ? ['GREEN_SCREEN_REQUIRES_VISUAL_REVIEW'] : []),
  ];
}
export function mediaType(probe: MediaProbe) {
  const c = probe.container.split(',');
  if (c.some((x) => ['mov', 'mp4', 'm4a'].includes(x)))
    return probe.video ? 'video/mp4' : 'audio/mp4';
  if (c.includes('webm') || c.includes('matroska'))
    return probe.video ? 'video/webm' : 'audio/webm';
  if (c.includes('wav')) return 'audio/wav';
  if (c.includes('mp3')) return 'audio/mpeg';
  if (c.includes('ogg')) return probe.video ? 'video/ogg' : 'audio/ogg';
  if (c.includes('flac')) return 'audio/flac';
  throw new Error('UNSUPPORTED_CONTAINER');
}
