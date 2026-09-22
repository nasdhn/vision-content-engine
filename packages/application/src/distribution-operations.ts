import { invariant } from '@vision/domain';
import { Persistence } from '@vision/database';
import type { Actor, PrismaClient } from '@vision/database';
import { PlatformCapabilitiesSchema } from '@vision/publishing';
import type { PublisherRegistry } from '@vision/publishing';

export type DistributionOperatorOptions = Readonly<{
  realProvidersEnabled: boolean;
  publishers?: PublisherRegistry;
}>;

function iso(value: Date | null) {
  return value?.toISOString() ?? null;
}

export class DistributionOperationsService {
  private readonly persistence: Persistence;

  constructor(
    private readonly db: PrismaClient,
    private readonly options: DistributionOperatorOptions,
  ) {
    this.persistence = new Persistence(db);
  }

  private publisherFor(platform: 'TIKTOK' | 'INSTAGRAM' | 'YOUTUBE') {
    if (!this.options.publishers) return null;
    try {
      return this.options.publishers.resolve(platform);
    } catch {
      return null;
    }
  }

  async overview() {
    const [accounts, publications] = await Promise.all([
      this.db.platformAccount.findMany({
        orderBy: [{ platform: 'asc' }, { displayName: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          platform: true,
          displayName: true,
          remoteAccountId: true,
          status: true,
          credentialsRef: true,
          capabilitiesJson: true,
          updatedAt: true,
        },
      }),
      this.db.publication.findMany({
        where: {
          status: {
            in: ['SCHEDULED', 'READY_FOR_MANUAL_PUBLISH', 'PUBLISHING_UNKNOWN', 'FAILED'],
          },
        },
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        take: 100,
        select: {
          id: true,
          deliveryMode: true,
          status: true,
          scheduledAt: true,
          updatedAt: true,
          platformAccount: {
            select: { id: true, platform: true, displayName: true, status: true },
          },
          attempts: {
            orderBy: [{ attemptNumber: 'desc' }, { id: 'desc' }],
            take: 1,
            select: {
              id: true,
              attemptNumber: true,
              status: true,
              responseClass: true,
              failureCode: true,
              createdAt: true,
            },
          },
        },
      }),
    ]);

    return {
      generatedAt: new Date().toISOString(),
      safety: { realProvidersEnabled: this.options.realProvidersEnabled },
      accounts: accounts.map((account) => {
        const capabilities = PlatformCapabilitiesSchema.safeParse(account.capabilitiesJson);
        const publisher = this.publisherFor(account.platform);
        return {
          id: account.id,
          platform: account.platform,
          displayName: account.displayName,
          status: account.status,
          credentialsConfigured: account.credentialsRef !== null,
          capabilities: capabilities.success
            ? {
                canPublishVideo: capabilities.data.canPublishVideo,
                canPublishPublic: capabilities.data.canPublishPublic,
                supportsNativeScheduling: capabilities.data.supportsNativeScheduling,
                checkedAt: capabilities.data.checkedAt,
                limitations: capabilities.data.limitations,
              }
            : null,
          refreshAllowed:
            account.status !== 'DISABLED' &&
            publisher?.checkAccount !== undefined &&
            (!publisher.isRealProvider || this.options.realProvidersEnabled),
          updatedAt: account.updatedAt.toISOString(),
        };
      }),
      publications: publications.map((publication) => ({
        publicationId: publication.id,
        platform: publication.platformAccount.platform,
        accountName: publication.platformAccount.displayName,
        accountStatus: publication.platformAccount.status,
        deliveryMode: publication.deliveryMode,
        status: publication.status,
        scheduledAt: iso(publication.scheduledAt),
        updatedAt: publication.updatedAt.toISOString(),
        latestAttempt: publication.attempts[0]
          ? {
              ...publication.attempts[0],
              createdAt: publication.attempts[0].createdAt.toISOString(),
            }
          : null,
        actions: {
          reconcile: publication.status === 'PUBLISHING_UNKNOWN',
          reschedule: publication.status === 'SCHEDULED',
          cancel:
            publication.status === 'SCHEDULED' ||
            (publication.deliveryMode === 'MANUAL_HANDOFF' &&
              publication.status === 'READY_FOR_MANUAL_PUBLISH'),
        },
      })),
    };
  }

  async requestReconciliation(actor: Actor, publicationId: string) {
    return this.persistence.transaction(actor, (unit) =>
      unit.distribution.requestReconciliation(publicationId),
    );
  }

  async reschedule(actor: Actor, publicationId: string, scheduledAt: Date) {
    return this.persistence.transaction(actor, (unit) =>
      unit.distribution.reschedule(publicationId, scheduledAt),
    );
  }

  async cancel(actor: Actor, publicationId: string) {
    return this.persistence.transaction(actor, (unit) => unit.distribution.cancel(publicationId));
  }

  async refreshAccount(actor: Actor, accountId: string) {
    const snapshot = await this.persistence.transaction(actor, (unit) =>
      unit.distribution.platformAccountForHealth(accountId),
    );
    const publisher = this.publisherFor(snapshot.platform);
    invariant(
      publisher !== null && publisher.checkAccount !== undefined,
      'ACCOUNT_HEALTH_REFRESH_UNAVAILABLE',
    );
    invariant(
      !publisher.isRealProvider || this.options.realProvidersEnabled,
      'REAL_PROVIDERS_DISABLED',
    );
    const result = await publisher.checkAccount(snapshot);
    const applied = await this.persistence.transaction(actor, (unit) =>
      unit.distribution.applyPlatformAccountHealth(accountId, result),
    );
    return { result, applied };
  }
}
