import { chmod, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  MountedCaptureAuthStateProvider,
  VISION_CAPTURE_AUTH_PROFILE_KEY,
} from '../../apps/worker-capture/src/index.js';

const directories: string[] = [];

async function workspace() {
  const directory = await mkdtemp(join(tmpdir(), 'vce-phase11b-auth-'));

  directories.push(directory);

  return directory;
}

async function validState(directory: string, mode = 0o600) {
  const path = join(directory, 'storage-state.json');

  await writeFile(
    path,
    JSON.stringify({
      cookies: [],
      origins: [],
    }),
    {
      mode,
    },
  );

  await chmod(path, mode);

  return path;
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, {
        recursive: true,
        force: true,
      }),
    ),
  );
});

describe('Phase 11B mounted Capture auth state', () => {
  it('rejects disabled activation before filesystem access', async () => {
    const provider = new MountedCaptureAuthStateProvider(
      '/definitely/not/a/vce/storage-state.json',
      () => false,
    );

    await expect(provider.storageStatePath(VISION_CAPTURE_AUTH_PROFILE_KEY)).rejects.toThrow(
      'CAPTURE_ACTIVATION_DISABLED',
    );
  });

  it('accepts the reviewed profile with a private regular file', async () => {
    const directory = await workspace();
    const path = await validState(directory);

    const provider = new MountedCaptureAuthStateProvider(path, () => true);

    await expect(provider.storageStatePath(VISION_CAPTURE_AUTH_PROFILE_KEY)).resolves.toBe(path);

    await expect(provider.storageStatePath('UNKNOWN_PROFILE')).rejects.toThrow(
      'CAPTURE_AUTH_PROFILE_UNAUTHORIZED',
    );
  });

  it('rejects relative and unavailable paths', async () => {
    const relative = new MountedCaptureAuthStateProvider('storage-state.json', () => true);

    await expect(relative.storageStatePath(VISION_CAPTURE_AUTH_PROFILE_KEY)).rejects.toThrow(
      'CAPTURE_AUTH_STATE_PATH_NOT_ABSOLUTE',
    );

    const missing = new MountedCaptureAuthStateProvider(
      '/definitely/not/a/vce/storage-state.json',
      () => true,
    );

    await expect(missing.storageStatePath(VISION_CAPTURE_AUTH_PROFILE_KEY)).rejects.toThrow(
      'CAPTURE_AUTH_STATE_UNAVAILABLE',
    );
  });

  it('rejects unsafe permissions and symbolic links', async () => {
    const directory = await workspace();

    const unsafePath = await validState(directory, 0o644);

    const unsafe = new MountedCaptureAuthStateProvider(unsafePath, () => true);

    await expect(unsafe.storageStatePath(VISION_CAPTURE_AUTH_PROFILE_KEY)).rejects.toThrow(
      'CAPTURE_AUTH_STATE_PERMISSIONS_UNSAFE',
    );

    const privatePath = await validState(directory, 0o600);

    const linkPath = join(directory, 'state-link.json');

    await symlink(privatePath, linkPath);

    const linked = new MountedCaptureAuthStateProvider(linkPath, () => true);

    await expect(linked.storageStatePath(VISION_CAPTURE_AUTH_PROFILE_KEY)).rejects.toThrow(
      'CAPTURE_AUTH_STATE_NOT_REGULAR_FILE',
    );
  });

  it('rejects malformed or invalid storage-state JSON', async () => {
    const directory = await workspace();

    const malformed = join(directory, 'malformed.json');

    await writeFile(malformed, '{', {
      mode: 0o600,
    });

    await chmod(malformed, 0o600);

    const malformedProvider = new MountedCaptureAuthStateProvider(malformed, () => true);

    await expect(
      malformedProvider.storageStatePath(VISION_CAPTURE_AUTH_PROFILE_KEY),
    ).rejects.toThrow('CAPTURE_AUTH_STATE_INVALID');

    const invalid = join(directory, 'invalid.json');

    await writeFile(
      invalid,
      JSON.stringify({
        cookies: 'not-an-array',
        origins: [],
      }),
      {
        mode: 0o600,
      },
    );

    await chmod(invalid, 0o600);

    const invalidProvider = new MountedCaptureAuthStateProvider(invalid, () => true);

    await expect(invalidProvider.storageStatePath(VISION_CAPTURE_AUTH_PROFILE_KEY)).rejects.toThrow(
      'CAPTURE_AUTH_STATE_INVALID',
    );
  });
});
