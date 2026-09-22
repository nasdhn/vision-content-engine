import type { PrismaClient } from '@vision/database';
import { invariant } from '@vision/domain';

const iso = (value: Date | null) => (value ? value.toISOString() : null);
const bytes = (value: bigint | null) => (value === null ? null : value.toString());

export type SupportingReadOptions = {
  environment: 'LOCAL' | 'STAGING_CAPTURE' | 'PRODUCTION';
  webOrigin: string;
  safety: {
    pauseAllPublishing: boolean;
    pauseAiGeneration: boolean;
    pauseCapture: boolean;
    pauseRendering: boolean;
    pauseAnalyticsCollection: boolean;
    realProvidersEnabled: boolean;
  };
};

export type PublicationReadItem = {
  publicationId: string;
  renderId: string;
  platform: string;
  accountName: string;
  accountStatus: string;
  deliveryMode: string;
  status: string;
  scheduledAt: string | null;
  publishedAt: string | null;
  remoteUrl: string | null;
  mediaAssetId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AssetReadItem = {
  assetId: string;
  kind: string;
  status: string;
  sourceType: string;
  sourceEntityType: string | null;
  sourceEntityId: string | null;
  mimeType: string | null;
  sizeBytes: string | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  fps: number | null;
  audioChannels: number | null;
  sampleRate: number | null;
  createdAt: string;
  deletedAt: string | null;
  usage: {
    recordings: number;
    captureRuns: number;
    renderInputs: number;
    templateVersions: number;
    renderOutputs: number;
    renderDiagnostics: number;
    approvedRenders: number;
    publications: number;
  };
};

export type AssetReadDetail = AssetReadItem & {
  derivation: {
    parent: null | {
      sourceAssetId: string;
      type: string;
      platform: string | null;
      transformationProfileKey: string;
      transformationProfileVersion: string;
      createdAt: string;
    };
    children: {
      derivedAssetId: string;
      type: string;
      platform: string | null;
      transformationProfileKey: string;
      transformationProfileVersion: string;
      createdAt: string;
    }[];
  };
};

function publicationItem(row: {
  id: string;
  renderId: string;
  deliveryMode: string;
  status: string;
  scheduledAt: Date | null;
  publishedAt: Date | null;
  remoteUrl: string | null;
  mediaAssetId: string | null;
  createdAt: Date;
  updatedAt: Date;
  platformAccount: { platform: string; displayName: string; status: string };
}): PublicationReadItem {
  return {
    publicationId: row.id,
    renderId: row.renderId,
    platform: row.platformAccount.platform,
    accountName: row.platformAccount.displayName,
    accountStatus: row.platformAccount.status,
    deliveryMode: row.deliveryMode,
    status: row.status,
    scheduledAt: iso(row.scheduledAt),
    publishedAt: iso(row.publishedAt),
    remoteUrl: row.remoteUrl,
    mediaAssetId: row.mediaAssetId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function assetItem(row: {
  id: string;
  kind: string;
  status: string;
  sourceType: string;
  sourceEntityType: string | null;
  sourceEntityId: string | null;
  mimeType: string | null;
  sizeBytes: bigint | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  fps: number | null;
  audioChannels: number | null;
  sampleRate: number | null;
  createdAt: Date;
  deletedAt: Date | null;
  _count: {
    recordings: number;
    captureRunAssets: number;
    renderInputAssets: number;
    templateVersionAssets: number;
    renderOutputs: number;
    renderDiagnostics: number;
    approvedForRenders: number;
    publicationMedia: number;
  };
}): AssetReadItem {
  return {
    assetId: row.id,
    kind: row.kind,
    status: row.status,
    sourceType: row.sourceType,
    sourceEntityType: row.sourceEntityType,
    sourceEntityId: row.sourceEntityId,
    mimeType: row.mimeType,
    sizeBytes: bytes(row.sizeBytes),
    width: row.width,
    height: row.height,
    durationMs: row.durationMs,
    fps: row.fps,
    audioChannels: row.audioChannels,
    sampleRate: row.sampleRate,
    createdAt: row.createdAt.toISOString(),
    deletedAt: iso(row.deletedAt),
    usage: {
      recordings: row._count.recordings,
      captureRuns: row._count.captureRunAssets,
      renderInputs: row._count.renderInputAssets,
      templateVersions: row._count.templateVersionAssets,
      renderOutputs: row._count.renderOutputs,
      renderDiagnostics: row._count.renderDiagnostics,
      approvedRenders: row._count.approvedForRenders,
      publications: row._count.publicationMedia,
    },
  };
}

const assetSelect = {
  id: true,
  kind: true,
  status: true,
  sourceType: true,
  sourceEntityType: true,
  sourceEntityId: true,
  mimeType: true,
  sizeBytes: true,
  width: true,
  height: true,
  durationMs: true,
  fps: true,
  audioChannels: true,
  sampleRate: true,
  createdAt: true,
  deletedAt: true,
  _count: {
    select: {
      recordings: true,
      captureRunAssets: true,
      renderInputAssets: true,
      templateVersionAssets: true,
      renderOutputs: true,
      renderDiagnostics: true,
      approvedForRenders: true,
      publicationMedia: true,
    },
  },
} as const;

export class SupportingReadService {
  constructor(
    private readonly db: PrismaClient,
    private readonly options: SupportingReadOptions,
  ) {}

  async calendar() {
    const rows = await this.db.publication.findMany({
      where: { scheduledAt: { not: null } },
      orderBy: [{ scheduledAt: 'asc' }, { id: 'asc' }],
      take: 100,
      select: {
        id: true,
        renderId: true,
        deliveryMode: true,
        status: true,
        scheduledAt: true,
        publishedAt: true,
        remoteUrl: true,
        mediaAssetId: true,
        createdAt: true,
        updatedAt: true,
        platformAccount: {
          select: { platform: true, displayName: true, status: true },
        },
      },
    });

    return {
      readOnly: true as const,
      schedulingAvailable: false as const,
      entries: rows.map(publicationItem),
    };
  }

  async published() {
    const rows = await this.db.publication.findMany({
      where: { status: 'PUBLISHED' },
      orderBy: [{ publishedAt: 'desc' }, { updatedAt: 'desc' }, { id: 'desc' }],
      take: 100,
      select: {
        id: true,
        renderId: true,
        deliveryMode: true,
        status: true,
        scheduledAt: true,
        publishedAt: true,
        remoteUrl: true,
        mediaAssetId: true,
        createdAt: true,
        updatedAt: true,
        platformAccount: {
          select: { platform: true, displayName: true, status: true },
        },
      },
    });

    return {
      readOnly: true as const,
      remotePublishingAvailable: false as const,
      entries: rows.map(publicationItem),
    };
  }

  async assets(): Promise<AssetReadItem[]> {
    const rows = await this.db.asset.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 100,
      select: assetSelect,
    });
    return rows.map(assetItem);
  }

  async asset(assetId: string): Promise<AssetReadDetail> {
    const row = await this.db.asset.findUnique({
      where: { id: assetId },
      select: {
        ...assetSelect,
        derivedFrom: {
          select: {
            sourceAssetId: true,
            type: true,
            platform: true,
            transformationProfileKey: true,
            transformationProfileVersion: true,
            createdAt: true,
          },
        },
        derivedChildren: {
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          select: {
            derivedAssetId: true,
            type: true,
            platform: true,
            transformationProfileKey: true,
            transformationProfileVersion: true,
            createdAt: true,
          },
        },
      },
    });
    invariant(row, 'ASSET_NOT_FOUND');

    return {
      ...assetItem(row),
      derivation: {
        parent: row.derivedFrom
          ? {
              ...row.derivedFrom,
              createdAt: row.derivedFrom.createdAt.toISOString(),
            }
          : null,
        children: row.derivedChildren.map((child) => ({
          ...child,
          createdAt: child.createdAt.toISOString(),
        })),
      },
    };
  }

  async patterns() {
    const rows = await this.db.pattern.findMany({
      orderBy: [{ key: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        key: true,
        name: true,
        category: true,
        status: true,
        updatedAt: true,
        _count: { select: { versions: true } },
        versions: {
          orderBy: [{ version: 'desc' }, { id: 'desc' }],
          take: 1,
          select: {
            id: true,
            version: true,
            description: true,
            whenToUse: true,
            sourceType: true,
            confidence: true,
            createdAt: true,
            _count: { select: { conceptVersions: true } },
          },
        },
      },
    });

    return rows.map((row) => {
      const latest = row.versions[0] ?? null;
      return {
        patternId: row.id,
        key: row.key,
        name: row.name,
        category: row.category,
        status: row.status,
        versionCount: row._count.versions,
        usageCount: latest?._count.conceptVersions ?? 0,
        latestVersion: latest
          ? {
              id: latest.id,
              version: latest.version,
              description: latest.description,
              whenToUse: latest.whenToUse,
              sourceType: latest.sourceType,
              confidence: latest.confidence,
              createdAt: latest.createdAt.toISOString(),
            }
          : null,
        updatedAt: row.updatedAt.toISOString(),
      };
    });
  }

  async templates() {
    const rows = await this.db.template.findMany({
      orderBy: [{ key: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        key: true,
        name: true,
        category: true,
        status: true,
        updatedAt: true,
        _count: { select: { versions: true } },
        versions: {
          orderBy: [{ version: 'desc' }, { id: 'desc' }],
          take: 1,
          select: {
            id: true,
            version: true,
            supportedAspectRatiosJson: true,
            minDurationMs: true,
            maxDurationMs: true,
            rendererVersion: true,
            sourceRevision: true,
            createdAt: true,
            _count: {
              select: {
                assets: true,
                creativePlanVersions: true,
                editingPlanVersions: true,
              },
            },
          },
        },
      },
    });

    return rows.map((row) => {
      const latest = row.versions[0] ?? null;
      return {
        templateId: row.id,
        key: row.key,
        name: row.name,
        category: row.category,
        status: row.status,
        versionCount: row._count.versions,
        latestVersion: latest
          ? {
              id: latest.id,
              version: latest.version,
              supportedAspectRatios: Array.isArray(latest.supportedAspectRatiosJson)
                ? latest.supportedAspectRatiosJson.map(String)
                : [],
              minDurationMs: latest.minDurationMs,
              maxDurationMs: latest.maxDurationMs,
              rendererVersion: latest.rendererVersion,
              sourceRevision: latest.sourceRevision,
              usage: {
                assets: latest._count.assets,
                creativePlans: latest._count.creativePlanVersions,
                editingPlans: latest._count.editingPlanVersions,
              },
              createdAt: latest.createdAt.toISOString(),
            }
          : null,
        updatedAt: row.updatedAt.toISOString(),
      };
    });
  }

  async settingsSummary() {
    const accounts = await this.db.platformAccount.findMany({
      orderBy: [{ platform: 'asc' }, { displayName: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        platform: true,
        displayName: true,
        status: true,
        credentialsRef: true,
        capabilitiesJson: true,
        updatedAt: true,
      },
    });

    return {
      environment: this.options.environment,
      webOrigin: this.options.webOrigin,
      authMode: 'LOCAL_SINGLE_USER' as const,
      storageMode: 'PRIVATE_S3_COMPATIBLE' as const,
      publicationMutationAvailable: false as const,
      analyticsEvidenceAvailable: true as const,
      safety: { ...this.options.safety },
      platformAccounts: accounts.map((account) => ({
        id: account.id,
        platform: account.platform,
        displayName: account.displayName,
        status: account.status,
        credentialsConfigured: account.credentialsRef !== null,
        capabilitiesConfigured: account.capabilitiesJson !== null,
        updatedAt: account.updatedAt.toISOString(),
      })),
    };
  }
}
