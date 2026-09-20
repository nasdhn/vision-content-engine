import { invariant } from '@vision/domain';
import type { Transaction } from './transaction.js';

export const conceptSelectionAction = 'Concept.versionSelectedForReview';
export const conceptSelectionDecisionAction = 'ConceptReviewSelection.decided';

/** Caller holds the Concept row lock. Selection is an audit fact, never a provisional Approval. */
export async function pendingConceptSelection(tx: Transaction, conceptId: string) {
  const selections = await tx.$queryRaw<{ id: string; conceptVersionId: string }[]>`
    SELECT selection."id", selection."subjectVersionId" AS "conceptVersionId"
    FROM "AuditEvent" selection
    WHERE selection."subjectType" = 'Concept' AND selection."subjectId" = ${conceptId}
      AND selection."action" = ${conceptSelectionAction} AND selection."actorType" = 'USER'
      AND selection."actorId" IS NOT NULL AND selection."subjectVersionId" IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM "AuditEvent" decision
        WHERE decision."subjectType" = 'ConceptReviewSelection'
          AND decision."subjectId" = selection."id"::text
          AND decision."action" = ${conceptSelectionDecisionAction}
      )`;
  // Identity/consumption, not timestamp sorting: concurrent transactions can start out of order.
  invariant(selections.length <= 1, 'CONFLICTING_CONCEPT_SELECTIONS');
  return selections[0] ?? null;
}
