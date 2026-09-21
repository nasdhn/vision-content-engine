import { postgresFixture } from '../../packages/database/test/support.js';
import { createApi } from '../../apps/api/src/app.js';
import {
  DashboardReadService,
  RecordingPackService,
} from '../../packages/application/src/index.js';
import { MemoryStorage, recordingGraph } from '../fixtures/recordings/support.js';

const fixture = await postgresFixture();
const recordings = new RecordingPackService(fixture.client, new MemoryStorage());
const dashboard = new DashboardReadService(fixture.client);

const app = await createApi(
  {
    postgres: async () => {},
    redis: async () => {},
    storage: async () => {},
  },
  {
    auth: {
      accessKey: 'fixture-local-recording-access-key',
      origin: 'http://localhost:5174',
    },
    recordings,
    dashboard,
  },
);

let closing = false;

async function close() {
  if (closing) return;
  closing = true;
  await app.close();
  await fixture.close();
  process.exit(0);
}

process.once('SIGTERM', () => {
  void close();
});

process.once('SIGINT', () => {
  void close();
});

try {
  await recordingGraph(fixture.client);
  await app.listen(3100, '127.0.0.1');
} catch {
  await close();
}
