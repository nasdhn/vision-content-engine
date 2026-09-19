import { assertHuman, assertInstant, assertTransition, invariant } from '@vision/domain';
import type {
  PrismaClient,
  Prisma,
  WorkflowStatus,
  RenderStatus,
} from './generated/prisma/client.js';
import { audit, changed, databaseTime, emit, lock } from './transaction.js';
import type { Actor, OutboxInput, Transaction } from './transaction.js';
import { Versions } from './versions.js';
import { validatePublication, validateRender } from './lineage.js';

export class UnitOfWork {
  readonly versions: Versions;
  constructor(
    private readonly tx: Transaction,
    private readonly actor: Actor,
  ) {
    this.versions = new Versions(tx, actor);
  }
  async createCampaign(data: Pick<Prisma.CampaignCreateInput, 'name' | 'slug' | 'objective'>) {
    const row = await this.tx.campaign.create({
      data: {
        name: data.name,
        slug: data.slug,
        ...(data.objective !== undefined ? { objective: data.objective } : {}),
      },
    });
    await changed(this.tx, this.actor, 'Campaign.created', 'Campaign', row.id);
    return row;
  }
  async createBrief(campaignId: string, title: string) {
    const row = await this.tx.brief.create({ data: { campaignId, title } });
    await changed(this.tx, this.actor, 'Brief.created', 'Brief', row.id);
    return row;
  }
  async createConcept(briefId: string) {
    const row = await this.tx.concept.create({ data: { briefId } });
    await changed(this.tx, this.actor, 'Concept.created', 'Concept', row.id);
    return row;
  }
  async createScript(conceptId: string) {
    const row = await this.tx.script.create({ data: { conceptId } });
    await changed(this.tx, this.actor, 'Script.created', 'Script', row.id);
    return row;
  }
  async createCreativePlan(conceptId: string) {
    const row = await this.tx.creativePlan.create({ data: { conceptId } });
    await changed(this.tx, this.actor, 'CreativePlan.created', 'CreativePlan', row.id);
    return row;
  }
  async createEditingPlan(creativePlanId: string) {
    const row = await this.tx.editingPlan.create({ data: { creativePlanId } });
    await changed(this.tx, this.actor, 'EditingPlan.created', 'EditingPlan', row.id);
    return row;
  }
  async submitConcept(conceptVersionId: string) {
    const version = await this.tx.conceptVersion.findUniqueOrThrow({
      where: { id: conceptVersionId },
    });
    await lock(this.tx, 'Concept', version.conceptId);
    const concept = await this.tx.concept.findUniqueOrThrow({ where: { id: version.conceptId } });
    const latest = await this.tx.conceptVersion.findFirstOrThrow({
      where: { conceptId: concept.id },
      orderBy: { version: 'desc' },
    });
    invariant(latest.id === version.id, 'STALE_VERSION');
    assertTransition('concept', concept.status, 'AWAITING_REVIEW');
    await this.tx.concept.update({
      where: { id: concept.id },
      data: { status: 'AWAITING_REVIEW' },
    });
    await changed(this.tx, this.actor, 'Concept.submitted', 'Concept', concept.id, version.id);
  }
  async decideConcept(
    conceptVersionId: string,
    decision: 'APPROVED' | 'REJECTED',
    comment?: string,
  ) {
    assertHuman(this.actor);
    const version = await this.tx.conceptVersion.findUniqueOrThrow({
      where: { id: conceptVersionId },
    });
    await lock(this.tx, 'Concept', version.conceptId);
    const concept = await this.tx.concept.findUniqueOrThrow({ where: { id: version.conceptId } });
    const latest = await this.tx.conceptVersion.findFirstOrThrow({
      where: { conceptId: concept.id },
      orderBy: { version: 'desc' },
    });
    invariant(latest.id === version.id, 'STALE_VERSION');
    assertTransition('concept', concept.status, decision);
    const result = await this.tx.approval.create({
      data: {
        subjectType: 'CONCEPT',
        conceptVersionId,
        decision,
        actorType: 'USER',
        actorId: this.actor.actorId!,
        ...(comment !== undefined ? { comment } : {}),
      },
    });
    await this.tx.concept.update({ where: { id: concept.id }, data: { status: decision } });
    await changed(
      this.tx,
      this.actor,
      `Concept.${decision.toLowerCase()}`,
      'Concept',
      concept.id,
      version.id,
    );
    return result;
  }
  async requestRender(editingPlanVersionId: string) {
    await validateRender(this.tx, editingPlanVersionId);
    const row = await this.tx.render.create({ data: { editingPlanVersionId } });
    await changed(this.tx, this.actor, 'Render.requested', 'Render', row.id);
    return row;
  }
  /** Persistence transition only; technical/creative QA execution belongs to later phases. */
  async transitionRender(
    id: string,
    expected: RenderStatus,
    next: Exclude<RenderStatus, 'APPROVED' | 'REJECTED'>,
  ) {
    invariant(
      next !== ('APPROVED' as string) && next !== ('REJECTED' as string),
      'HUMAN_APPROVAL_REQUIRED',
    );
    await lock(this.tx, 'Render', id);
    const row = await this.tx.render.findUniqueOrThrow({ where: { id } });
    invariant(row.status === expected, 'STALE_STATE');
    assertTransition('render', expected, next);
    await this.tx.render.update({ where: { id }, data: { status: next } });
    await changed(this.tx, this.actor, `Render.${next.toLowerCase()}`, 'Render', id);
  }
  async decideRender(id: string, decision: 'APPROVED' | 'REJECTED', outputAssetId?: string) {
    assertHuman(this.actor);
    await lock(this.tx, 'Render', id);
    const render = await this.tx.render.findUniqueOrThrow({ where: { id } });
    assertTransition('render', render.status, decision);
    await validateRender(this.tx, render.editingPlanVersionId);
    if (decision === 'APPROVED') {
      invariant(outputAssetId, 'EXACT_RENDER_ASSET_REQUIRED');
      const attempt = await this.tx.renderAttempt.findFirst({
        where: { renderId: id, outputAssetId, status: 'SUCCEEDED' },
      });
      const asset = await this.tx.asset.findUnique({ where: { id: outputAssetId } });
      invariant(
        attempt && asset?.status === 'READY' && asset.deletedAt === null,
        'RENDER_OUTPUT_MISMATCH',
      );
    }
    const result = await this.tx.approval.create({
      data: {
        subjectType: 'RENDER',
        renderId: id,
        decision,
        actorType: 'USER',
        actorId: this.actor.actorId!,
      },
    });
    await this.tx.render.update({
      where: { id },
      data: { status: decision, approvedAssetId: decision === 'APPROVED' ? outputAssetId! : null },
    });
    await changed(this.tx, this.actor, `Render.${decision.toLowerCase()}`, 'Render', id);
    return result;
  }
  /** Persist a draft only; no scheduling, capability activation or external effect. */
  async createPublication(data: {
    renderId: string;
    platformAccountId: string;
    mediaAssetId: string;
    deliveryMode: 'API_AUTOMATED' | 'MANUAL_HANDOFF';
    metadataJson: Prisma.InputJsonValue;
  }) {
    invariant(
      data.deliveryMode === 'API_AUTOMATED' || data.deliveryMode === 'MANUAL_HANDOFF',
      'DELIVERY_MODE_REQUIRED',
    );
    const account = await this.tx.platformAccount.findUniqueOrThrow({
      where: { id: data.platformAccountId },
    });
    invariant(
      account.platform !== 'TIKTOK' || data.deliveryMode === 'MANUAL_HANDOFF',
      'TIKTOK_MANUAL_ONLY',
    );
    await lock(this.tx, 'Render', data.renderId);
    await validatePublication(this.tx, data.renderId, data.mediaAssetId, account.platform);
    const result = await this.tx.publication.create({
      data: {
        renderId: data.renderId,
        platformAccountId: data.platformAccountId,
        mediaAssetId: data.mediaAssetId,
        deliveryMode: data.deliveryMode,
        metadataJson: data.metadataJson,
      },
    });
    await changed(this.tx, this.actor, 'Publication.created', 'Publication', result.id);
    return result;
  }
  async createWorkflow(
    data: Pick<Prisma.WorkflowRunCreateInput, 'workflowType' | 'rootEntityType' | 'rootEntityId'>,
  ) {
    const result = await this.tx.workflowRun.create({
      data: {
        workflowType: data.workflowType,
        rootEntityType: data.rootEntityType,
        rootEntityId: data.rootEntityId,
      },
    });
    await changed(this.tx, this.actor, 'WorkflowRun.created', 'WorkflowRun', result.id);
    return result;
  }
  async transitionWorkflow(
    id: string,
    expected: WorkflowStatus,
    next: WorkflowStatus,
    currentStep?: string,
  ) {
    await lock(this.tx, 'WorkflowRun', id);
    const row = await this.tx.workflowRun.findUniqueOrThrow({ where: { id } });
    invariant(row.status === expected, 'STALE_STATE');
    assertTransition('workflow', expected, next);
    const now = await databaseTime(this.tx);
    const result = await this.tx.workflowRun.update({
      where: { id },
      data: {
        status: next,
        ...(currentStep !== undefined ? { currentStep } : {}),
        ...(next === 'RUNNING' && row.startedAt === null ? { startedAt: now } : {}),
        ...(['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(next) ? { finishedAt: now } : {}),
      },
    });
    await changed(this.tx, this.actor, `WorkflowRun.${next.toLowerCase()}`, 'WorkflowRun', id);
    return result;
  }
  async enqueueJob(data: {
    workflowRunId?: string;
    queueName: string;
    jobType: string;
    operationId: string;
    attemptNumber: number;
  }) {
    invariant(
      Number.isSafeInteger(data.attemptNumber) && data.attemptNumber > 0,
      'INVALID_ATTEMPT_NUMBER',
    );
    const row = await this.tx.jobAttempt.create({
      data: {
        queueName: data.queueName,
        jobType: data.jobType,
        operationId: data.operationId,
        attemptNumber: data.attemptNumber,
        ...(data.workflowRunId ? { workflowRunId: data.workflowRunId } : {}),
      },
    });
    await changed(this.tx, this.actor, 'JobAttempt.queued', 'JobAttempt', row.id);
    return row;
  }
  emit(input: OutboxInput) {
    return emit(this.tx, input);
  }
  audit(action: string, subjectType: string, subjectId: string, subjectVersionId?: string) {
    return audit(this.tx, this.actor, action, subjectType, subjectId, subjectVersionId);
  }
  async recordCost(data: Omit<Prisma.CostEntryUncheckedCreateInput, 'id' | 'createdAt'>) {
    invariant(data.occurredAt instanceof Date, 'INVALID_INSTANT');
    assertInstant(data.occurredAt);
    const row = await this.tx.costEntry.create({ data });
    await audit(this.tx, this.actor, 'CostEntry.recorded', 'CostEntry', row.id);
    return row;
  }
}
export class Persistence {
  constructor(private readonly client: PrismaClient) {}
  /** No automatic retry: callbacks may not perform network/transport side effects. */
  transaction<T>(actor: Actor, work: (unit: UnitOfWork) => Promise<T>): Promise<T> {
    return this.client.$transaction((tx) => work(new UnitOfWork(tx, actor)), {
      isolationLevel: 'ReadCommitted',
      maxWait: 5000,
      timeout: 10000,
    });
  }
}
