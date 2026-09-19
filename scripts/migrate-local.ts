import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import { createDatabaseClient } from '../packages/database/src/client.js';

async function main() {
  const value = process.env.DATABASE_URL;
  const url = new URL(value ?? '');
  if (
    (process.env.VCE_ENV ?? 'LOCAL') !== 'LOCAL' ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    url.pathname !== '/vision_content_engine'
  )
    throw new Error('LOCAL_DATABASE_REQUIRED');
  const db = createDatabaseClient(value!);
  try {
    const tables = await db.$queryRaw<
      { table_name: string }[]
    >`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`;
    if (tables.length && !tables.some((table) => table.table_name === '_prisma_migrations'))
      throw new Error('UNMANAGED_DATABASE');
  } finally {
    await db.$disconnect();
  }
  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], { stdio: 'inherit' });
}
main().catch(() => {
  console.error('LOCAL_MIGRATION_FAILED (connection details suppressed)');
  process.exitCode = 1;
});
