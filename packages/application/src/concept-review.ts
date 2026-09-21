import { invariant } from '@vision/domain';
import { Persistence, type Actor, type PrismaClient } from '@vision/database';

export const CONCEPT_REJECTION_REASON_CODES = [
  'HOOK_WEAK',
  'ANGLE_TOO_GENERIC',
  'TOO_AD_LIKE',
  'TOO_REPETITIVE',
  'NOT_TRUE_TO_VISION',
  'WRONG_AUDIENCE',
  'OTHER',
] as const;

export type ConceptRejectionReasonCode = (typeof CONCEPT_REJECTION_REASON_CODES)[number];

export type ConceptReviewListItem = {
  conceptId: string;
  conceptVersionId: string;
  version: number;
  title: string;
  hook: string | null;
  angle: string | null;
  audience: string | null;
  objective: string | null;
  hypothesis: string | null;
  rationale: string | null;
  createdAt: string;
  pattern: {
    id: string;
    key: string;
    name: string;
    version: number;
  } | null;
  brief: {
    id: string;
    title: string;
    goal: string | null;
    audience: string | null;
    campaign: {
      id: string;
      name: string;
      slug: string;
    };
  };
};

export type ConceptReviewDetail = ConceptReviewListItem & {
  status: string;
  latestConceptVersionId: string;
  isLatest: boolean;
  decisionAllowed: boolean;
  previousDecision: {
    id: string;
    decision: string;
    reasonCode: string | null;
    comment: string | null;
    createdAt: string;
  } | null;
};

type ConceptVersionWithReviewContext = {
  id: string;
  conceptId: string;
  version: number;
  title: string;
  hook: string | null;
  angle: string | null;
  audience: string | null;
  objective: string | null;
  hypothesis: string | null;
  rationale: string | null;
  createdAt: Date;
  selectedPatternVersion: null | {
    id: string;
    version: number;
    pattern: { key: string; name: string };
  };
  concept: {
    brief: {
      id: string;
      title: string;
      goal: string | null;
      audience: string | null;
      campaign: { id: string; name: string; slug: string };
    };
  };
};

function listItem(row: ConceptVersionWithReviewContext): ConceptReviewListItem {
  return {
    conceptId: row.conceptId,
    conceptVersionId: row.id,
    version: row.version,
    title: row.title,
    hook: row.hook,
    angle: row.angle,
    audience: row.audience,
    objective: row.objective,
    hypothesis: row.hypothesis,
    rationale: row.rationale,
    createdAt: row.createdAt.toISOString(),
    pattern: row.selectedPatternVersion
      ? {
          id: row.selectedPatternVersion.id,
          key: row.selectedPatternVersion.pattern.key,
          name: row.selectedPatternVersion.pattern.name,
          version: row.selectedPatternVersion.version,
        }
      : null,
    brief: {
      id: row.concept.brief.id,
      title: row.concept.brief.title,
      goal: row.concept.brief.goal,
      audience: row.concept.brief.audience,
      campaign: row.concept.brief.campaign,
    },
  };
}

export class ConceptReviewService {
  private readonly persistence: Persistence;

  constructor(private readonly db: PrismaClient) {
    this.persistence = new Persistence(db);
  }

  async queue(): Promise<ConceptReviewListItem[]> {
    const concepts = await this.db.concept.findMany({
      where: { status: 'AWAITING_REVIEW' },
      orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
      select: {
        versions: {
          orderBy: { version: 'desc' },
          take: 1,
          include: {
            selectedPatternVersion: {
              include: { pattern: true },
            },
            concept: {
              include: {
                brief: {
                  include: { campaign: true },
                },
              },
            },
          },
        },
      },
    });

    return concepts.flatMap((concept) => {
      const version = concept.versions[0];
      return version ? [listItem(version)] : [];
    });
  }

  async detail(conceptVersionId: string): Promise<ConceptReviewDetail> {
    const version = await this.db.conceptVersion.findUnique({
      where: { id: conceptVersionId },
      include: {
        selectedPatternVersion: {
          include: { pattern: true },
        },
        concept: {
          include: {
            brief: {
              include: { campaign: true },
            },
          },
        },
        approvals: {
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 1,
        },
      },
    });

    invariant(version, 'CONCEPT_VERSION_NOT_FOUND');

    const latest = await this.db.conceptVersion.findFirstOrThrow({
      where: { conceptId: version.conceptId },
      orderBy: { version: 'desc' },
      select: { id: true },
    });

    const previousDecision = version.approvals[0] ?? null;

    return {
      ...listItem(version),
      status: version.concept.status,
      latestConceptVersionId: latest.id,
      isLatest: latest.id === version.id,
      decisionAllowed: version.concept.status === 'AWAITING_REVIEW' && latest.id === version.id,
      previousDecision: previousDecision
        ? {
            id: previousDecision.id,
            decision: previousDecision.decision,
            reasonCode: previousDecision.reasonCode,
            comment: previousDecision.comment,
            createdAt: previousDecision.createdAt.toISOString(),
          }
        : null,
    };
  }

  async decide(
    actor: Actor,
    conceptVersionId: string,
    input: {
      decision: 'APPROVED' | 'REJECTED';
      reasonCode?: ConceptRejectionReasonCode;
      comment?: string;
    },
  ) {
    const comment = input.comment?.trim() || undefined;

    if (input.decision === 'APPROVED') invariant(!input.reasonCode, 'INVALID_CONCEPT_REASON');
    if (input.reasonCode) {
      invariant(
        CONCEPT_REJECTION_REASON_CODES.includes(input.reasonCode),
        'INVALID_CONCEPT_REASON',
      );
    }

    const approval = await this.persistence.transaction(actor, (unit) =>
      unit.decideConcept(conceptVersionId, input.decision, comment, input.reasonCode),
    );

    return {
      approvalId: approval.id,
      conceptVersionId: approval.conceptVersionId,
      decision: approval.decision,
      reasonCode: approval.reasonCode,
      comment: approval.comment,
      createdAt: approval.createdAt.toISOString(),
    };
  }
}
