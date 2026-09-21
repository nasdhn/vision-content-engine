import { z } from 'zod';

import motionRegistryJson from '../video-engine-seeds/motion-registry.json' with { type: 'json' };
import transitionRegistryJson from '../video-engine-seeds/transition-registry.json' with { type: 'json' };
import chromaRegistryJson from '../video-engine-seeds/chroma-key-profiles.json' with { type: 'json' };
import codecRegistryJson from '../video-engine-seeds/codec-profiles.json' with { type: 'json' };
import audioRegistryJson from '../video-engine-seeds/audio-profiles.json' with { type: 'json' };

const presetRegistrySchema = z
  .object({
    version: z.string().min(1),
    presets: z.record(z.string(), z.unknown()),
  })
  .strict();

const profileRegistrySchema = z
  .object({
    version: z.string().min(1),
    profiles: z.record(z.string(), z.unknown()),
  })
  .strict();

const motionRegistry = presetRegistrySchema.parse(motionRegistryJson);
const transitionRegistry = presetRegistrySchema.parse(transitionRegistryJson);
const chromaRegistry = profileRegistrySchema.parse(chromaRegistryJson);
const codecRegistry = profileRegistrySchema.parse(codecRegistryJson);
const audioRegistry = profileRegistrySchema.parse(audioRegistryJson);

export const VIDEO_ENGINE_REGISTRY_KEYS = Object.freeze({
  motionPresetKeys: Object.freeze(Object.keys(motionRegistry.presets)),

  transitionPresetKeys: Object.freeze(Object.keys(transitionRegistry.presets)),

  chromaKeyProfileKeys: Object.freeze(Object.keys(chromaRegistry.profiles)),

  codecProfileKeys: Object.freeze(Object.keys(codecRegistry.profiles)),

  audioProfileKeys: Object.freeze(Object.keys(audioRegistry.profiles)),
});
