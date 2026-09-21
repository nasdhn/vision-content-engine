import { execFile } from 'node:child_process';

export type ProcessResult = Readonly<{
  stdout: string;
  stderr: string;
}>;

export function execOwned(
  command: string,
  args: readonly string[],
  options: Readonly<{
    timeoutMs: number;
    signal?: AbortSignal;
  }>,
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      [...args],
      {
        timeout: options.timeoutMs,
        maxBuffer: 8 * 1024 * 1024,
        encoding: 'utf8',
        ...(options.signal ? { signal: options.signal } : {}),
      },
      (error, stdout, stderr) => {
        if (error) {
          const failure = new Error(`${command.toUpperCase()}_FAILED`);
          Object.assign(failure, {
            cause: error,
            stderr: (stderr ?? '').slice(-16_000),
          });
          reject(failure);
          return;
        }
        resolve({
          stdout: stdout ?? '',
          stderr: stderr ?? '',
        });
      },
    );
  });
}
