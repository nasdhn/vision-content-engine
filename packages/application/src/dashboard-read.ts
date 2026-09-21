import type { PrismaClient } from '@vision/database';

export type DashboardAttentionSeverity = 'ACTION' | 'ERROR';

export type DashboardAttentionItem = {
  id: string;
  kind:
    | 'EDITING_BLOCKER'
    | 'RECORDING_INPUT'
    | 'RENDER_FAILED'
    | 'CAPTURE_FAILED'
    | 'WORKFLOW_FAILED'
    | 'OUTBOX_FAILED'
    | 'PLATFORM_ACCOUNT'
    | 'PUBLICATION';
  severity: DashboardAttentionSeverity;
  title: string;
  reason: string;
  affectedEntity: {
    type: string;
    id: string;
  };
  createdAt: string;
  recommendedAction: string;
  targetRoute: string;
};

export type DashboardSummary = {
  generatedAt: string;
  counts: {
    needsAttention: number;
    conceptsAwaitingReview: number;
    activeProduction: number;
    rendersReadyForReview: number;
  };
  recentChanges: {
    id: string;
    action: string;
    subjectType: string;
    subjectId: string;
    subjectVersionId: string | null;
    createdAt: string;
  }[];
};

const iso = (value: Date) => value.toISOString();

function workflowRoute(rootEntityType: string, rootEntityId: string) {
  if (rootEntityType === 'CreativePlanVersion') return `/production/${rootEntityId}`;
  if (rootEntityType === 'Render') return `/review/${rootEntityId}`;
  if (rootEntityType === 'ConceptVersion') return `/concepts/${rootEntityId}`;
  return '/attention';
}

export class DashboardReadService {
  constructor(private readonly db: PrismaClient) {}

  async summary(): Promise<DashboardSummary> {
    const [attention, conceptsAwaitingReview, activeProduction, rendersReadyForReview, recent] =
      await Promise.all([
        this.attention(),
        this.db.concept.count({
          where: { status: 'AWAITING_REVIEW' },
        }),
        this.db.creativePlan.count({
          where: {
            status: {
              in: ['DRAFT', 'READY', 'WAITING_FOR_INPUTS', 'READY_FOR_EDITING'],
            },
          },
        }),
        this.db.render.count({
          where: { status: 'READY_FOR_REVIEW' },
        }),
        this.db.auditEvent.findMany({
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 8,
          select: {
            id: true,
            action: true,
            subjectType: true,
            subjectId: true,
            subjectVersionId: true,
            createdAt: true,
          },
        }),
      ]);

    return {
      generatedAt: new Date().toISOString(),
      counts: {
        needsAttention: attention.length,
        conceptsAwaitingReview,
        activeProduction,
        rendersReadyForReview,
      },
      recentChanges: recent.map((event) => ({
        ...event,
        createdAt: iso(event.createdAt),
      })),
    };
  }

  async attention(): Promise<DashboardAttentionItem[]> {
    const [
      blockers,
      recordingRequests,
      failedRenders,
      failedCaptures,
      failedWorkflows,
      failedOutbox,
      accountIssues,
      publicationIssues,
    ] = await Promise.all([
      this.db.editingBlocker.findMany({
        where: { status: 'OPEN' },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 50,
        select: {
          id: true,
          creativePlanVersionId: true,
          reasonCode: true,
          recoverability: true,
          createdAt: true,
        },
      }),
      this.db.recordingRequest.findMany({
        where: { status: { in: ['READY_TO_RECORD', 'UPLOADED'] } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 50,
        select: {
          id: true,
          creativePlanVersionId: true,
          title: true,
          status: true,
          createdAt: true,
        },
      }),
      this.db.render.findMany({
        where: { status: 'FAILED' },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 50,
        select: { id: true, createdAt: true },
      }),
      this.db.captureRun.findMany({
        where: { status: 'FAILED' },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 50,
        select: {
          id: true,
          creativePlanVersionId: true,
          createdAt: true,
        },
      }),
      this.db.workflowRun.findMany({
        where: { status: 'FAILED' },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 50,
        select: {
          id: true,
          rootEntityType: true,
          rootEntityId: true,
          createdAt: true,
        },
      }),
      this.db.outboxEvent.findMany({
        where: { status: 'FAILED' },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 50,
        select: {
          id: true,
          eventType: true,
          aggregateType: true,
          aggregateId: true,
          createdAt: true,
        },
      }),
      this.db.platformAccount.findMany({
        where: { status: { in: ['REAUTH_REQUIRED', 'ERROR'] } },
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        take: 50,
        select: {
          id: true,
          displayName: true,
          status: true,
          updatedAt: true,
        },
      }),
      this.db.publication.findMany({
        where: { status: { in: ['PUBLISHING_UNKNOWN', 'FAILED'] } },
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        take: 50,
        select: {
          id: true,
          renderId: true,
          status: true,
          updatedAt: true,
        },
      }),
    ]);

    const items: DashboardAttentionItem[] = [];

    for (const row of blockers) {
      items.push({
        id: `editing-blocker:${row.id}`,
        kind: 'EDITING_BLOCKER',
        severity: 'ACTION',
        title: 'Montage bloqué',
        reason: row.reasonCode,
        affectedEntity: { type: 'CreativePlanVersion', id: row.creativePlanVersionId },
        createdAt: iso(row.createdAt),
        recommendedAction:
          row.recoverability === 'RECOVERABLE_WITH_INPUT'
            ? 'Fournir ou remplacer l’élément demandé.'
            : 'Réviser le plan créatif.',
        targetRoute: `/production/${row.creativePlanVersionId}`,
      });
    }

    for (const row of recordingRequests) {
      items.push({
        id: `recording-input:${row.id}`,
        kind: 'RECORDING_INPUT',
        severity: 'ACTION',
        title: row.title,
        reason:
          row.status === 'UPLOADED'
            ? 'Une prise doit être sélectionnée.'
            : 'Un enregistrement humain est requis.',
        affectedEntity: { type: 'RecordingRequest', id: row.id },
        createdAt: iso(row.createdAt),
        recommendedAction: 'Ouvrir la production et préparer l’enregistrement.',
        targetRoute: `/production/${row.creativePlanVersionId}`,
      });
    }

    for (const row of failedRenders) {
      items.push({
        id: `render-failed:${row.id}`,
        kind: 'RENDER_FAILED',
        severity: 'ERROR',
        title: 'Rendu vidéo échoué',
        reason: 'Le rendu n’a pas atteint la review finale.',
        affectedEntity: { type: 'Render', id: row.id },
        createdAt: iso(row.createdAt),
        recommendedAction: 'Inspecter la production avant toute nouvelle tentative.',
        targetRoute: '/production',
      });
    }

    for (const row of failedCaptures) {
      items.push({
        id: `capture-failed:${row.id}`,
        kind: 'CAPTURE_FAILED',
        severity: 'ERROR',
        title: 'Capture produit échouée',
        reason: 'La capture automatique nécessite une inspection.',
        affectedEntity: { type: 'CaptureRun', id: row.id },
        createdAt: iso(row.createdAt),
        recommendedAction: 'Inspecter la production et le scénario de capture.',
        targetRoute: row.creativePlanVersionId
          ? `/production/${row.creativePlanVersionId}`
          : '/production',
      });
    }

    for (const row of failedWorkflows) {
      items.push({
        id: `workflow-failed:${row.id}`,
        kind: 'WORKFLOW_FAILED',
        severity: 'ERROR',
        title: 'Workflow échoué',
        reason: 'Une exécution interne s’est arrêtée avant son terme.',
        affectedEntity: { type: 'WorkflowRun', id: row.id },
        createdAt: iso(row.createdAt),
        recommendedAction: 'Inspecter l’état canonique avant de relancer une opération.',
        targetRoute: workflowRoute(row.rootEntityType, row.rootEntityId),
      });
    }

    for (const row of failedOutbox) {
      items.push({
        id: `outbox-failed:${row.id}`,
        kind: 'OUTBOX_FAILED',
        severity: 'ERROR',
        title: 'Événement interne non distribué',
        reason: `L’événement ${row.eventType} n’a pas été distribué.`,
        affectedEntity: { type: row.aggregateType, id: row.aggregateId },
        createdAt: iso(row.createdAt),
        recommendedAction: 'Inspecter l’état avant toute réconciliation.',
        targetRoute: '/attention',
      });
    }

    for (const row of accountIssues) {
      items.push({
        id: `platform-account:${row.id}`,
        kind: 'PLATFORM_ACCOUNT',
        severity: 'ERROR',
        title: row.displayName,
        reason:
          row.status === 'REAUTH_REQUIRED'
            ? 'Le compte devra être réauthentifié.'
            : 'Le compte plateforme est en erreur.',
        affectedEntity: { type: 'PlatformAccount', id: row.id },
        createdAt: iso(row.updatedAt),
        recommendedAction: 'Vérifier le compte dans les réglages.',
        targetRoute: '/settings',
      });
    }

    for (const row of publicationIssues) {
      items.push({
        id: `publication:${row.id}`,
        kind: 'PUBLICATION',
        severity: 'ERROR',
        title: 'Publication à vérifier',
        reason:
          row.status === 'PUBLISHING_UNKNOWN'
            ? 'L’effet distant de la publication est inconnu.'
            : 'La publication est en échec.',
        affectedEntity: { type: 'Publication', id: row.id },
        createdAt: iso(row.updatedAt),
        recommendedAction: 'Conserver l’état tel quel jusqu’à la réconciliation Phase 7.',
        targetRoute: '/published',
      });
    }

    return items
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id))
      .slice(0, 100);
  }
}
