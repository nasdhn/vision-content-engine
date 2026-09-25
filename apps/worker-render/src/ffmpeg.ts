import { CapacityGuard } from '@vision/media';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

import { invariant } from '@vision/domain';

import { execOwned } from './process.js';

const X264_BT709_VUI = 'colorprim=bt709:transfer=bt709:colormatrix=bt709:fullrange=off';

type ChromaProfile = Readonly<{
  keyColor?: unknown;
  similarity?: unknown;
  blend?: unknown;
  spillReduction?: unknown;
  edgeTreatment?: unknown;
}>;

function number(value: unknown, code: string) {
  invariant(typeof value === 'number' && Number.isFinite(value), code);
  return value;
}

function string(value: unknown, code: string) {
  invariant(typeof value === 'string' && value.length > 0, code);
  return value;
}

export async function normalizeHdrToSdr(input: {
  sourcePath: string;
  outputPath: string;
  signal?: AbortSignal;
  capacity?: CapacityGuard;
}) {
  const capacity = input.capacity ?? new CapacityGuard();
  await capacity.file(input.sourcePath);
  await capacity.require(dirname(input.outputPath), capacity.policy.maxArtifactBytes);
  await mkdir(dirname(input.outputPath), { recursive: true });

  const filter = [
    'zscale=t=linear:npl=100',
    'format=gbrpf32le',
    'zscale=p=bt709',
    'tonemap=hable:desat=0',
    'zscale=t=bt709:m=bt709:r=tv',
    'format=yuv420p',
  ].join(',');

  await execOwned(
    'ffmpeg',
    [
      '-hide_banner',
      '-nostdin',
      '-y',
      '-i',
      input.sourcePath,
      '-map_metadata',
      '-1',
      '-vf',
      filter,
      '-c:v',
      'libx264',
      '-profile:v',
      'high',
      '-pix_fmt',
      'yuv420p',
      '-crf',
      '18',
      '-preset',
      'medium',
      '-color_primaries',
      'bt709',
      '-color_trc',
      'bt709',
      '-colorspace',
      'bt709',
      '-color_range',
      'tv',
      '-x264-params',
      X264_BT709_VUI,
      '-an',
      '-fs',
      String(capacity.policy.maxArtifactBytes),
      input.outputPath,
    ],
    {
      timeoutMs: 120_000,
      ...(input.signal ? { signal: input.signal } : {}),
    },
  );

  await capacity.file(input.outputPath);
  return input.outputPath;
}

export async function preprocessGreenScreen(input: {
  sourcePath: string;
  outputPath: string;
  profile: ChromaProfile;
  signal?: AbortSignal;
  capacity?: CapacityGuard;
}) {
  const capacity = input.capacity ?? new CapacityGuard();
  await capacity.file(input.sourcePath);
  await capacity.require(dirname(input.outputPath), capacity.policy.maxArtifactBytes);
  await mkdir(dirname(input.outputPath), { recursive: true });

  const keyColor = string(input.profile.keyColor, 'CHROMA_PROFILE_INVALID').replace('#', '0x');
  const similarity = number(input.profile.similarity, 'CHROMA_PROFILE_INVALID');
  const blend = number(input.profile.blend, 'CHROMA_PROFILE_INVALID');

  const filters = [
    `chromakey=${keyColor}:${similarity}:${blend}`,
    ...(input.profile.spillReduction === 'high'
      ? ['despill=green:mix=0.8']
      : input.profile.spillReduction === 'standard'
        ? ['despill=green:mix=0.5']
        : []),
    'format=yuva420p',
  ];

  await execOwned(
    'ffmpeg',
    [
      '-hide_banner',
      '-nostdin',
      '-y',
      '-i',
      input.sourcePath,
      '-map_metadata',
      '-1',
      '-vf',
      filters.join(','),
      '-c:v',
      'libvpx-vp9',
      '-pix_fmt',
      'yuva420p',
      '-auto-alt-ref',
      '0',
      '-an',
      '-fs',
      String(capacity.policy.maxArtifactBytes),
      input.outputPath,
    ],
    {
      timeoutMs: 120_000,
      ...(input.signal ? { signal: input.signal } : {}),
    },
  );

  await capacity.file(input.outputPath);
  return input.outputPath;
}

export async function postprocessSocialMaster(input: {
  sourcePath: string;
  outputPath: string;
  fps: number;
  audioExpected: boolean;
  integratedTargetLufs: number;
  truePeakCeilingDb: number;
  sampleRate: number;
  channels: number;
  signal?: AbortSignal;
  capacity?: CapacityGuard;
}) {
  const capacity = input.capacity ?? new CapacityGuard();
  await capacity.file(input.sourcePath);
  await capacity.require(dirname(input.outputPath), capacity.policy.maxArtifactBytes);
  await mkdir(dirname(input.outputPath), { recursive: true });

  const args = [
    '-hide_banner',
    '-nostdin',
    '-y',
    '-i',
    input.sourcePath,
    '-map_metadata',
    '-1',
    '-map',
    '0:v:0',
  ];

  if (input.audioExpected) args.push('-map', '0:a:0?');

  args.push(
    '-c:v',
    'libx264',
    '-profile:v',
    'high',
    '-pix_fmt',
    'yuv420p',
    '-crf',
    '18',
    '-preset',
    'medium',
    '-r',
    String(input.fps),
    '-color_primaries',
    'bt709',
    '-color_trc',
    'bt709',
    '-colorspace',
    'bt709',
    '-color_range',
    'tv',
    '-x264-params',
    X264_BT709_VUI,
  );

  if (input.audioExpected) {
    args.push(
      '-c:a',
      'aac',
      '-af',
      `loudnorm=I=${input.integratedTargetLufs}:TP=${input.truePeakCeilingDb}:LRA=11`,
      '-ar',
      String(input.sampleRate),
      '-ac',
      String(input.channels),
    );
  } else {
    args.push('-an');
  }

  args.push(
    '-movflags',
    '+faststart',
    '-fs',
    String(capacity.policy.maxArtifactBytes),
    input.outputPath,
  );

  await execOwned('ffmpeg', args, {
    timeoutMs: 180_000,
    ...(input.signal ? { signal: input.signal } : {}),
  });

  await capacity.file(input.outputPath);
  return input.outputPath;
}
