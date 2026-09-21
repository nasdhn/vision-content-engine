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
import { approvedConcept, validatePublication, validateRender } from './lineage.js';
import { EditingPlanSpecSchema, TemplateRuntimeContractSchema } from '@vision/contracts';
import { contentHash, normalize, textHash } from '@vision/contracts/canonical';
import {
  conceptSelectionAction,
  conceptSelectionDecisionAction,
  pendingConceptSelection,
} from './concept-selection.js';

import { Recordings } from './recordings.js';
import { Patterns } from './patterns.js';
import { Knowledge } from './knowledge.js';
import { Captures } from './captures.js';
import { EditingProfiles } from './editing-profiles.js';
import { Templates } from './templates.js';

export class UnitOfWork {
  readonly recordings: Recordings;
  readonly captures: Captures;
  readonly editingProfiles: EditingProfiles;
  readonly templates: Templates;
  readonly knowledge: Knowledge;
  readonly patterns: Patterns;
  readonly versions: Versions;
  constructor(
    private readonly tx: Transaction,
    private readonly actor: Actor,
  ) {
    this.recordings = new Recordings(tx, actor);
    this.captures = new Captures(tx, actor);
    this.editingProfiles = new EditingProfiles(tx, actor);
    this.templates = new Templates(tx, actor);
    this.versions = new Versions(tx, actor);
    this.knowledge = new Knowledge(tx, actor);
    this.patterns = new Patterns(tx, actor);
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
  async linkConceptIdea(conceptId: string, ideaId: string) {
    await lock(this.tx, 'Concept', conceptId);
    const concept = await this.tx.concept.findUniqueOrThrow({ where: { id: conceptId } });
    const idea = await this.tx.idea.findUniqueOrThrow({ where: { id: ideaId } });
    invariant(
      concept.ideaId === null &&
        concept.status === 'DRAFT' &&
        (!idea.briefId || idea.briefId === concept.briefId),
      'IDEA_LINEAGE_MISMATCH',
    );
    await this.tx.concept.update({ where: { id: conceptId }, data: { ideaId } });
    await changed(this.tx, this.actor, 'Concept.ideaLinked', 'Concept', conceptId);
  }
  async productionRoots(conceptVersionId: string) {
    const version = await this.tx.conceptVersion.findUniqueOrThrow({
      where: { id: conceptVersionId },
    });
    await lock(this.tx, 'Concept', version.conceptId);
    await approvedConcept(this.tx, conceptVersionId);
    const concept = await this.tx.concept.findUniqueOrThrow({ where: { id: version.conceptId } });
    invariant(concept.status !== 'ARCHIVED', 'CONCEPT_ARCHIVED');
    const script =
      (await this.tx.script.findUnique({ where: { conceptId: version.conceptId } })) ??
      (await this.createScript(version.conceptId));
    const plan =
      (await this.tx.creativePlan.findUnique({ where: { conceptId: version.conceptId } })) ??
      (await this.createCreativePlan(version.conceptId));
    invariant(
      !['ARCHIVED', 'SUPERSEDED'].includes(script.status) &&
        !['ARCHIVED', 'SUPERSEDED'].includes(plan.status),
      'PRODUCTION_ARCHIVED',
    );
    return { script, plan };
  }
  /** Atomic with downstream writes: the same validated result cannot be applied twice. */
  async consumeInvocation(id: string, output: unknown) {
    await this.tx.$queryRaw`SELECT id FROM "ModelInvocation" WHERE id = ${id}::uuid FOR UPDATE`;
    const invocation = await this.tx.modelInvocation.findUniqueOrThrow({ where: { id } });
    invariant(
      invocation.status === 'SUCCEEDED' && invocation.outputHash === contentHash(output),
      'VALIDATED_INVOCATION_REQUIRED',
    );
    invariant(
      !(await this.tx.auditEvent.findFirst({
        where: { subjectId: id, action: 'ModelInvocation.applied' },
      })),
      'INVOCATION_ALREADY_APPLIED',
    );
    await audit(this.tx, this.actor, 'ModelInvocation.applied', 'ModelInvocation', id);
  }
  async rejectRepeatedHooks(hooks: string[]) {
    await this.tx
      .$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('creator-hook-dedup', 0))`;
    const recent = await this.tx.conceptVersion.findMany({
      take: 100,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    invariant(
      !hooks.some((hook) => recent.some((v) => v.hook && normalize(v.hook) === normalize(hook))),
      'DUPLICATE_HOOK',
    );
  }
  async rejectRepeatedScript(fullText: string, deliberateSourceVersionId?: string) {
    await this.tx
      .$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('director-script-dedup', 0))`;
    const recent = await this.tx.scriptVersion.findMany({
      take: 100,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    invariant(
      !recent.some(
        (v) =>
          v.conceptVersionId !== deliberateSourceVersionId &&
          textHash(normalize(v.fullText)) === textHash(normalize(fullText)),
      ),
      'DUPLICATE_SCRIPT',
    );
  }
  async preserveClaimEvidence(
    subjectType: string,
    subjectId: string,
    versionId: string,
    claims: Prisma.InputJsonValue,
    knowledgeSnapshotId: string,
    invocationId: string,
  ) {
    return this.tx.auditEvent.create({
      data: {
        ...this.actor,
        action: 'Content.claimEvidence',
        subjectType,
        subjectId,
        subjectVersionId: versionId,
        afterJson: { claims, knowledgeSnapshotId, invocationId },
      },
    });
  }
  async markProductionReady(scriptId: string, planId: string) {
    await lock(this.tx, 'Script', scriptId);
    await lock(this.tx, 'CreativePlan', planId);
    const script = await this.tx.script.findUniqueOrThrow({ where: { id: scriptId } });
    const plan = await this.tx.creativePlan.findUniqueOrThrow({ where: { id: planId } });
    invariant(
      script.conceptId === plan.conceptId &&
        !['ARCHIVED', 'SUPERSEDED'].includes(script.status) &&
        !['ARCHIVED', 'SUPERSEDED'].includes(plan.status),
      'PRODUCTION_NOT_VALID',
    );
    await this.tx.script.update({ where: { id: scriptId }, data: { status: 'READY' } });
    await this.tx.creativePlan.update({ where: { id: planId }, data: { status: 'READY' } });
    await changed(this.tx, this.actor, 'CreativePlan.ready', 'CreativePlan', planId);
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
  async ensureEditingPlan(creativePlanId: string) {
    await lock(this.tx, 'CreativePlan', creativePlanId);

    const creativePlan = await this.tx.creativePlan.findUniqueOrThrow({
      where: {
        id: creativePlanId,
      },
    });

    invariant(creativePlan.status === 'READY_FOR_EDITING', 'CREATIVE_PLAN_NOT_READY_FOR_EDITING');

    const existing = await this.tx.editingPlan.findUnique({
      where: {
        creativePlanId,
      },
    });

    if (existing) return existing;

    const row = await this.tx.editingPlan.create({
      data: {
        creativePlanId,
      },
    });

    await changed(this.tx, this.actor, 'EditingPlan.created', 'EditingPlan', row.id);

    return row;
  }

  async markEditingPlanReady(editingPlanVersionId: string) {
    const version = await this.tx.editingPlanVersion.findUniqueOrThrow({
      where: {
        id: editingPlanVersionId,
      },
    });

    invariant(
      version.planSpecJson !== null && version.modelInvocationId !== null,
      'EDITING_PLAN_VALIDATED_SPEC_REQUIRED',
    );

    const parsedEditingPlan = EditingPlanSpecSchema.safeParse(version.planSpecJson);

    invariant(parsedEditingPlan.success, 'EDITING_PLAN_VALIDATED_SPEC_REQUIRED');

    const invocation = await this.tx.modelInvocation.findUniqueOrThrow({
      where: {
        id: version.modelInvocationId,
      },
    });

    invariant(
      invocation.status === 'SUCCEEDED' &&
        invocation.outputHash === contentHash(parsedEditingPlan.data),
      'VALIDATED_INVOCATION_REQUIRED',
    );

    const appliedInvocation = await this.tx.auditEvent.findFirst({
      where: {
        subjectId: invocation.id,
        subjectType: 'ModelInvocation',
        action: 'ModelInvocation.applied',
      },
    });

    invariant(appliedInvocation, 'VALIDATED_INVOCATION_REQUIRED');

    invariant(
      contentHash(version.timelineJson) === contentHash(parsedEditingPlan.data.timeline) &&
        contentHash(version.captionPlanJson) === contentHash(parsedEditingPlan.data.captions) &&
        contentHash(version.audioPlanJson) === contentHash(parsedEditingPlan.data.audio) &&
        contentHash(version.visualFocusJson) === contentHash(parsedEditingPlan.data.productFocus) &&
        contentHash(version.transitionPlanJson) ===
          contentHash(parsedEditingPlan.data.transitions) &&
        contentHash(version.greenScreenPlanJson) ===
          contentHash(parsedEditingPlan.data.presenter) &&
        contentHash(version.renderSettingsJson) ===
          contentHash(parsedEditingPlan.data.renderSettings),
      'EDITING_PLAN_PROJECTION_MISMATCH',
    );

    await lock(this.tx, 'EditingPlan', version.editingPlanId);

    await validateRender(this.tx, version.id);

    const root = await this.tx.editingPlan.findUniqueOrThrow({
      where: {
        id: version.editingPlanId,
      },
    });

    const creativePlan = await this.tx.creativePlan.findUniqueOrThrow({
      where: {
        id: root.creativePlanId,
      },
    });

    invariant(creativePlan.status === 'READY_FOR_EDITING', 'CREATIVE_PLAN_NOT_READY_FOR_EDITING');

    const latest = await this.tx.editingPlanVersion.findFirstOrThrow({
      where: {
        editingPlanId: root.id,
      },

      orderBy: {
        version: 'desc',
      },
    });

    invariant(latest.id === version.id, 'STALE_VERSION');

    invariant(!['SUPERSEDED', 'ARCHIVED'].includes(root.status), 'EDITING_PLAN_NOT_WRITABLE');

    if (root.status !== 'READY') {
      await this.tx.editingPlan.update({
        where: {
          id: root.id,
        },

        data: {
          status: 'READY',
        },
      });

      await changed(this.tx, this.actor, 'EditingPlan.ready', 'EditingPlan', root.id, version.id);
    }

    return version;
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
    invariant(!(await pendingConceptSelection(this.tx, concept.id)), 'EXPLICIT_SELECTION_REQUIRED');
    return this.recordConceptDecision(concept.id, version.id, decision, comment);
  }
  /** Deliberate USER selection of an exact version, independent of the latest-version flow. */
  async selectConceptVersionForReview(conceptVersionId: string) {
    assertHuman(this.actor);
    const version = await this.tx.conceptVersion.findUniqueOrThrow({
      where: { id: conceptVersionId },
    });
    await lock(this.tx, 'Concept', version.conceptId);
    const concept = await this.tx.concept.findUniqueOrThrow({ where: { id: version.conceptId } });
    invariant(!(await pendingConceptSelection(this.tx, concept.id)), 'CONCEPT_SELECTION_PENDING');
    if (concept.status !== 'AWAITING_REVIEW') {
      assertTransition('concept', concept.status, 'AWAITING_REVIEW');
    }
    const selection = await audit(
      this.tx,
      this.actor,
      conceptSelectionAction,
      'Concept',
      concept.id,
      version.id,
    );
    await this.tx.concept.update({
      where: { id: concept.id },
      data: { status: 'AWAITING_REVIEW' },
    });
    await changed(this.tx, this.actor, 'Concept.submitted', 'Concept', concept.id, version.id);
    return { selectionId: selection.id, conceptVersionId: version.id };
  }
  /** Resolve the persisted subject; the caller cannot substitute another version at decision time. */
  async decideSelectedConcept(
    selectionId: string,
    decision: 'APPROVED' | 'REJECTED',
    comment?: string,
  ) {
    assertHuman(this.actor);
    const selection = await this.tx.auditEvent.findFirst({
      where: {
        id: selectionId,
        action: conceptSelectionAction,
        subjectType: 'Concept',
        actorType: 'USER',
        actorId: { not: null },
        subjectVersionId: { not: null },
      },
    });
    invariant(selection?.subjectVersionId, 'INVALID_CONCEPT_SELECTION');
    await lock(this.tx, 'Concept', selection.subjectId);
    const pending = await pendingConceptSelection(this.tx, selection.subjectId);
    invariant(pending?.id === selection.id, 'CONCEPT_SELECTION_RESOLVED');
    const version = await this.tx.conceptVersion.findUniqueOrThrow({
      where: { id: pending.conceptVersionId },
    });
    invariant(version.conceptId === selection.subjectId, 'LINEAGE_MISMATCH');
    const approval = await this.recordConceptDecision(
      version.conceptId,
      version.id,
      decision,
      comment,
    );
    await this.tx.auditEvent.create({
      data: {
        ...this.actor,
        action: conceptSelectionDecisionAction,
        subjectType: 'ConceptReviewSelection',
        subjectId: selection.id,
        subjectVersionId: version.id,
        afterJson: { approvalId: approval.id },
      },
    });
    return approval;
  }
  /** Both callers hold the same Concept lock; the existing Approval remains the final authority. */
  private async recordConceptDecision(
    conceptId: string,
    conceptVersionId: string,
    decision: 'APPROVED' | 'REJECTED',
    comment?: string,
  ) {
    const concept = await this.tx.concept.findUniqueOrThrow({ where: { id: conceptId } });
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
      conceptVersionId,
    );
    return result;
  }
  async requestRender(editingPlanVersionId: string) {
    const editing = await validateRender(this.tx, editingPlanVersionId);

    const editingPlan = await this.tx.editingPlan.findUniqueOrThrow({
      where: {
        id: editing.editingPlanId,
      },
    });

    invariant(editingPlan.status === 'READY', 'EDITING_PLAN_NOT_READY');

    const plan = EditingPlanSpecSchema.parse(editing.planSpecJson);

    const templateVersion = await this.tx.templateVersion.findUniqueOrThrow({
      where: {
        id: editing.templateVersionId,
      },
    });

    const template = TemplateRuntimeContractSchema.parse(templateVersion.capabilitiesJson);

    invariant(template.templateVersionId === editing.templateVersionId, 'TEMPLATE_CONTRACT_FAILED');

    const selectedAssetIds = plan.selectedAssets.map((asset) => asset.assetId);

    const inputAssetIds = [...new Set([...selectedAssetIds, ...template.assetDependencies])];

    const inputAssets = await this.tx.asset.findMany({
      where: {
        id: {
          in: inputAssetIds,
        },
      },
    });

    invariant(
      inputAssets.length === inputAssetIds.length &&
        inputAssets.every((asset) => asset.status === 'READY' && asset.deletedAt === null),
      'RENDER_INPUT_NOT_READY',
    );

    const templateLinks = await this.tx.templateVersionAsset.findMany({
      where: {
        templateVersionId: editing.templateVersionId,
        assetId: {
          in: template.assetDependencies,
        },
      },
      orderBy: [{ assetId: 'asc' }, { role: 'asc' }],
    });

    const dependencyLinksByAsset = new Map<string, (typeof templateLinks)[number]>();

    for (const link of templateLinks) {
      invariant(!dependencyLinksByAsset.has(link.assetId), 'TEMPLATE_ASSET_AMBIGUOUS');
      dependencyLinksByAsset.set(link.assetId, link);
    }

    invariant(
      dependencyLinksByAsset.size === template.assetDependencies.length &&
        template.assetDependencies.every((assetId) => dependencyLinksByAsset.has(assetId)),
      'TEMPLATE_ASSET_DEPENDENCY_MISSING',
    );

    const row = await this.tx.render.create({
      data: {
        editingPlanVersionId,
      },
    });

    const selectedInputs: Prisma.RenderInputAssetCreateManyInput[] = plan.selectedAssets.map(
      (asset, sequence) => ({
        renderId: row.id,
        assetId: asset.assetId,
        role: asset.role === 'PRESENTER' ? 'GREEN_SCREEN_VIDEO' : asset.role,
        sequence,
      }),
    );

    const templateInputs: Prisma.RenderInputAssetCreateManyInput[] = [...template.assetDependencies]
      .sort()
      .map((assetId, sequence) => ({
        renderId: row.id,
        assetId,
        role: 'TEMPLATE_ASSET',
        sequence,
        ...(dependencyLinksByAsset.get(assetId)!.slotKey !== null
          ? {
              slotKey: dependencyLinksByAsset.get(assetId)!.slotKey!,
            }
          : {}),
      }));

    if (selectedInputs.length + templateInputs.length > 0)
      await this.tx.renderInputAsset.createMany({
        data: [...selectedInputs, ...templateInputs],
      });

    await changed(this.tx, this.actor, 'Render.requested', 'Render', row.id);

    return row;
  }
  async createRenderAttempt(renderId: string, workerVersion: string) {
    invariant(workerVersion.trim().length > 0, 'WORKER_VERSION_REQUIRED');

    await lock(this.tx, 'Render', renderId);

    const render = await this.tx.render.findUniqueOrThrow({
      where: {
        id: renderId,
      },
      include: {
        editingPlanVersion: {
          include: {
            templateVersion: true,
          },
        },
      },
    });

    invariant(render.status === 'QUEUED', 'RENDER_NOT_QUEUEABLE');

    const activeAttempt = await this.tx.renderAttempt.findFirst({
      where: {
        renderId,
        status: {
          in: ['QUEUED', 'RUNNING'],
        },
      },
    });

    invariant(!activeAttempt, 'ACTIVE_RENDER_ATTEMPT_EXISTS');

    const latest = await this.tx.renderAttempt.aggregate({
      where: {
        renderId,
      },
      _max: {
        attemptNumber: true,
      },
    });

    const attempt = await this.tx.renderAttempt.create({
      data: {
        renderId,
        attemptNumber: (latest._max.attemptNumber ?? 0) + 1,
        workerVersion,
        rendererVersion: render.editingPlanVersion.templateVersion.rendererVersion,
      },
    });

    await changed(this.tx, this.actor, 'RenderAttempt.created', 'RenderAttempt', attempt.id);

    return attempt;
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
