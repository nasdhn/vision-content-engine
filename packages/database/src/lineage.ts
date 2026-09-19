import { assertSameLineage, invariant } from '@vision/domain';
import type { Transaction } from './transaction.js';

export async function approvedConcept(tx: Transaction, conceptVersionId: string) {
  const approval = await tx.approval.findFirst({
    where: { conceptVersionId, subjectType: 'CONCEPT', actorType: 'USER' },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
  invariant(approval?.decision === 'APPROVED' && approval.actorId, 'CONCEPT_APPROVAL_REQUIRED');
}
export async function validateScript(tx: Transaction, scriptId: string, conceptVersionId: string) {
  const script = await tx.script.findUniqueOrThrow({ where: { id: scriptId } });
  const concept = await tx.conceptVersion.findUniqueOrThrow({ where: { id: conceptVersionId } });
  assertSameLineage(script.conceptId, concept.conceptId);
  await approvedConcept(tx, conceptVersionId);
  return concept;
}
export async function validateCreative(
  tx: Transaction,
  creativePlanId: string,
  scriptVersionId: string,
) {
  const plan = await tx.creativePlan.findUniqueOrThrow({ where: { id: creativePlanId } });
  const script = await tx.scriptVersion.findUniqueOrThrow({ where: { id: scriptVersionId } });
  const concept = await validateScript(tx, script.scriptId, script.conceptVersionId);
  assertSameLineage(plan.conceptId, concept.conceptId);
  return script;
}
export async function validateEditing(
  tx: Transaction,
  data: {
    editingPlanId: string;
    creativePlanVersionId: string;
    templateVersionId: string;
    editingProfileVersionId: string;
  },
) {
  const root = await tx.editingPlan.findUniqueOrThrow({ where: { id: data.editingPlanId } });
  const creative = await tx.creativePlanVersion.findUniqueOrThrow({
    where: { id: data.creativePlanVersionId },
  });
  assertSameLineage(root.creativePlanId, creative.creativePlanId);
  assertSameLineage(creative.templateVersionId, data.templateVersionId);
  assertSameLineage(creative.editingProfileVersionId, data.editingProfileVersionId);
  await validateCreative(tx, creative.creativePlanId, creative.scriptVersionId);
  return creative;
}
export async function validateRender(tx: Transaction, editingPlanVersionId: string) {
  const editing = await tx.editingPlanVersion.findUniqueOrThrow({
    where: { id: editingPlanVersionId },
  });
  await validateEditing(tx, editing);
  return editing;
}
export async function validatePublication(
  tx: Transaction,
  renderId: string,
  mediaAssetId: string,
  platform: 'TIKTOK' | 'INSTAGRAM' | 'YOUTUBE',
) {
  const render = await tx.render.findUniqueOrThrow({ where: { id: renderId } });
  invariant(render.status === 'APPROVED' && render.approvedAssetId, 'RENDER_APPROVAL_REQUIRED');
  const approval = await tx.approval.findFirst({
    where: { renderId, subjectType: 'RENDER', actorType: 'USER' },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
  invariant(approval?.decision === 'APPROVED' && approval.actorId, 'RENDER_APPROVAL_REQUIRED');
  await validateRender(tx, render.editingPlanVersionId);
  const asset = await tx.asset.findUniqueOrThrow({ where: { id: mediaAssetId } });
  invariant(asset.status === 'READY' && asset.deletedAt === null, 'MEDIA_NOT_READY');
  if (mediaAssetId !== render.approvedAssetId) {
    const derivation = await tx.assetDerivation.findUnique({
      where: { derivedAssetId: mediaAssetId },
    });
    invariant(
      derivation?.sourceAssetId === render.approvedAssetId &&
        derivation.type === 'PLATFORM_DERIVATIVE' &&
        (derivation.platform === null || derivation.platform === platform),
      'MEDIA_LINEAGE_MISMATCH',
    );
  }
}
