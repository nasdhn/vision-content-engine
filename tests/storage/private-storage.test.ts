import 'dotenv/config';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { s3Fixture } from '../../packages/media/test/s3-fixture.js';
import { wav } from '../fixtures/recordings/support.js';
let fixture: Awaited<ReturnType<typeof s3Fixture>>;
let directory: string, file: string;
beforeAll(async () => {
  fixture = await s3Fixture(process.env);
  directory = await mkdtemp(join(tmpdir(), 'vce-s3-test-'));
  file = join(directory, 'source');
  await writeFile(file, wav());
});
afterAll(async () => {
  await fixture?.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});
it('stores exact private bytes and refuses anonymous read', async () => {
  const key = fixture.key();
  await fixture.store.put(key, file, wav().length, 'audio/wav');
  const chunks = [];
  for await (const c of await fixture.store.get(key)) chunks.push(c);
  expect(Buffer.concat(chunks)).toEqual(wav());
  const anon = await fetch(`${fixture.endpoint}/${fixture.bucket}/${key}`);
  expect([401, 403]).toContain(anon.status);
});
it('refuses replacement at the same immutable key', async () => {
  const key = fixture.key();
  await fixture.store.put(key, file, wav().length, 'audio/wav');
  await expect(fixture.store.put(key, file, wav().length, 'audio/wav')).rejects.toThrow();
});
it('fails on missing canonical objects', async () => {
  await expect(fixture.store.get(fixture.key())).rejects.toThrow();
});
