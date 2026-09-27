import { lstat, readFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';

import { invariant } from '@vision/domain';

import type { CaptureAuthStateProvider } from './fixture.js';

export const VISION_CAPTURE_AUTH_PROFILE_KEY = 'VISION_CAPTURE_ACCOUNT_V1';

export const CAPTURE_AUTH_STATE_MAX_BYTES = 1024 * 1024;

function validateStorageState(value: unknown): void {
  invariant(
    typeof value === 'object' && value !== null && !Array.isArray(value),
    'CAPTURE_AUTH_STATE_INVALID',
  );

  const state = value as Record<string, unknown>;

  invariant(
    Array.isArray(state.cookies) && Array.isArray(state.origins),
    'CAPTURE_AUTH_STATE_INVALID',
  );
}

export class MountedCaptureAuthStateProvider implements CaptureAuthStateProvider {
  constructor(
    private readonly mountedStorageStatePath: string | undefined,
    private readonly activationEnabled: () => boolean,
    private readonly maxBytes = CAPTURE_AUTH_STATE_MAX_BYTES,
  ) {}

  async storageStatePath(authProfileKey: string): Promise<string> {
    invariant(this.activationEnabled(), 'CAPTURE_ACTIVATION_DISABLED');

    invariant(
      authProfileKey === VISION_CAPTURE_AUTH_PROFILE_KEY,
      'CAPTURE_AUTH_PROFILE_UNAUTHORIZED',
    );

    const path = this.mountedStorageStatePath;

    invariant(typeof path === 'string' && path.length > 0, 'CAPTURE_AUTH_PROFILE_NOT_CONFIGURED');

    invariant(isAbsolute(path), 'CAPTURE_AUTH_STATE_PATH_NOT_ABSOLUTE');

    let info;

    try {
      info = await lstat(path);
    } catch {
      invariant(false, 'CAPTURE_AUTH_STATE_UNAVAILABLE');
    }

    invariant(info.isFile(), 'CAPTURE_AUTH_STATE_NOT_REGULAR_FILE');

    invariant((info.mode & 0o077) === 0, 'CAPTURE_AUTH_STATE_PERMISSIONS_UNSAFE');

    invariant(info.size > 0 && info.size <= this.maxBytes, 'CAPTURE_AUTH_STATE_SIZE_INVALID');

    let serialized: string;

    try {
      serialized = await readFile(path, 'utf8');
    } catch {
      invariant(false, 'CAPTURE_AUTH_STATE_UNREADABLE');
    }

    let parsed: unknown;

    try {
      parsed = JSON.parse(serialized);
    } catch {
      invariant(false, 'CAPTURE_AUTH_STATE_INVALID');
    }

    validateStorageState(parsed);

    return path;
  }
}
