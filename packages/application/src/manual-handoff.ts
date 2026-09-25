import { CAPACITY_DEFAULTS } from '@vision/media';
import { createHash } from 'node:crypto';
import { Persistence } from '@vision/database';
import type { Actor, PrismaClient } from '@vision/database';
import { assertHuman, invariant } from '@vision/domain';
import type { PrivateStorage } from '@vision/media';
import { TikTokManualMetadataSchema } from '@vision/publishing';

const allowedStatuses = new Set(['READY_FOR_MANUAL_PUBLISH', 'PUBLISHED']);
const maxMediaBytes = CAPACITY_DEFAULTS.maxArtifactBytes;

export type ManualHandoffListItem = {
  publicationId: string;
  accountName: string;
  status: string;
  scheduledAt: string;
  captionPreview: string;
  hashtagCount: number;
  commercialDisclosureReminder: boolean;
};

export type ManualHandoffDetail = ManualHandoffListItem & {
  completionAllowed: boolean;
  publishedAt: string | null;
  remoteUrl: string | null;
  metadata: {
    caption: string;
    hashtags: string[];
    ctaNotes: string | null;
    coverRecommendation: string | null;
    commercialDisclosureReminder: boolean;
  };
  media: {
    assetId: string;
    mimeType: string;
    sizeBytes: string;
    width: number | null;
    height: number | null;
    durationMs: number | null;
  };
};

export type ManualHandoffMedia = {
  bytes: Buffer;
  mimeType: string;
  sizeBytes: number;
};

export class ManualHandoffService {
  private readonly persistence: Persistence;

  constructor(
    private readonly db: PrismaClient,
    private readonly storage: PrivateStorage,
  ) {
    this.persistence = new Persistence(db);
  }

  private async context(publicationId: string) {
    const publication = await this.db.publication.findUnique({
      where: { id: publicationId },
      include: {
        platformAccount: true,
        mediaAsset: true,
        render: { select: { status: true } },
      },
    });

    invariant(publication, 'PUBLICATION_NOT_FOUND');
    invariant(publication.deliveryMode === 'MANUAL_HANDOFF', 'MANUAL_HANDOFF_REQUIRED');
    invariant(publication.platformAccount.platform === 'TIKTOK', 'TIKTOK_MANUAL_ONLY');
    invariant(allowedStatuses.has(publication.status), 'MANUAL_HANDOFF_NOT_AVAILABLE');
    invariant(publication.scheduledAt, 'MANUAL_TARGET_TIME_REQUIRED');
    invariant(publication.render.status === 'APPROVED', 'PUBLICATION_LINEAGE_INVALID');
    invariant(publication.mediaAssetId && publication.mediaAsset, 'EXACT_MEDIA_REQUIRED');

    const asset = publication.mediaAsset;
    invariant(
      asset.status === 'READY' &&
        asset.deletedAt === null &&
        asset.storageProvider === 'S3' &&
        asset.bucket === this.storage.bucket &&
        asset.checksumSha256 !== null &&
        asset.sizeBytes !== null &&
        asset.sizeBytes > 0n &&
        asset.sizeBytes <= BigInt(maxMediaBytes),
      'ASSET_NOT_AVAILABLE',
    );

    const metadata = TikTokManualMetadataSchema.parse(publication.metadataJson);
    return { publication, asset, metadata };
  }

  private listItem(
    context: Awaited<ReturnType<ManualHandoffService['context']>>,
  ): ManualHandoffListItem {
    const { publication, metadata } = context;
    return {
      publicationId: publication.id,
      accountName: publication.platformAccount.displayName,
      status: publication.status,
      scheduledAt: publication.scheduledAt!.toISOString(),
      captionPreview: metadata.caption.slice(0, 160),
      hashtagCount: metadata.hashtags.length,
      commercialDisclosureReminder: metadata.commercialDisclosureReminder,
    };
  }

  async queue(): Promise<ManualHandoffListItem[]> {
    const rows = await this.db.publication.findMany({
      where: {
        deliveryMode: 'MANUAL_HANDOFF',
        status: 'READY_FOR_MANUAL_PUBLISH',
        platformAccount: { platform: 'TIKTOK' },
      },
      orderBy: [{ scheduledAt: 'asc' }, { id: 'asc' }],
      take: 100,
      select: { id: true },
    });

    return Promise.all(rows.map(async (row) => this.listItem(await this.context(row.id))));
  }

  async detail(publicationId: string): Promise<ManualHandoffDetail> {
    const context = await this.context(publicationId);
    const { publication, asset, metadata } = context;
    return {
      ...this.listItem(context),
      completionAllowed: publication.status === 'READY_FOR_MANUAL_PUBLISH',
      publishedAt: publication.publishedAt?.toISOString() ?? null,
      remoteUrl: publication.remoteUrl,
      metadata: {
        caption: metadata.caption,
        hashtags: [...metadata.hashtags],
        ctaNotes: metadata.ctaNotes ?? null,
        coverRecommendation: metadata.coverRecommendation ?? null,
        commercialDisclosureReminder: metadata.commercialDisclosureReminder,
      },
      media: {
        assetId: asset.id,
        mimeType: asset.mimeType ?? 'application/octet-stream',
        sizeBytes: asset.sizeBytes!.toString(),
        width: asset.width,
        height: asset.height,
        durationMs: asset.durationMs,
      },
    };
  }

  async media(actor: Actor, publicationId: string): Promise<ManualHandoffMedia> {
    assertHuman(actor);
    const { asset } = await this.context(publicationId);
    const expectedSize = Number(asset.sizeBytes!);
    invariant(Number.isSafeInteger(expectedSize), 'ASSET_NOT_AVAILABLE');

    const hash = createHash('sha256');
    const chunks: Uint8Array[] = [];
    let size = 0;

    try {
      for await (const chunk of await this.storage.get(asset.objectKey)) {
        size += chunk.byteLength;
        invariant(size <= expectedSize, 'STORED_OBJECT_SIZE_MISMATCH');
        hash.update(chunk);
        chunks.push(chunk);
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('STORED_OBJECT_')) throw error;
      invariant(false, 'ASSET_NOT_AVAILABLE');
    }

    invariant(size === expectedSize, 'STORED_OBJECT_SIZE_MISMATCH');
    invariant(hash.digest('hex') === asset.checksumSha256, 'STORED_OBJECT_CHECKSUM_MISMATCH');

    return {
      bytes: Buffer.concat(chunks, size),
      mimeType: asset.mimeType ?? 'application/octet-stream',
      sizeBytes: size,
    };
  }

  async complete(actor: Actor, publicationId: string, remoteUrl?: string) {
    assertHuman(actor);
    await this.persistence.transaction(actor, (unit) =>
      unit.distribution.completeManual(publicationId, remoteUrl),
    );
    return this.detail(publicationId);
  }
}
