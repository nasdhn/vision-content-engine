import 'dotenv/config';
import { parseConfig } from '@vision/shared';
import { createApi } from './app.js';
import { createLocalDependencies } from './local-dependencies.js';

async function main() {
  const config = parseConfig(process.env);
  const dependencies = createLocalDependencies(config);
  try {
    const app = await createApi(dependencies.probes);
    const close = async () => {
      await app.close();
      await dependencies.close();
    };
    process.once('SIGINT', () => {
      void close();
    });
    process.once('SIGTERM', () => {
      void close();
    });
    await app.listen(config.VCE_API_PORT, config.VCE_API_HOST);
    console.log(
      JSON.stringify({
        level: 'info',
        service: 'api',
        message: 'Local Phase 0 health endpoints started',
      }),
    );
  } catch {
    await dependencies.close();
    throw new Error('BOOTSTRAP_STARTUP_FAILED');
  }
}

main().catch(() => {
  console.error(
    JSON.stringify({ level: 'error', service: 'api', errorCode: 'BOOTSTRAP_STARTUP_FAILED' }),
  );
  process.exitCode = 1;
});
