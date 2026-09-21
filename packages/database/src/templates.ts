import { z } from 'zod';

import { TemplateRuntimeContractSchema } from '@vision/contracts';
import { contentHash } from '@vision/contracts/canonical';
import { assertHuman, invariant } from '@vision/domain';

import type { Prisma } from './generated/prisma/client.js';
import { changed } from './transaction.js';
import type { Actor, Transaction } from './transaction.js';
import { Versions } from './versions.js';

const seedSchema = z
  .object({
    templateKey: z.string().min(1),

    name: z.string().min(1),

    version: z.number().int().positive(),

    sourceRevision: z.string().min(1),
  })
  .passthrough();

type PersistedJson = Prisma.JsonValue | Prisma.InputJsonValue | null;

function persistedHash(value: {
  id: string;
  inputSchemaJson: PersistedJson;
  supportedAspectRatiosJson: PersistedJson;
  minDurationMs: number | null;
  maxDurationMs: number | null;
  requiredSlotsJson: PersistedJson;
  optionalSlotsJson: PersistedJson;
  capabilitiesJson: PersistedJson;
  rendererVersion: string;
  sourceRevision: string | null;
}) {
  return contentHash({
    id: value.id,
    inputSchemaJson: value.inputSchemaJson,
    supportedAspectRatiosJson: value.supportedAspectRatiosJson,
    minDurationMs: value.minDurationMs,
    maxDurationMs: value.maxDurationMs,
    requiredSlotsJson: value.requiredSlotsJson,
    optionalSlotsJson: value.optionalSlotsJson,
    capabilitiesJson: value.capabilitiesJson,
    rendererVersion: value.rendererVersion,
    sourceRevision: value.sourceRevision,
  });
}

export class Templates {
  constructor(
    private readonly tx: Transaction,

    private readonly actor: Actor,
  ) {}

  async importSeed(input: unknown) {
    assertHuman(this.actor);

    const envelope = seedSchema.parse(input);

    const runtimeInput = Object.fromEntries(
      Object.entries(envelope).filter(
        ([key]) => !['templateKey', 'name', 'version', 'sourceRevision'].includes(key),
      ),
    );

    const spec = TemplateRuntimeContractSchema.parse(runtimeInput);

    const expected = {
      id: spec.templateVersionId,

      /*
       * V1 template artifacts do not define
       * user-provided renderer inputs.
       * Keep the required DB field explicit.
       */
      inputSchemaJson: {} as Prisma.InputJsonObject,

      supportedAspectRatiosJson: ['9:16'] as Prisma.InputJsonArray,

      minDurationMs: null,

      maxDurationMs: null,

      requiredSlotsJson: spec.requiredSlots as Prisma.InputJsonValue,

      optionalSlotsJson: spec.optionalSlots as Prisma.InputJsonValue,

      /*
       * Preserve the complete deterministic
       * renderer contract losslessly here.
       */
      capabilitiesJson: spec as unknown as Prisma.InputJsonValue,

      rendererVersion: spec.rendererApiVersion,

      sourceRevision: envelope.sourceRevision,
    };

    await this.tx.$executeRaw`
      SELECT pg_advisory_xact_lock(
        hashtextextended(
          'template-seed-import',
          0
        )
      )
    `;

    let root = await this.tx.template.findUnique({
      where: {
        key: envelope.templateKey,
      },
      include: {
        versions: true,
      },
    });

    if (root) {
      invariant(root.name === envelope.name, 'TEMPLATE_IDENTITY_MISMATCH');

      invariant(root.status === 'ACTIVE', 'TEMPLATE_NOT_ACTIVE');

      const existing = root.versions.find((version) => version.version === envelope.version);

      invariant(existing, 'TEMPLATE_SEED_VERSION_CONFLICT');

      invariant(existing.id === spec.templateVersionId, 'TEMPLATE_VERSION_ID_CONFLICT');

      invariant(
        persistedHash(existing) === persistedHash(expected),
        'TEMPLATE_SEED_CONTENT_CONFLICT',
      );

      return {
        specVersionId: spec.templateVersionId,

        templateVersionId: existing.id,

        templateId: root.id,
      };
    }

    invariant(envelope.version === 1, 'TEMPLATE_SEED_INITIAL_VERSION_REQUIRED');

    root = await this.tx.template.create({
      data: {
        key: envelope.templateKey,

        name: envelope.name,
      },

      include: {
        versions: true,
      },
    });

    await changed(this.tx, this.actor, 'Template.created', 'Template', root.id);

    const version = await new Versions(this.tx, this.actor).templateVersion({
      id: expected.id,

      templateId: root.id,

      inputSchemaJson: expected.inputSchemaJson,

      supportedAspectRatiosJson: expected.supportedAspectRatiosJson,

      requiredSlotsJson: expected.requiredSlotsJson,

      optionalSlotsJson: expected.optionalSlotsJson,

      capabilitiesJson: expected.capabilitiesJson,

      rendererVersion: expected.rendererVersion,

      sourceRevision: expected.sourceRevision,
    });

    await this.tx.template.update({
      where: {
        id: root.id,
      },

      data: {
        status: 'ACTIVE',
      },
    });

    await changed(this.tx, this.actor, 'Template.activated', 'Template', root.id, version.id);

    return {
      specVersionId: spec.templateVersionId,

      templateVersionId: version.id,

      templateId: root.id,
    };
  }
}
