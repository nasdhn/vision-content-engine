import { EditingProfileVersionSpecSchema } from '@vision/contracts';
import { contentHash } from '@vision/contracts/canonical';
import { assertHuman, invariant } from '@vision/domain';

import type { Prisma } from './generated/prisma/client.js';
import { changed } from './transaction.js';
import type { Actor, Transaction } from './transaction.js';
import { Versions } from './versions.js';

type EditingProfileSpec = ReturnType<typeof EditingProfileVersionSpecSchema.parse>;

function persistedVersion(spec: EditingProfileSpec) {
  return {
    id: spec.identity.editingProfileVersionId,

    pacingRulesJson: spec.pacing as Prisma.InputJsonValue,

    cutRulesJson: spec.cuts as Prisma.InputJsonValue,

    captionRulesJson: spec.captions as Prisma.InputJsonValue,

    focusRulesJson: spec.focus as Prisma.InputJsonValue,

    motionRulesJson: spec.motion as Prisma.InputJsonValue,

    soundRulesJson: spec.audio as Prisma.InputJsonValue,

    hookRulesJson: spec.hook as Prisma.InputJsonValue,

    endingRulesJson: spec.ending as Prisma.InputJsonValue,

    /*
     * The canonical Prisma V1 schema predates the final
     * EditingProfile contract and has no dedicated columns
     * for presenter/constraints. Preserve both losslessly in
     * this deterministic envelope rather than adding a
     * Phase-5-only migration.
     */
    greenScreenRulesJson: {
      presenter: spec.presenter,
      constraints: spec.constraints,
    } as Prisma.InputJsonObject,
  };
}

type PersistedJson = Prisma.JsonValue | Prisma.InputJsonValue | null;

function persistedHash(value: {
  id: string;

  pacingRulesJson: PersistedJson;

  cutRulesJson: PersistedJson;

  captionRulesJson: PersistedJson;

  focusRulesJson: PersistedJson;

  motionRulesJson: PersistedJson;

  soundRulesJson: PersistedJson;

  hookRulesJson: PersistedJson;

  endingRulesJson: PersistedJson;

  greenScreenRulesJson: PersistedJson;
}) {
  return contentHash({
    id: value.id,
    pacingRulesJson: value.pacingRulesJson,
    cutRulesJson: value.cutRulesJson,
    captionRulesJson: value.captionRulesJson,
    focusRulesJson: value.focusRulesJson,
    motionRulesJson: value.motionRulesJson,
    soundRulesJson: value.soundRulesJson,
    hookRulesJson: value.hookRulesJson,
    endingRulesJson: value.endingRulesJson,
    greenScreenRulesJson: value.greenScreenRulesJson,
  });
}

export class EditingProfiles {
  constructor(
    private readonly tx: Transaction,
    private readonly actor: Actor,
  ) {}

  async importSeed(input: unknown) {
    assertHuman(this.actor);

    const spec = EditingProfileVersionSpecSchema.parse(input);

    const expected = persistedVersion(spec);

    await this.tx.$executeRaw`
      SELECT pg_advisory_xact_lock(
        hashtextextended(
          'editing-profile-seed-import',
          0
        )
      )
    `;

    let root = await this.tx.editingProfile.findUnique({
      where: {
        key: spec.identity.key,
      },
      include: {
        versions: true,
      },
    });

    if (root) {
      invariant(root.name === spec.identity.name, 'EDITING_PROFILE_IDENTITY_MISMATCH');

      invariant(root.status === 'ACTIVE', 'EDITING_PROFILE_NOT_ACTIVE');

      const existing = root.versions.find((version) => version.version === spec.identity.version);

      invariant(existing, 'EDITING_PROFILE_SEED_VERSION_CONFLICT');

      invariant(
        existing.id === spec.identity.editingProfileVersionId,
        'EDITING_PROFILE_VERSION_ID_CONFLICT',
      );

      invariant(
        persistedHash(existing) ===
          persistedHash({
            ...expected,
          }),
        'EDITING_PROFILE_SEED_CONTENT_CONFLICT',
      );

      return {
        specVersionId: spec.identity.editingProfileVersionId,

        editingProfileVersionId: existing.id,

        editingProfileId: root.id,
      };
    }

    invariant(spec.identity.version === 1, 'EDITING_PROFILE_SEED_INITIAL_VERSION_REQUIRED');

    root = await this.tx.editingProfile.create({
      data: {
        key: spec.identity.key,
        name: spec.identity.name,
      },
      include: {
        versions: true,
      },
    });

    await changed(this.tx, this.actor, 'EditingProfile.created', 'EditingProfile', root.id);

    const version = await new Versions(this.tx, this.actor).editingProfileVersion({
      id: expected.id,

      editingProfileId: root.id,

      pacingRulesJson: expected.pacingRulesJson,

      cutRulesJson: expected.cutRulesJson,

      captionRulesJson: expected.captionRulesJson,

      focusRulesJson: expected.focusRulesJson,

      motionRulesJson: expected.motionRulesJson,

      soundRulesJson: expected.soundRulesJson,

      hookRulesJson: expected.hookRulesJson,

      endingRulesJson: expected.endingRulesJson,

      greenScreenRulesJson: expected.greenScreenRulesJson,
    });

    await this.tx.editingProfile.update({
      where: {
        id: root.id,
      },
      data: {
        status: 'ACTIVE',
      },
    });

    await changed(
      this.tx,
      this.actor,
      'EditingProfile.activated',
      'EditingProfile',
      root.id,
      version.id,
    );

    return {
      specVersionId: spec.identity.editingProfileVersionId,

      editingProfileVersionId: version.id,

      editingProfileId: root.id,
    };
  }
}
