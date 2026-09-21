import { expect, it } from 'vitest';

import {
  EditingProfileRegistry,
  EXPECTED_EDITING_PROFILE_KEYS,
} from '../../packages/application/src/editing-profile-registry.js';

it('loads exactly the seven accepted V1 EditingProfiles in canonical order', async () => {
  const registry = new EditingProfileRegistry();

  const profiles = await registry.list();

  expect(profiles).toHaveLength(7);

  expect(profiles.map((profile) => profile.identity.key)).toEqual(EXPECTED_EDITING_PROFILE_KEYS);

  expect(new Set(profiles.map((profile) => profile.identity.editingProfileVersionId)).size).toBe(7);
});

it('resolves an EditingProfile by key and immutable spec version id', async () => {
  const registry = new EditingProfileRegistry();

  const profile = await registry.getByKey('GREEN_SCREEN_EXPLAINER');

  expect(profile.identity).toMatchObject({
    key: 'GREEN_SCREEN_EXPLAINER',
    version: 1,
    editingProfileVersionId: '018f1000-0000-7000-8000-000000000003',
  });

  await expect(
    registry.getBySpecVersionId(profile.identity.editingProfileVersionId),
  ).resolves.toEqual(profile);
});

it('fails closed for unknown profile identities', async () => {
  const registry = new EditingProfileRegistry();

  await expect(registry.getByKey('UNKNOWN_PROFILE')).rejects.toThrow('EDITING_PROFILE_NOT_FOUND');

  await expect(registry.getBySpecVersionId('018f1000-0000-7000-8000-000000000099')).rejects.toThrow(
    'EDITING_PROFILE_VERSION_NOT_FOUND',
  );
});

it('keeps accepted profile bounds internally coherent', async () => {
  const profiles = await new EditingProfileRegistry().list();

  for (const profile of profiles) {
    expect(profile.constraints.maxDurationMs).toBeGreaterThan(profile.constraints.minDurationMs);

    expect(profile.pacing.preferredAverageShotMs.max).toBeGreaterThanOrEqual(
      profile.pacing.preferredAverageShotMs.min,
    );

    expect(profile.captions.maximumCueMs).toBeGreaterThanOrEqual(profile.captions.minimumCueMs);

    expect(profile.presenter.preferredWidthPercent.max).toBeGreaterThanOrEqual(
      profile.presenter.preferredWidthPercent.min,
    );

    expect(profile.motion.defaultTransitionDurationMs.max).toBeGreaterThanOrEqual(
      profile.motion.defaultTransitionDurationMs.min,
    );
  }
});
