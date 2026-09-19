import 'dotenv/config';
import { checkLocalInfra } from '../apps/api/src/local-canary.js';

checkLocalInfra().catch(() => {
  console.error('LOCAL_INFRA_CHECK_FAILED (details suppressed to protect credentials)');
  process.exitCode = 1;
});
