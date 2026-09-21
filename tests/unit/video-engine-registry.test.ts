import { expect, it } from 'vitest';

import { VIDEO_ENGINE_REGISTRY_KEYS } from '../../packages/application/src/video-engine-registry.js';

it('loads the frozen deterministic Video Engine registries', () => {
  expect(VIDEO_ENGINE_REGISTRY_KEYS.motionPresetKeys).toContain('FOCUS_ZOOM');

  expect(VIDEO_ENGINE_REGISTRY_KEYS.transitionPresetKeys).toContain('CUT');

  expect(VIDEO_ENGINE_REGISTRY_KEYS.chromaKeyProfileKeys).toContain('GREENSCREEN_STANDARD_V1');

  expect(VIDEO_ENGINE_REGISTRY_KEYS.codecProfileKeys).toEqual(['SOCIAL_H264_AAC_V1']);

  expect(VIDEO_ENGINE_REGISTRY_KEYS.audioProfileKeys).toEqual(['SOCIAL_VOICE_MASTER_V1']);
});
