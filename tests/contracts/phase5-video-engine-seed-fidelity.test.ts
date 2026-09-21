import { readFile } from 'node:fs/promises';

import { expect, it } from 'vitest';

const pairs = [
  [
    'docs/spec-artifacts/video-engine/motion-registry.json',
    'packages/application/video-engine-seeds/motion-registry.json',
  ],
  [
    'docs/spec-artifacts/video-engine/transition-registry.json',
    'packages/application/video-engine-seeds/transition-registry.json',
  ],
  [
    'docs/spec-artifacts/video-engine/chroma-key-profiles.json',
    'packages/application/video-engine-seeds/chroma-key-profiles.json',
  ],
  [
    'docs/spec-artifacts/video-engine/color-profiles.json',
    'packages/application/video-engine-seeds/color-profiles.json',
  ],
  [
    'docs/spec-artifacts/video-engine/audio-profiles.json',
    'packages/application/video-engine-seeds/audio-profiles.json',
  ],
  [
    'docs/spec-artifacts/video-engine/codec-profiles.json',
    'packages/application/video-engine-seeds/codec-profiles.json',
  ],
  [
    'docs/spec-artifacts/video-engine/template-contract.json',
    'packages/application/video-engine-seeds/template-contract.json',
  ],
] as const;

it('keeps deterministic Video Engine runtime seeds identical to the frozen artifacts', async () => {
  for (const [frozenPath, runtimePath] of pairs) {
    const [frozen, runtime] = await Promise.all([
      readFile(frozenPath, 'utf8'),
      readFile(runtimePath, 'utf8'),
    ]);

    expect(JSON.parse(runtime), runtimePath).toEqual(JSON.parse(frozen));
  }
});
