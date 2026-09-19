import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { z } from 'zod';
import { PatternVersionSpecSchema } from '../../docs/spec-artifacts/pattern-library/schema';
import { EditingProfileVersionSpecSchema } from '../../docs/spec-artifacts/editing-intelligence/schema';
import { TemplateRuntimeContractSchema } from '../../docs/spec-artifacts/video-engine/schema';
import { CaptureScenarioVersionSpecSchema } from '../../docs/spec-artifacts/product-capture/schema';

const base = 'docs/spec-artifacts';
async function json(path: string): Promise<unknown> {
  return JSON.parse(await readFile(join(base, path), 'utf8'));
}
async function entries(directory: string): Promise<unknown[]> {
  return Promise.all(
    (await readdir(join(base, directory)))
      .filter((name) => name.endsWith('.json'))
      .sort()
      .map((name) => json(`${directory}/${name}`)),
  );
}
const record = z.record(z.string(), z.unknown());

it('loads the eight pattern and seven editing profile seeds using frozen contracts', async () => {
  const patterns = (await entries('pattern-library/seeds')).map((input) =>
    PatternVersionSpecSchema.parse(input),
  );
  const profiles = (await entries('editing-intelligence/profiles')).map((input) =>
    EditingProfileVersionSpecSchema.parse(input),
  );
  expect(patterns).toHaveLength(8);
  expect(profiles).toHaveLength(7);
  expect(new Set(patterns.map((pattern) => pattern.identity.patternKey)).size).toBe(8);
  const profileKeys = profiles.map((profile) => profile.identity.key);
  for (const pattern of patterns)
    for (const key of pattern.adaptation.compatibleEditingProfileKeys)
      expect(profileKeys).toContain(key);
  const motion = z
    .object({ presets: record })
    .parse(await json('video-engine/motion-registry.json'));
  const transitions = z
    .object({ presets: record })
    .parse(await json('video-engine/transition-registry.json'));
  const presets = [...Object.keys(motion.presets), ...Object.keys(transitions.presets)];
  for (const profile of profiles)
    for (const key of profile.motion.allowedPresetKeys) expect(presets).toContain(key);
});

it('resolves the five template export envelopes without changing runtime contracts', async () => {
  const templates = await entries('templates');
  expect(templates).toHaveLength(5);
  const registries = {
    supportedMotionPresetKeys: ['video-engine/motion-registry.json', 'presets'],
    supportedTransitionPresetKeys: ['video-engine/transition-registry.json', 'presets'],
    supportedChromaKeyProfileKeys: ['video-engine/chroma-key-profiles.json', 'profiles'],
    supportedColorProfileKeys: ['video-engine/color-profiles.json', 'profiles'],
    supportedCodecProfileKeys: ['video-engine/codec-profiles.json', 'profiles'],
    supportedAudioProfileKeys: ['video-engine/audio-profiles.json', 'profiles'],
  } as const;
  for (const input of templates) {
    const envelope = record.parse(input);
    const runtime = Object.fromEntries(
      Object.entries(envelope).filter(
        ([key]) => !['templateKey', 'name', 'version', 'sourceRevision'].includes(key),
      ),
    );
    const template = TemplateRuntimeContractSchema.parse(runtime);
    for (const [field, [path, section]] of Object.entries(registries)) {
      const registry = record.parse(await json(path));
      const keys = Object.keys(record.parse(registry[section]));
      for (const key of template[field as keyof typeof registries]) expect(keys).toContain(key);
    }
  }
});

it('resolves named browser/safety profiles for all five capture scenarios without execution', async () => {
  const browsers = z
    .object({ profiles: record })
    .parse(await json('product-capture/browser-profiles.json'));
  const policies = z
    .object({ policies: record })
    .parse(await json('product-capture/safety-policies.json'));
  const scenarios = await entries('product-capture/scenarios');
  expect(scenarios).toHaveLength(5);
  for (const input of scenarios) {
    const envelope = record.parse(input);
    const browserKey = z.string().parse(envelope.browserProfileKey);
    const safetyKey = z.string().parse(envelope.safetyPolicyKey);
    const environment = z
      .object({ allowedOrigins: z.array(z.string()) })
      .parse(envelope.environment);
    const runtime = Object.fromEntries(
      Object.entries(envelope).filter(
        ([key]) => !['browserProfileKey', 'safetyPolicyKey'].includes(key),
      ),
    );
    expect(() =>
      CaptureScenarioVersionSpecSchema.parse({
        ...runtime,
        browser: browsers.profiles[browserKey],
        safety: {
          ...record.parse(policies.policies[safetyKey]),
          allowedOrigins: environment.allowedOrigins,
        },
      }),
    ).not.toThrow();
  }
});
