import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import pg from 'pg';
import { createDatabaseClient } from '../src/client.js';

/** Owns ONLY its freshly created disposable database; never clears the application DB. */
export async function postgresFixture() {
  const source = new URL(process.env.DATABASE_URL ?? '');
  if (
    !['localhost', '127.0.0.1', '[::1]'].includes(source.hostname) ||
    (process.env.VCE_ENV ?? 'LOCAL') !== 'LOCAL'
  )
    throw new Error('POSTGRES_TEST_REQUIRES_LOCAL');
  const name = `vce_phase1_test_${randomUUID().replaceAll('-', '')}`;
  const adminUrl = new URL(source);
  adminUrl.pathname = '/postgres';
  const admin = new pg.Pool({ connectionString: adminUrl.toString(), max: 2 });
  await admin.query(`CREATE DATABASE "${name}"`);
  const testUrl = new URL(source);
  testUrl.pathname = `/${name}`;
  const client = createDatabaseClient(testUrl.toString());
  const migrate = () =>
    execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
      env: { ...process.env, DATABASE_URL: testUrl.toString() },
      stdio: 'pipe',
    });
  const close = async () => {
    await client.$disconnect();
    await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    await admin.end();
  };
  try {
    migrate();
  } catch {
    await close();
    throw new Error('TEST_DATABASE_MIGRATION_FAILED');
  }
  return { client, migrate, close, url: testUrl.toString() };
}
