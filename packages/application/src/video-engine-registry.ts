import { z } from 'zod';

import motionRegistryJson from '../video-engine-seeds/motion-registry.json' with { type: 'json' };
import transitionRegistryJson from '../video-engine-seeds/transition-registry.json' with { type: 'json' };
import chromaRegistryJson from '../video-engine-seeds/chroma-key-profiles.json' with { type: 'json' };
import colorRegistryJson from '../video-engine-seeds/color-profiles.json' with { type: 'json' };
import codecRegistryJson from '../video-engine-seeds/codec-profiles.json' with { type: 'json' };
import audioRegistryJson from '../video-engine-seeds/audio-profiles.json' with { type: 'json' };
import templateContractJson from '../video-engine-seeds/template-contract.json' with { type: 'json' };

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

const templateContractSchema = z
  .object({
    specVersion: z.literal('v1'),
    canvas: z
      .object({
        width: z.literal(1080),
        height: z.literal(1920),
        allowedFps: z.array(z.number().positive()).min(1),
      })
      .strict(),
    requiredRendererApiVersion: z.string().min(1),
    defaultProfiles: z
      .object({
        color: z.string().min(1),
        audio: z.string().min(1),
        codec: z.string().min(1),
      })
      .strict(),
  })
  .strict();

const motionRegistry = presetRegistrySchema.parse(motionRegistryJson);
const transitionRegistry = presetRegistrySchema.parse(transitionRegistryJson);
const chromaRegistry = profileRegistrySchema.parse(chromaRegistryJson);
const colorRegistry = profileRegistrySchema.parse(colorRegistryJson);
const codecRegistry = profileRegistrySchema.parse(codecRegistryJson);
const audioRegistry = profileRegistrySchema.parse(audioRegistryJson);
const templateContract = templateContractSchema.parse(templateContractJson);

export const VIDEO_ENGINE_REGISTRY_KEYS = Object.freeze({
  motionPresetKeys: Object.freeze(Object.keys(motionRegistry.presets)),

  transitionPresetKeys: Object.freeze(Object.keys(transitionRegistry.presets)),

  chromaKeyProfileKeys: Object.freeze(Object.keys(chromaRegistry.profiles)),

  colorProfileKeys: Object.freeze(Object.keys(colorRegistry.profiles)),

  codecProfileKeys: Object.freeze(Object.keys(codecRegistry.profiles)),

  audioProfileKeys: Object.freeze(Object.keys(audioRegistry.profiles)),
});

export const VIDEO_ENGINE_TEMPLATE_CONTRACT = Object.freeze({
  specVersion: templateContract.specVersion,

  canvas: Object.freeze({
    width: templateContract.canvas.width,

    height: templateContract.canvas.height,

    allowedFps: Object.freeze([...templateContract.canvas.allowedFps]),
  }),

  requiredRendererApiVersion: templateContract.requiredRendererApiVersion,

  defaultProfiles: Object.freeze({
    ...templateContract.defaultProfiles,
  }),
});

export const VIDEO_ENGINE_PROFILES = Object.freeze({
  chroma: Object.freeze(chromaRegistry.profiles),
  color: Object.freeze(colorRegistry.profiles),
  codec: Object.freeze(codecRegistry.profiles),
  audio: Object.freeze(audioRegistry.profiles),
  motion: Object.freeze(motionRegistry.presets),
  transition: Object.freeze(transitionRegistry.presets),
});
