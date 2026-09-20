import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile, mkdir, utimes, symlink, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import {
  parseProbe,
  probeFile,
  recordingFeedback,
  cleanAbandonedUploadTemps,
} from '../../packages/media/src/index.js';
import { wav } from '../fixtures/recordings/support.js';
const raw = () => ({
  format: { format_name: 'mov,mp4', duration: '2' },
  streams: [
    {
      codec_type: 'video',
      codec_name: 'h264',
      width: 1920,
      height: 1080,
      avg_frame_rate: '30000/1001',
      pix_fmt: 'yuv420p',
      color_primaries: 'bt709',
      color_transfer: 'bt709',
      side_data_list: [{ rotation: 90 }],
    },
  ],
});
it('uses display rotation and keeps unobserved audio absent', () => {
  const p = parseProbe(raw());
  expect(p.video).toMatchObject({ width: 1080, height: 1920, rotationDeg: 90 });
  expect(p.video?.fps).toBeCloseTo(29.97, 2);
  expect(p.audio).toBeUndefined();
});
it.each(['smpte2084', 'arib-std-b67'])('explicitly refuses HDR transfer %s', (transfer) => {
  const input = raw();
  input.streams[0]!.color_transfer = transfer;
  expect(() => parseProbe(input)).toThrow('UNSUPPORTED_HDR_COLOR');
});
it('refuses Dolby Vision and unknown high-bit-depth color instead of stripping metadata', () => {
  const input = raw();
  expect(() =>
    parseProbe({
      ...input,
      streams: [
        { ...input.streams[0], side_data_list: [{ side_data_type: 'DOVI configuration record' }] },
      ],
    }),
  ).toThrow('UNSUPPORTED_HDR_COLOR');
  input.streams[0]!.pix_fmt = 'yuv420p10le';
  expect(() => parseProbe(input)).toThrow('UNSUPPORTED_HDR_COLOR');
});
it.each(['0/0', '1/0', '0/1'])('refuses invalid frame rate %s', (rate) => {
  const input = raw();
  input.streams[0]!.avg_frame_rate = rate;
  expect(() => parseProbe(input)).toThrow('INVALID_FRAME_RATE');
});
it('requires actual audio/video for each recording type and treats duration as feedback', () => {
  const video = parseProbe(raw());
  expect(() => recordingFeedback(video, 'VOICE')).toThrow('AUDIO_MISSING');
  expect(recordingFeedback(video, 'GREEN_SCREEN_VIDEO')).toContain('AUDIO_MISSING');
  expect(recordingFeedback(video, 'BROLL', 3)).toContain('SHORTER_THAN_TARGET');
  expect(recordingFeedback(video, 'BROLL', 1)).toContain('LONGER_THAN_TARGET');
  expect(() =>
    recordingFeedback(
      {
        container: 'wav',
        durationMs: 10,
        probeVersion: 'fixture',
        audio: { codec: 'pcm_s16le', sampleRate: 16000, channels: 1 },
      },
      'SCREEN_VIDEO',
    ),
  ).toThrow('VIDEO_MISSING');
});
it('probes actual deterministic WAV bytes regardless of extension and rejects unreadable files', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'vce-probe-test-'));
  try {
    const path = join(dir, 'not-a-wave.jpg');
    await writeFile(path, wav());
    expect(await probeFile(path)).toMatchObject({
      durationMs: 500,
      audio: { sampleRate: 16000, channels: 1 },
    });
    await writeFile(path, 'invalid');
    await expect(probeFile(path)).rejects.toThrow('MEDIA_UNREADABLE');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
it('blocks playlist/network probing instead of following arbitrary media references', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'vce-probe-test-'));
  try {
    const path = join(dir, 'playlist');
    await writeFile(path, '#EXTM3U\n#EXTINF:10,\nhttp://127.0.0.1:9/private\n');
    await expect(probeFile(path)).rejects.toThrow('MEDIA_UNREADABLE');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it('probes a real SDR video fixture and rejects a real HLG-signalled fixture', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'vce-video-test-'));
  try {
    const sdr = join(dir, 'sdr.mp4');
    const hlg = join(dir, 'hlg.mp4');
    const input = [
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'color=c=green:s=180x320:r=25',
      '-t',
      '0.2',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
    ];
    execFileSync(
      'ffmpeg',
      [...input, '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', sdr],
      { timeout: 10000, stdio: 'pipe' },
    );
    expect((await probeFile(sdr)).video).toMatchObject({
      width: 180,
      height: 320,
      fps: 25,
      color: { hdrKind: 'SDR' },
    });
    execFileSync(
      'ffmpeg',
      [
        ...input,
        '-color_primaries',
        'bt2020',
        '-color_trc',
        'arib-std-b67',
        '-colorspace',
        'bt2020nc',
        hlg,
      ],
      { timeout: 10000, stdio: 'pipe' },
    );
    await expect(probeFile(hlg)).rejects.toThrow('UNSUPPORTED_HDR_COLOR');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it('cleans only expired owned upload temp directories after a crash', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vce-temp-test-'));
  const prefix = 'vce-upload-11111111-1111-4111-8111-111111111111-';
  try {
    const old = join(root, prefix + 'ABCdef'),
      fresh = join(root, prefix + 'GHIjkl'),
      unrelated = join(root, 'unrelated');
    await mkdir(old);
    await mkdir(fresh);
    await mkdir(unrelated);
    await writeFile(join(old, 'source'), 'incomplete');
    await utimes(old, new Date('2000-01-01T00:00:00Z'), new Date('2000-01-01T00:00:00Z'));
    await symlink(unrelated, join(root, prefix + 'MNOpqr'));
    expect(await cleanAbandonedUploadTemps(root)).toBe(1);
    await expect(access(old)).rejects.toThrow();
    await expect(access(fresh)).resolves.toBeUndefined();
    await expect(access(unrelated)).resolves.toBeUndefined();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
