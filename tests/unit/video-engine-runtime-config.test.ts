import { expect, it } from 'vitest';

import {
  VIDEO_ENGINE_REGISTRY_KEYS,
  VIDEO_ENGINE_TEMPLATE_CONTRACT,
} from '../../packages/application/src/video-engine-registry.js';

it('loads the frozen color profile and renderer defaults at runtime', () => {
  expect(VIDEO_ENGINE_REGISTRY_KEYS.colorProfileKeys).toEqual(['SDR_BT709_SOCIAL_V1']);

  expect(VIDEO_ENGINE_TEMPLATE_CONTRACT).toMatchObject({
    requiredRendererApiVersion: 'v1',
    defaultProfiles: {
      color: 'SDR_BT709_SOCIAL_V1',
      audio: 'SOCIAL_VOICE_MASTER_V1',
      codec: 'SOCIAL_H264_AAC_V1',
    },
  });
});
