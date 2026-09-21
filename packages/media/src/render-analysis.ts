import { execFile } from 'node:child_process';

function execCapture(
  command: string,
  args: string[],
  timeout = 60_000,
  options: Readonly<{ allowMissingStream?: boolean }> = {},
) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    execFile(
      command,
      args,
      { timeout, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8' },
      (error, stdout, stderr) => {
        if (error) {
          const diagnostic = stderr ?? '';
          if (
            options.allowMissingStream &&
            /does not contain any stream|matches no streams|stream specifier.*matches no streams/i.test(
              diagnostic,
            )
          ) {
            resolve({ stdout: stdout ?? '', stderr: diagnostic });
            return;
          }

          const failure = new Error(`${command.toUpperCase()}_FAILED`);
          Object.assign(failure, { cause: error, stderr: diagnostic.slice(-16_000) });
          reject(failure);
          return;
        }
        resolve({ stdout: stdout ?? '', stderr: stderr ?? '' });
      },
    );
  });
}

function secondsToMs(value: string) {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.round(seconds * 1000) : 0;
}

export async function inspectBlackAndSilence(path: string) {
  const [{ stderr: blackStderr }, { stderr: silenceStderr }] = await Promise.all([
    execCapture('ffmpeg', [
      '-hide_banner',
      '-nostats',
      '-i',
      path,
      '-an',
      '-vf',
      'blackdetect=d=0.20:pix_th=0.10',
      '-f',
      'null',
      '-',
    ]),
    execCapture(
      'ffmpeg',
      [
        '-hide_banner',
        '-nostats',
        '-i',
        path,
        '-vn',
        '-af',
        'silencedetect=noise=-50dB:d=0.20',
        '-f',
        'null',
        '-',
      ],
      60_000,
      { allowMissingStream: true },
    ),
  ]);

  let blackDurationMs = 0;
  for (const match of blackStderr.matchAll(/black_duration:([0-9.]+)/g))
    blackDurationMs += secondsToMs(match[1]!);

  let silenceDurationMs = 0;
  for (const match of silenceStderr.matchAll(/silence_duration:\s*([0-9.]+)/g))
    silenceDurationMs += secondsToMs(match[1]!);

  return { blackDurationMs, silenceDurationMs } as const;
}

export async function ffmpegVersion() {
  const { stdout } = await execCapture('ffmpeg', ['-version'], 10_000);
  return stdout.split(/\r?\n/, 1)[0] ?? 'ffmpeg-unknown';
}
