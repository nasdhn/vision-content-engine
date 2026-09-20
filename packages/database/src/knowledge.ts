import { randomUUID } from 'node:crypto';
import { BrandKnowledgeSnapshotSchema } from '@vision/contracts';
import { assertNoSecrets, contentHash } from '@vision/contracts/canonical';
import { assertHuman, invariant } from '@vision/domain';
import { z } from 'zod';
import type { Actor, Transaction } from './transaction.js';
import { changed } from './transaction.js';
import type { Prisma } from './generated/prisma/client.js';

export const KnowledgePayloadSchema = BrandKnowledgeSnapshotSchema.omit({
  id: true,
  key: true,
  version: true,
  contentHash: true,
  effectiveAt: true,
});
const SourceSchema = z
  .object({
    sourceType: z.enum([
      'INTERNAL_PRODUCT',
      'INTERNAL_PRICING',
      'OFFICIAL_DOCUMENTATION',
      'PUBLIC_WEB',
      'MANUAL_REFERENCE',
    ]),
    title: z.string().trim().min(1),
    url: z
      .string()
      .url()
      .refine((s) => {
        const u = new URL(s);
        return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password;
      })
      .optional(),
    publisher: z.string().min(1).optional(),
    observedAt: z.string().datetime().optional(),
    retrievedAt: z.string().datetime().optional(),
    contentHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    metadataJson: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export class Knowledge {
  constructor(
    private readonly tx: Transaction,
    private readonly actor: Actor,
  ) {}
  async createSource(input: z.input<typeof SourceSchema>) {
    assertHuman(this.actor);
    assertNoSecrets(input);
    const data = SourceSchema.parse(input);
    if (data.metadataJson) contentHash(data.metadataJson);
    const source = await this.tx.sourceReference.create({
      data: {
        sourceType: data.sourceType,
        title: data.title,
        ...(data.url ? { url: data.url } : {}),
        ...(data.publisher ? { publisher: data.publisher } : {}),
        ...(data.contentHash ? { contentHash: data.contentHash } : {}),
        ...(data.observedAt ? { observedAt: new Date(data.observedAt) } : {}),
        ...(data.retrievedAt ? { retrievedAt: new Date(data.retrievedAt) } : {}),
        ...(data.metadataJson ? { metadataJson: data.metadataJson as Prisma.InputJsonObject } : {}),
      },
    });
    await changed(this.tx, this.actor, 'SourceReference.created', 'SourceReference', source.id);
    return source;
  }
  async createSnapshot(key: string, effectiveAt: string, input: unknown) {
    assertHuman(this.actor);
    z.string().trim().min(1).parse(key);
    z.string().datetime().parse(effectiveAt);
    assertNoSecrets(input);
    const payload = KnowledgePayloadSchema.parse(input);
    const claims = [...payload.claims.verified, ...payload.commercial.pricingClaims];
    const seen = new Map<string, string>();
    for (const claim of claims) {
      invariant(
        !seen.has(claim.id) || seen.get(claim.id) === contentHash(claim),
        'CONFLICTING_CLAIM_ID',
      );
      seen.set(claim.id, contentHash(claim));
      invariant(
        !claim.validFrom ||
          !claim.validUntil ||
          new Date(claim.validFrom) < new Date(claim.validUntil),
        'INVALID_CLAIM_VALIDITY',
      );
      const ids = [...new Set(claim.sourceIds)];
      invariant(
        (await this.tx.sourceReference.count({ where: { id: { in: ids } } })) === ids.length,
        'SOURCE_REFERENCE_NOT_FOUND',
      );
    }
    const assets = [...new Set(payload.visualIdentity.allowedAssetIds)];
    invariant(
      (await this.tx.asset.count({
        where: { id: { in: assets }, status: 'READY', deletedAt: null },
      })) === assets.length,
      'ASSET_NOT_READY',
    );
    // There is no mutable Knowledge root. Serialize first insert and version allocation by key.
    await this.tx
      .$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`knowledge:${key}`}, 0))`;
    const hash = contentHash(payload);
    const previous = await this.tx.knowledgeSnapshot.findUnique({
      where: { key_contentHash: { key, contentHash: hash } },
    });
    if (previous) return previous;
    const last = await this.tx.knowledgeSnapshot.aggregate({
      where: { key },
      _max: { version: true },
    });
    const row = await this.tx.knowledgeSnapshot.create({
      data: {
        id: randomUUID(),
        key,
        version: (last._max.version ?? 0) + 1,
        contentHash: hash,
        effectiveAt: new Date(effectiveAt),
        payloadJson: payload,
        createdBy: this.actor.actorId!,
      },
    });
    await changed(this.tx, this.actor, 'KnowledgeSnapshot.created', 'KnowledgeSnapshot', row.id);
    return row;
  }
  async activate(id: string) {
    assertHuman(this.actor);
    const row = await this.tx.knowledgeSnapshot.findUniqueOrThrow({ where: { id } });
    await this.tx
      .$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`knowledge:${row.key}`}, 0))`;
    const current = await this.tx.knowledgeSnapshot.findUniqueOrThrow({ where: { id } });
    invariant(['DRAFT', 'ACTIVE'].includes(current.status), 'INVALID_TRANSITION');
    if (current.status === 'ACTIVE') return current;
    await this.tx.knowledgeSnapshot.updateMany({
      where: { key: row.key, status: 'ACTIVE' },
      data: { status: 'DEPRECATED' },
    });
    const result = await this.tx.knowledgeSnapshot.update({
      where: { id },
      data: { status: 'ACTIVE' },
    });
    await changed(this.tx, this.actor, 'KnowledgeSnapshot.activated', 'KnowledgeSnapshot', id);
    return result;
  }
  async snapshot(id: string) {
    const row = await this.tx.knowledgeSnapshot.findUniqueOrThrow({ where: { id } });
    invariant(contentHash(row.payloadJson) === row.contentHash, 'KNOWLEDGE_HASH_MISMATCH');
    return BrandKnowledgeSnapshotSchema.parse({
      ...KnowledgePayloadSchema.parse(row.payloadJson),
      id: row.id,
      key: row.key,
      version: row.version,
      contentHash: row.contentHash,
      effectiveAt: row.effectiveAt.toISOString(),
    });
  }
}
