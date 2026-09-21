import { invariant } from '@vision/domain';
import type { PrismaClient } from '@vision/database';

export type ProductionStage =
  'WAITING_FOR_ME' | 'CAPTURING' | 'EDITING' | 'RENDERING' | 'FAILED' | 'DONE';

export type ProductionListItem = {
  creativePlanId: string;
  creativePlanVersionId: string;
  version: number;
  status: string;
  title: string;
  hook: string | null;
  campaignName: string;
  primaryFormat: string;
  targetDurationMs: number | null;
  stage: ProductionStage;
  nextAction: string;
  recordings: {
    total: number;
    pending: number;
    readyToRecord: number;
    uploaded: number;
    accepted: number;
  };
  capture: {
    id: string;
    status: string;
    failureCode: string | null;
    createdAt: string;
  } | null;
  blocker: {
    id: string;
    reasonCode: string;
    recoverability: string;
    createdAt: string;
  } | null;
  editing: {
    editingPlanVersionId: string;
    status: string;
    version: number;
  } | null;
  render: {
    id: string;
    status: string;
    attemptStatus: string | null;
    technicalQaResult: string | null;
    creativeQaResult: string | null;
  } | null;
  createdAt: string;
};

export type ProductionDetail = ProductionListItem & {
  script: {
    scriptVersionId: string;
    fullText: string;
    estimatedDurationMs: number | null;
    voiceMode: string;
  };
  template: {
    key: string;
    name: string;
    version: number;
  };
  editingProfile: {
    key: string;
    name: string;
    version: number;
  };
  recordingRequests: {
    id: string;
    title: string;
    type: string;
    status: string;
    takeCount: number;
    selectedTakeCount: number;
  }[];
  captures: {
    id: string;
    status: string;
    failureCode: string | null;
    startedAt: string | null;
    finishedAt: string | null;
    createdAt: string;
  }[];
  blockers: {
    id: string;
    reasonCode: string;
    recoverability: string;
    createdAt: string;
  }[];
  renderDetail: {
    id: string;
    status: string;
    attemptNumber: number | null;
    attemptStatus: string | null;
    failureCode: string | null;
    technicalQaResult: string | null;
    creativeQaResult: string | null;
  } | null;
};

const iso = (value: Date) => value.toISOString();

function technicalQaResult(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const result = (value as { result?: unknown }).result;
  return typeof result === 'string' ? result : null;
}

function recordingCounts(rows: { status: string }[]) {
  return {
    total: rows.length,
    pending: rows.filter((row) => row.status === 'PENDING').length,
    readyToRecord: rows.filter((row) => row.status === 'READY_TO_RECORD').length,
    uploaded: rows.filter((row) => row.status === 'UPLOADED').length,
    accepted: rows.filter((row) => row.status === 'ACCEPTED').length,
  };
}

function deriveStage(input: {
  creativePlanStatus: string;
  recordingStatuses: string[];
  captureStatus: string | null;
  hasOpenBlocker: boolean;
  editingStatus: string | null;
  renderStatus: string | null;
}): { stage: ProductionStage; nextAction: string } {
  if (input.renderStatus === 'FAILED' || input.captureStatus === 'FAILED') {
    return {
      stage: 'FAILED',
      nextAction: 'Inspecter l’échec avant toute nouvelle tentative.',
    };
  }

  if (input.renderStatus === 'READY_FOR_REVIEW') {
    return {
      stage: 'WAITING_FOR_ME',
      nextAction: 'Effectuer la review humaine du rendu final.',
    };
  }

  if (
    input.hasOpenBlocker ||
    input.recordingStatuses.some((status) =>
      ['PENDING', 'READY_TO_RECORD', 'UPLOADED'].includes(status),
    )
  ) {
    return {
      stage: 'WAITING_FOR_ME',
      nextAction: input.hasOpenBlocker
        ? 'Résoudre le blocker de montage indiqué.'
        : 'Fournir ou sélectionner les enregistrements requis.',
    };
  }

  if (input.captureStatus && ['PENDING', 'RUNNING'].includes(input.captureStatus)) {
    return {
      stage: 'CAPTURING',
      nextAction: 'La capture produit automatique est en cours.',
    };
  }

  if (
    input.renderStatus &&
    ['REQUESTED', 'QUEUED', 'RENDERING', 'TECHNICAL_QA', 'CREATIVE_QA'].includes(input.renderStatus)
  ) {
    return {
      stage: 'RENDERING',
      nextAction: 'Le rendu et ses contrôles qualité sont en cours.',
    };
  }

  if (input.renderStatus === 'APPROVED') {
    return {
      stage: 'DONE',
      nextAction: 'La production est approuvée et terminée.',
    };
  }

  if (
    input.renderStatus === 'REJECTED' ||
    input.editingStatus ||
    ['READY', 'READY_FOR_EDITING'].includes(input.creativePlanStatus)
  ) {
    return {
      stage: 'EDITING',
      nextAction:
        input.renderStatus === 'REJECTED'
          ? 'Une nouvelle itération de montage est nécessaire.'
          : 'Le montage peut continuer à partir des éléments validés.',
    };
  }

  return {
    stage: 'EDITING',
    nextAction: 'La production attend sa prochaine étape canonique.',
  };
}

export class ProductionReadService {
  constructor(private readonly db: PrismaClient) {}

  async list(): Promise<ProductionListItem[]> {
    const roots = await this.db.creativePlan.findMany({
      where: { status: { notIn: ['ARCHIVED', 'SUPERSEDED'] } },
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      take: 100,
      select: {
        versions: {
          orderBy: { version: 'desc' },
          take: 1,
          select: { id: true },
        },
      },
    });

    const items = await Promise.all(
      roots.flatMap((root) => {
        const version = root.versions[0];
        return version ? [this.detail(version.id)] : [];
      }),
    );

    return items.map((detail) => ({
      creativePlanId: detail.creativePlanId,
      creativePlanVersionId: detail.creativePlanVersionId,
      version: detail.version,
      status: detail.status,
      title: detail.title,
      hook: detail.hook,
      campaignName: detail.campaignName,
      primaryFormat: detail.primaryFormat,
      targetDurationMs: detail.targetDurationMs,
      stage: detail.stage,
      nextAction: detail.nextAction,
      recordings: detail.recordings,
      capture: detail.capture,
      blocker: detail.blocker,
      editing: detail.editing,
      render: detail.render,
      createdAt: detail.createdAt,
    }));
  }

  async detail(creativePlanVersionId: string): Promise<ProductionDetail> {
    const version = await this.db.creativePlanVersion.findUnique({
      where: { id: creativePlanVersionId },
      include: {
        creativePlan: {
          include: {
            concept: {
              include: {
                brief: {
                  include: { campaign: true },
                },
              },
            },
          },
        },
        scriptVersion: {
          include: {
            conceptVersion: true,
          },
        },
        templateVersion: {
          include: { template: true },
        },
        editingProfileVersion: {
          include: { editingProfile: true },
        },
        recordingRequests: {
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          include: {
            recordings: {
              select: {
                status: true,
              },
            },
          },
        },
        captureRuns: {
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          select: {
            id: true,
            status: true,
            failureCode: true,
            startedAt: true,
            finishedAt: true,
            createdAt: true,
          },
        },
        editingBlockers: {
          where: { status: 'OPEN' },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          select: {
            id: true,
            reasonCode: true,
            recoverability: true,
            createdAt: true,
          },
        },
      },
    });

    invariant(version, 'CREATIVE_PLAN_VERSION_NOT_FOUND');

    const editing = await this.db.editingPlanVersion.findFirst({
      where: { creativePlanVersionId },
      orderBy: [{ version: 'desc' }, { id: 'desc' }],
      include: {
        editingPlan: {
          select: { status: true },
        },
        renders: {
          orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
          take: 1,
          include: {
            attempts: {
              orderBy: [{ attemptNumber: 'desc' }, { id: 'desc' }],
              take: 1,
              select: {
                attemptNumber: true,
                status: true,
                failureCode: true,
                technicalQaJson: true,
                creativeQaResult: true,
              },
            },
          },
        },
      },
    });

    const latestCapture = version.captureRuns[0] ?? null;
    const latestBlocker = version.editingBlockers[0] ?? null;
    const latestRender = editing?.renders[0] ?? null;
    const latestAttempt = latestRender?.attempts[0] ?? null;
    const counts = recordingCounts(version.recordingRequests);
    const derived = deriveStage({
      creativePlanStatus: version.creativePlan.status,
      recordingStatuses: version.recordingRequests.map((request) => request.status),
      captureStatus: latestCapture?.status ?? null,
      hasOpenBlocker: Boolean(latestBlocker),
      editingStatus: editing?.editingPlan.status ?? null,
      renderStatus: latestRender?.status ?? null,
    });

    return {
      creativePlanId: version.creativePlanId,
      creativePlanVersionId: version.id,
      version: version.version,
      status: version.creativePlan.status,
      title: version.scriptVersion.conceptVersion.title,
      hook: version.scriptVersion.conceptVersion.hook,
      campaignName: version.creativePlan.concept.brief.campaign.name,
      primaryFormat: version.primaryFormat,
      targetDurationMs: version.targetDurationMs,
      stage: derived.stage,
      nextAction: derived.nextAction,
      recordings: counts,
      capture: latestCapture
        ? {
            id: latestCapture.id,
            status: latestCapture.status,
            failureCode: latestCapture.failureCode,
            createdAt: iso(latestCapture.createdAt),
          }
        : null,
      blocker: latestBlocker
        ? {
            id: latestBlocker.id,
            reasonCode: latestBlocker.reasonCode,
            recoverability: latestBlocker.recoverability,
            createdAt: iso(latestBlocker.createdAt),
          }
        : null,
      editing: editing
        ? {
            editingPlanVersionId: editing.id,
            status: editing.editingPlan.status,
            version: editing.version,
          }
        : null,
      render: latestRender
        ? {
            id: latestRender.id,
            status: latestRender.status,
            attemptStatus: latestAttempt?.status ?? null,
            technicalQaResult: technicalQaResult(latestAttempt?.technicalQaJson),
            creativeQaResult: latestAttempt?.creativeQaResult ?? null,
          }
        : null,
      createdAt: iso(version.createdAt),
      script: {
        scriptVersionId: version.scriptVersion.id,
        fullText: version.scriptVersion.fullText,
        estimatedDurationMs: version.scriptVersion.estimatedDurationMs,
        voiceMode: version.scriptVersion.voiceMode,
      },
      template: {
        key: version.templateVersion.template.key,
        name: version.templateVersion.template.name,
        version: version.templateVersion.version,
      },
      editingProfile: {
        key: version.editingProfileVersion.editingProfile.key,
        name: version.editingProfileVersion.editingProfile.name,
        version: version.editingProfileVersion.version,
      },
      recordingRequests: version.recordingRequests.map((request) => ({
        id: request.id,
        title: request.title,
        type: request.type,
        status: request.status,
        takeCount: request.recordings.length,
        selectedTakeCount: request.recordings.filter((take) => take.status === 'SELECTED').length,
      })),
      captures: version.captureRuns.map((capture) => ({
        id: capture.id,
        status: capture.status,
        failureCode: capture.failureCode,
        startedAt: capture.startedAt ? iso(capture.startedAt) : null,
        finishedAt: capture.finishedAt ? iso(capture.finishedAt) : null,
        createdAt: iso(capture.createdAt),
      })),
      blockers: version.editingBlockers.map((blocker) => ({
        id: blocker.id,
        reasonCode: blocker.reasonCode,
        recoverability: blocker.recoverability,
        createdAt: iso(blocker.createdAt),
      })),
      renderDetail: latestRender
        ? {
            id: latestRender.id,
            status: latestRender.status,
            attemptNumber: latestAttempt?.attemptNumber ?? null,
            attemptStatus: latestAttempt?.status ?? null,
            failureCode: latestAttempt?.failureCode ?? null,
            technicalQaResult: technicalQaResult(latestAttempt?.technicalQaJson),
            creativeQaResult: latestAttempt?.creativeQaResult ?? null,
          }
        : null,
    };
  }
}
