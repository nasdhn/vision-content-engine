import { PatternVersionSpecSchema } from '@vision/contracts';
import { contentHash, normalize } from '@vision/contracts/canonical';
import { assertHuman, invariant } from '@vision/domain';
import { changed, lock } from './transaction.js';
import type { Actor, Transaction } from './transaction.js';
import { Versions } from './versions.js';

export class Patterns {
  constructor(
    private readonly tx: Transaction,
    private readonly actor: Actor,
  ) {}
  /** Curated artifact import. Placeholder IDs map explicitly to generated canonical IDs. */
  async importSeed(input: unknown) {
    assertHuman(this.actor);
    const spec = PatternVersionSpecSchema.parse(input);
    const { patternKey: key, name, category } = spec.identity;
    await this.tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('pattern-import', 0))`;
    let root = await this.tx.pattern.findUnique({ where: { key }, include: { versions: true } });
    if (root) {
      invariant(root.category === category && root.name === name, 'PATTERN_IDENTITY_MISMATCH');
      const previous = root.versions.find((v) => v.version === spec.identity.version);
      invariant(previous, 'SEED_VERSION_CONFLICT');
      invariant(
        contentHash((previous.sourceMetadataJson as { artifact?: unknown })?.artifact) ===
          contentHash(spec),
        'SEED_CONTENT_CONFLICT',
      );
      return {
        specVersionId: spec.identity.patternVersionId,
        patternVersionId: previous.id,
        patternId: root.id,
      };
    }
    invariant(spec.identity.version === 1, 'SEED_INITIAL_VERSION_REQUIRED');
    const sources = [...new Set(spec.provenance.sourceReferenceIds)];
    invariant(
      (await this.tx.sourceReference.count({ where: { id: { in: sources } } })) === sources.length,
      'SOURCE_REFERENCE_NOT_FOUND',
    );
    const existing = await this.tx.patternVersion.findMany({
      where: { pattern: { status: 'ACTIVE' } },
    });
    const signature = (s: typeof spec) =>
      normalize(
        [
          s.thesis.psychologicalMechanism,
          s.structure.hook.shape,
          ...s.structure.story.map((b) => b.role),
          s.structure.visual.proofMoment ?? '',
        ].join(' '),
      );
    for (const v of existing) {
      const other = PatternVersionSpecSchema.safeParse(
        (v.sourceMetadataJson as { artifact?: unknown })?.artifact,
      );
      invariant(
        !other.success || signature(other.data) !== signature(spec),
        'DUPLICATE_PATTERN_MECHANISM',
      );
    }
    root = await this.tx.pattern.create({
      data: { key, name, category },
      include: { versions: true },
    });
    const version = await new Versions(this.tx, this.actor).patternVersion({
      patternId: root.id,
      description: spec.thesis.description,
      whenToUse: spec.thesis.whenToUse.join('\n'),
      audienceFitJson: spec.adaptation,
      hookStructureJson: spec.structure.hook,
      storyStructureJson: { beats: spec.structure.story },
      visualStructureJson: spec.structure.visual,
      ctaStyleJson: spec.structure.cta,
      constraintsJson: spec.constraints,
      knownRisksJson: spec.constraints.commonFailureModes,
      examplesJson: spec.structure.hook.originalExamples,
      sourceType: spec.provenance.sourceType,
      sourceMetadataJson: {
        artifact: spec,
        specContentHash: contentHash(spec),
        specVersionId: spec.identity.patternVersionId,
      },
      createdBy: this.actor.actorId!,
    });
    await this.tx.pattern.update({ where: { id: root.id }, data: { status: 'ACTIVE' } });
    await changed(this.tx, this.actor, 'Pattern.activated', 'Pattern', root.id, version.id);
    return {
      specVersionId: spec.identity.patternVersionId,
      patternVersionId: version.id,
      patternId: root.id,
    };
  }
  async deprecate(id: string) {
    assertHuman(this.actor);
    await lock(this.tx, 'Pattern', id);
    const row = await this.tx.pattern.findUniqueOrThrow({ where: { id } });
    invariant(row.status === 'ACTIVE', 'INVALID_TRANSITION');
    await this.tx.pattern.update({ where: { id }, data: { status: 'DEPRECATED' } });
    await changed(this.tx, this.actor, 'Pattern.deprecated', 'Pattern', id);
  }
}
