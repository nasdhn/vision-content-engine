import { readFile, readdir } from 'node:fs/promises';

import type { z } from 'zod';

import { EditingProfileVersionSpecSchema } from '@vision/contracts';
import { invariant } from '@vision/domain';

export type EditingProfileSpec = z.infer<typeof EditingProfileVersionSpecSchema>;

export const EXPECTED_EDITING_PROFILE_KEYS = [
  'FAST_PRODUCT_DEMO',
  'FOUNDER_STORY',
  'GREEN_SCREEN_EXPLAINER',
  'PROBLEM_SOLUTION',
  'MANUAL_VS_VISION',
  'HIGH_ENERGY_SHORT',
  'CALM_EXPERT_SHORT',
] as const;

export class EditingProfileRegistry {
  private cached: Promise<readonly EditingProfileSpec[]> | undefined;

  private load() {
    this.cached ??= this.loadUncached();

    return this.cached;
  }

  private async loadUncached() {
    const directory = new URL('../editing-profile-seeds/', import.meta.url);

    const files = (await readdir(directory)).filter((name) => name.endsWith('.json')).sort();

    invariant(
      files.length === EXPECTED_EDITING_PROFILE_KEYS.length,
      'EDITING_PROFILE_SEED_COUNT_INVALID',
    );

    const profiles = await Promise.all(
      files.map(async (file) =>
        EditingProfileVersionSpecSchema.parse(
          JSON.parse(await readFile(new URL(file, directory), 'utf8')) as unknown,
        ),
      ),
    );

    invariant(
      new Set(profiles.map((profile) => profile.identity.key)).size === profiles.length,
      'DUPLICATE_EDITING_PROFILE_KEY',
    );

    invariant(
      new Set(profiles.map((profile) => profile.identity.editingProfileVersionId)).size ===
        profiles.length,
      'DUPLICATE_EDITING_PROFILE_VERSION_ID',
    );

    for (const key of EXPECTED_EDITING_PROFILE_KEYS) {
      invariant(
        profiles.some((profile) => profile.identity.key === key),
        'EDITING_PROFILE_SEED_MISSING',
      );
    }

    /*
     * Preserve the accepted V1 semantic order,
     * independent of filesystem ordering.
     */
    const ordered = EXPECTED_EDITING_PROFILE_KEYS.map((key) => {
      const profile = profiles.find((entry) => entry.identity.key === key);

      invariant(profile, 'EDITING_PROFILE_SEED_MISSING');

      return profile;
    });

    return Object.freeze(ordered);
  }

  async list() {
    return this.load();
  }

  async getByKey(key: string) {
    const profile = (await this.load()).find((entry) => entry.identity.key === key);

    invariant(profile, 'EDITING_PROFILE_NOT_FOUND');

    return profile;
  }

  async getBySpecVersionId(id: string) {
    const profile = (await this.load()).find(
      (entry) => entry.identity.editingProfileVersionId === id,
    );

    invariant(profile, 'EDITING_PROFILE_VERSION_NOT_FOUND');

    return profile;
  }
}
