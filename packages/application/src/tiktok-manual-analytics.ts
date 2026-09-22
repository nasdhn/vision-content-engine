import {
  MANUAL_TIKTOK_OVERDUE_GRACE_SECONDS,
  MANUAL_TIKTOK_WINDOWS,
  collectionDueAt,
  parseManualTikTokJobType,
} from '@vision/analytics';
import { Persistence } from '@vision/database';
import type { Actor, PrismaClient } from '@vision/database';

function iso(value: Date | null) {
  return value?.toISOString() ?? null;
}

export class TikTokManualAnalyticsService {
  private readonly persistence: Persistence;

  constructor(private readonly db: PrismaClient) {
    this.persistence = new Persistence(db);
  }

  async overview(now = new Date()) {
    const jobs = await this.db.jobAttempt.findMany({
      where: {
        queueName: 'vce-analytics-manual',
        jobType: { startsWith: 'ANALYTICS_MANUAL:TIKTOK:' },
        workflowRun: {
          is: { workflowType: 'ANALYTICS', rootEntityType: 'PublicationAnalytics' },
        },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 100,
      include: { workflowRun: true },
    });
    const publicationIds = [...new Set(jobs.map((job) => job.workflowRun!.rootEntityId))];
    const publications = await this.db.publication.findMany({
      where: { id: { in: publicationIds } },
      select: {
        id: true,
        status: true,
        publishedAt: true,
        remoteUrl: true,
        platformAccount: { select: { platform: true, displayName: true } },
      },
    });
    const byPublication = new Map(publications.map((publication) => [publication.id, publication]));
    const prompts = jobs.flatMap((job) => {
      const publication = byPublication.get(job.workflowRun!.rootEntityId);
      if (!publication?.publishedAt || publication.platformAccount.platform !== 'TIKTOK') return [];
      const windowKey = parseManualTikTokJobType(job.jobType);
      const window = MANUAL_TIKTOK_WINDOWS.find((candidate) => candidate.key === windowKey);
      if (!window) return [];
      const dueAt = collectionDueAt(publication.publishedAt, window);
      const overdueAt = new Date(dueAt.getTime() + MANUAL_TIKTOK_OVERDUE_GRACE_SECONDS * 1_000);
      const state =
        job.status === 'SUCCEEDED'
          ? 'COMPLETED'
          : now.getTime() >= overdueAt.getTime()
            ? 'OVERDUE'
            : now.getTime() >= dueAt.getTime()
              ? 'DUE'
              : 'UPCOMING';
      return [
        {
          jobAttemptId: job.id,
          publicationId: publication.id,
          accountName: publication.platformAccount.displayName,
          remoteUrl: publication.remoteUrl,
          windowKey,
          dueAt: dueAt.toISOString(),
          overdueAt: overdueAt.toISOString(),
          state,
          materiallyOverdue: state === 'OVERDUE',
          completedAt: iso(job.finishedAt),
        },
      ];
    });
    prompts.sort(
      (a, b) => a.dueAt.localeCompare(b.dueAt) || a.jobAttemptId.localeCompare(b.jobAttemptId),
    );
    return {
      generatedAt: now.toISOString(),
      collectionMethod: 'MANUAL_ENTRY' as const,
      summary: {
        due: prompts.filter((prompt) => prompt.state === 'DUE').length,
        overdue: prompts.filter((prompt) => prompt.state === 'OVERDUE').length,
        upcoming: prompts.filter((prompt) => prompt.state === 'UPCOMING').length,
        completed: prompts.filter((prompt) => prompt.state === 'COMPLETED').length,
      },
      prompts,
    };
  }

  submit(actor: Actor, jobAttemptId: string, input: unknown) {
    return this.persistence.transaction(actor, (unit) =>
      unit.analytics.completeManualTikTok(jobAttemptId, input),
    );
  }
}
