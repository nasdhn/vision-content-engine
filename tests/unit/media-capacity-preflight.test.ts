import { mkdtemp, rm, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, it, vi } from 'vitest';
import { CapacityGuard } from '../../packages/media/src/index.js';
import { CaptureScenarioRegistry } from '../../packages/application/src/capture-registry.js';
import { executeCaptureScenario } from '../../apps/worker-capture/src/executor.js';
import { RemotionVideoRenderer } from '../../apps/worker-render/src/remotion-renderer.js';
import { normalizeHdrToSdr } from '../../apps/worker-render/src/ffmpeg.js';
import { StructuredLogger } from '../../packages/observability/src/index.js';
const denied = new CapacityGuard(
  undefined,
  async () => ({ bavail: 0n, bsize: 1n, blocks: 1n }),
  new StructuredLogger('api', () => {}),
);
it('denies direct capture before fixture/browser startup or local writes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vce-preflight-test-'));
  const prepare = vi.fn();
  try {
    const { spec } = await new CaptureScenarioRegistry().getByKey('AGENT_QUERY_TO_RESULTS');
    const request = {
      scenario: spec,
      input: { query: 'capacity fixture' },
      outputDirectory: join(root, 'capture'),
      fixtureManager: { prepare },
      authStateProvider: { storageStatePath: async () => undefined },
      capacity: denied,
    };
    await expect(executeCaptureScenario(request)).rejects.toThrow('INSUFFICIENT_LOCAL_CAPACITY');
    await expect(
      executeCaptureScenario({
        ...request,
        scenario: { ...spec, safety: { ...spec.safety, blockDownloads: false } },
      }),
    ).rejects.toThrow('CAPTURE_DOWNLOAD_UNBOUNDED');
    expect(prepare).not.toHaveBeenCalled();
    expect(await readdir(root)).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it('denies direct Remotion and FFmpeg before writing outputs or launching engines', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vce-preflight-test-'));
  try {
    await expect(
      new RemotionVideoRenderer(denied).render({ resolvedAssets: [] } as never, {
        workDir: join(root, 'render'),
      }),
    ).rejects.toThrow('INSUFFICIENT_LOCAL_CAPACITY');
    expect(await readdir(root)).toEqual([]);
    const sourcePath = join(root, 'source');
    await writeFile(sourcePath, 'synthetic');
    await expect(
      normalizeHdrToSdr({ sourcePath, outputPath: join(root, 'output.mp4'), capacity: denied }),
    ).rejects.toThrow('INSUFFICIENT_LOCAL_CAPACITY');
    expect(await readdir(root)).toEqual(['source']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
