import { readdir, lstat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
/** Only abandoned attempt directories in this application's reserved namespace.
 * One hour exceeds the bounded HTTP upload/probe/storage timeouts. Never follow symlinks. */
export async function cleanAbandonedUploadTemps(root = tmpdir(), now = Date.now()) {
  let removed = 0;
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^vce-upload-[0-9a-f-]{36}-[A-Za-z0-9]{6}$/.test(entry.name))
      continue;
    const path = join(root, entry.name);
    const info = await lstat(path);
    if (!info.isDirectory() || info.mtimeMs >= now - 3600000) continue;
    await rm(path, { recursive: true, force: true });
    removed++;
  }
  return removed;
}
