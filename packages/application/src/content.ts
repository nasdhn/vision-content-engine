import { readFile, readdir } from 'node:fs/promises';
import { z } from 'zod';
import {
  CreatorInputSchema,
  CreatorOutputSchema,
  CreativeDirectorInputSchema,
  CreativeDirectorOutputSchema,
  PatternVersionSpecSchema,
  JsonRecordSchema,
} from '@vision/contracts';
import { Persistence } from '@vision/database';
import type { PrismaClient, Budget, Prisma, Actor, UnitOfWork, Leases } from '@vision/database';
import type { AIProviderGateway } from '@vision/ai';
import type { ModelPolicy } from '@vision/ai';
import { validateCreator, validateDirector } from '@vision/ai';
import { invariant } from '@vision/domain';
import { assertNoSecrets, textHash, normalize } from '@vision/contracts/canonical';
import { selectPatterns } from './pattern-selector.js';
import type { SelectionContext, SelectionPolicy } from './pattern-selector.js';

type CreatorInput = z.infer<typeof CreatorInputSchema>;
type DirectorInput = z.infer<typeof CreativeDirectorInputSchema>;
export type CreatorOptions = {
  requestId: string;
  knowledgeSnapshotId: string;
  briefVersionId: string;
  ideaIds: string[];
  generationConstraints: CreatorInput['generationConstraints'];
  selection: SelectionContext;
  selectionPolicy: SelectionPolicy;
  duration: { minDurationSec: number; maxDurationSec: number };
};
export type DirectorOptions = {
  requestId: string;
  knowledgeSnapshotId: string;
  conceptVersionId: string;
  templateVersionIds: string[];
  editingProfileVersionIds: string[];
  captureScenarioVersionIds: string[];
  assetIds: string[];
  productionCapabilities: DirectorInput['productionCapabilities'];
  constraints: DirectorInput['constraints'];
};
export type JobExecution = { leases: Leases; jobId: string; leaseToken: string };
const aiActor = { actorType: 'AI', actorId: 'validated-ai-application' } as const;
const record = (value: unknown) => JsonRecordSchema.parse(value ?? {});
// Curated BriefVersion metadata, never a model-provided exemption. Exact duplicate hooks still fail.
const VariantSchema = z
  .object({
    conceptVersionId: z.string().uuid(),
    keepConstant: z.array(z.string().trim().min(1)).min(1),
    change: z.array(z.string().trim().min(1)).min(1),
    reason: z.string().trim().min(1),
  })
  .strict();

export class AIContentService {
  private readonly persistence: Persistence;
  constructor(
    private readonly db: PrismaClient,
    private readonly gateway: AIProviderGateway,
  ) {
    this.persistence = new Persistence(db);
  }
  private async commit<T>(
    work: (unit: UnitOfWork) => Promise<T>,
    execution?: JobExecution,
  ): Promise<T> {
    if (!execution) return this.persistence.transaction(aiActor, work);
    let result: T | undefined;
    await execution.leases.finishJob(
      execution.jobId,
      execution.leaseToken,
      'SUCCEEDED',
      undefined,
      async (unit) => {
        result = await work(unit);
      },
    );
    return result as T;
  }
  async seedPatterns(actor: Actor) {
    const dir = new URL('../pattern-seeds/', import.meta.url);
    const files = (await readdir(dir)).filter((f) => f.endsWith('.json')).sort();
    const specs: unknown[] = await Promise.all(
      files.map(async (file) => JSON.parse(await readFile(new URL(file, dir), 'utf8')) as unknown),
    );
    return this.persistence.transaction(actor, async (u) => {
      const mappings = [];
      for (const spec of specs) mappings.push(await u.patterns.importSeed(spec));
      return mappings;
    });
  }
  private knowledge(id: string) {
    return this.persistence.transaction(aiActor, (u) => u.knowledge.snapshot(id));
  }
  private async now() {
    const [row] = await this.db.$queryRaw<
      { now: Date }[]
    >`SELECT clock_timestamp()::timestamptz(3) AS now`;
    invariant(row, 'DATABASE_CLOCK_UNAVAILABLE');
    return row.now;
  }
  private async sourcesExist(knowledge: CreatorInput['brandKnowledge']) {
    const ids = [
      ...new Set(
        [...knowledge.claims.verified, ...knowledge.commercial.pricingClaims].flatMap(
          (c) => c.sourceIds,
        ),
      ),
    ];
    invariant(
      (await this.db.sourceReference.count({ where: { id: { in: ids } } })) === ids.length,
      'SOURCE_REFERENCE_NOT_FOUND',
    );
  }
  async creatorContext(options: CreatorOptions) {
    assertNoSecrets(options);
    invariant(
      options.duration.minDurationSec >= 0 &&
        options.duration.maxDurationSec > options.duration.minDurationSec,
      'INVALID_DURATION_POLICY',
    );
    const brief = await this.db.briefVersion.findUniqueOrThrow({
      where: { id: options.briefVersionId },
    });
    const knowledge = await this.knowledge(options.knowledgeSnapshotId);
    const variantData = record(brief.payloadJson).deliberateVariant;
    const deliberateVariant =
      variantData === undefined ? undefined : VariantSchema.parse(variantData);
    if (deliberateVariant)
      await this.db.conceptVersion.findUniqueOrThrow({
        where: { id: deliberateVariant.conceptVersionId },
      });
    const ideas = await this.db.idea.findMany({
      where: {
        id: { in: options.ideaIds },
        status: 'ACTIVE',
        OR: [{ briefId: brief.briefId }, { briefId: null }],
      },
      orderBy: { id: 'asc' },
    });
    invariant(ideas.length === new Set(options.ideaIds).size, 'UNKNOWN_IDEA');
    const roots = await this.db.pattern.findMany({
      where: { status: 'ACTIVE' },
      include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
      orderBy: { key: 'asc' },
    });
    const definitions = roots.flatMap((root) =>
      root.versions.map((v) => ({
        id: v.id,
        status: root.status,
        spec: PatternVersionSpecSchema.parse(record(v.sourceMetadataJson).artifact),
      })),
    );
    const recent = await this.db.conceptVersion.findMany({
      take: 100,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    const published = await this.db.publication.findMany({
      where: {
        status: 'PUBLISHED',
        render: {
          editingPlanVersion: {
            creativePlanVersion: {
              scriptVersion: { conceptVersionId: { in: recent.map((v) => v.id) } },
            },
          },
        },
      },
      select: {
        id: true,
        platformAccount: { select: { platform: true } },
        render: {
          select: {
            editingPlanVersion: {
              select: {
                creativePlanVersion: {
                  select: { scriptVersion: { select: { conceptVersionId: true } } },
                },
              },
            },
          },
        },
      },
      orderBy: { id: 'asc' },
    });
    const usage = recent.flatMap((v) => {
      if (!v.rationale || !v.selectedPatternVersionId) return [];
      let metadata: unknown;
      try {
        metadata = JSON.parse(v.rationale);
      } catch {
        return [];
      }
      const parsed = z
        .object({
          selectionDimensions: z.object({
            audience: z.string(),
            topic: z.string(),
            angle: z.string(),
            hookShape: z.string(),
            proofType: z.string(),
            primaryFormat: z.string(),
            platforms: z.array(z.string()),
          }),
        })
        .safeParse(metadata);
      return parsed.success
        ? parsed.data.selectionDimensions.platforms.map((platform) => ({
            ...parsed.data.selectionDimensions,
            patternVersionId: v.selectedPatternVersionId!,
            platform,
          }))
        : [];
    });
    const selection = selectPatterns(
      definitions,
      {
        ...options.selection,
        recent: [...usage, ...options.selection.recent],
        formats: options.generationConstraints.allowedPrimaryFormats,
        platforms: options.generationConstraints.targetPlatforms,
      },
      { ...options.selectionPolicy, mode: options.generationConstraints.explorationPolicy.mode },
    );
    invariant(selection.candidates.length > 0, 'NO_ELIGIBLE_PATTERNS');
    const versions = roots.flatMap((r) => r.versions.map((v) => ({ ...v, name: r.name })));
    const input = CreatorInputSchema.parse({
      briefVersion: { id: brief.id, payload: record(brief.payloadJson) },
      ideas: ideas.map((i) => ({
        id: i.id,
        title: i.title,
        ...(i.description ? { description: i.description } : {}),
      })),
      patternCandidates: selection.candidates.map((c) => {
        const p = versions.find((v) => v.id === c.patternVersionId)!;
        return {
          patternVersionId: p.id,
          name: p.name,
          description: p.description,
          whenToUse: p.whenToUse,
          hookStructure: record(p.hookStructureJson),
          storyStructure: record(p.storyStructureJson),
          visualStructure: record(p.visualStructureJson),
          ctaStyle: record(p.ctaStyleJson),
        };
      }),
      brandKnowledge: knowledge,
      contentMemory: recent.map((v) => ({
        conceptVersionId: v.id,
        publicationIds: published
          .filter(
            (p) =>
              p.render.editingPlanVersion.creativePlanVersion.scriptVersion.conceptVersionId ===
              v.id,
          )
          .map((p) => p.id),
        topic: v.title,
        angle: v.angle ?? v.title,
        ...(v.selectedPatternVersionId ? { patternVersionId: v.selectedPatternVersionId } : {}),
        platforms: [
          ...new Set(
            published
              .filter(
                (p) =>
                  p.render.editingPlanVersion.creativePlanVersion.scriptVersion.conceptVersionId ===
                  v.id,
              )
              .map((p) => p.platformAccount.platform),
          ),
        ],
      })),
      generationConstraints: options.generationConstraints,
    });
    await this.sourcesExist(knowledge);
    return {
      input,
      briefId: brief.briefId,
      selection,
      recentHooks: recent.flatMap((r) => (r.hook ? [r.hook] : [])),
      deliberateVariant,
      patternDefinitions: definitions,
    };
  }
  async createConcepts(
    options: CreatorOptions,
    policy: ModelPolicy,
    budget: Budget,
    execution?: JobExecution,
  ) {
    if (execution) await execution.leases.heartbeatJob(execution.jobId, execution.leaseToken);
    const context = await this.creatorContext(options);
    const result = await this.gateway.generateStructured(
      {
        requestId: options.requestId,
        capability: 'CREATOR',
        purpose: 'creator.concepts',
        prompt: { key: 'creator', version: '1.0.0' },
        knowledgeSnapshot: context.input.brandKnowledge,
        input: context.input,
      },
      {
        input: CreatorInputSchema,
        output: CreatorOutputSchema,
        validate: async (input, output) => {
          await this.sourcesExist(input.brandKnowledge);
          validateCreator(input, output, {
            ...options.duration,
            recentHooks: context.recentHooks,
            now: await this.now(),
            ...(context.deliberateVariant ? { deliberateVariant: context.deliberateVariant } : {}),
          });
          for (const concept of output.concepts)
            invariant(
              context.patternDefinitions
                .find((p) => p.id === concept.selectedPatternVersionId)!
                .spec.adaptation.compatiblePrimaryFormats.includes(
                  concept.formatRecommendation.primaryFormat,
                ),
              'PATTERN_FORMAT_INCOMPATIBLE',
            );
        },
      },
      policy,
      budget,
    );
    const versions = await this.commit(async (u) => {
      await u.consumeInvocation(result.modelInvocationId, result.output);
      await u.rejectRepeatedHooks(result.output.concepts.map((c) => c.hook));
      const saved = [];
      for (const candidate of result.output.concepts) {
        const concept = await u.createConcept(context.briefId);
        if (candidate.ideaId) await u.linkConceptIdea(concept.id, candidate.ideaId);
        const version = await u.versions.conceptVersion({
          conceptId: concept.id,
          briefVersionId: options.briefVersionId,
          title: candidate.title,
          angle: candidate.angle,
          hook: candidate.hook,
          audience: candidate.audience,
          objective: candidate.objective,
          hypothesis: candidate.hypothesis,
          selectedPatternVersionId: candidate.selectedPatternVersionId,
          rationale: JSON.stringify({
            ...candidate.rationale,
            formatRecommendation: candidate.formatRecommendation,
            ...(context.deliberateVariant ? { deliberateVariant: context.deliberateVariant } : {}),
            selectionDimensions: {
              audience: candidate.audience,
              topic: options.selection.topic,
              angle: candidate.angle,
              hookShape:
                context.input.patternCandidates.find(
                  (p) => p.patternVersionId === candidate.selectedPatternVersionId,
                )!.hookStructure.shape ?? '',
              proofType: options.selection.proofType,
              primaryFormat: candidate.formatRecommendation.primaryFormat,
              platforms: context.input.generationConstraints.targetPlatforms,
            },
          }),
          creatorType: 'AI',
          creatorModelInvocationId: result.modelInvocationId,
        });
        await u.preserveClaimEvidence(
          'Concept',
          concept.id,
          version.id,
          candidate.factualClaims,
          options.knowledgeSnapshotId,
          result.modelInvocationId,
        );
        await u.submitConcept(version.id);
        saved.push(version);
      }
      return saved;
    }, execution);
    return { ...result, versions, selection: context.selection };
  }
  async directorContext(options: DirectorOptions) {
    const version = await this.db.conceptVersion.findUniqueOrThrow({
      where: { id: options.conceptVersionId },
      include: { concept: true, selectedPatternVersion: { include: { pattern: true } } },
    });
    const approval = await this.db.approval.findFirst({
      where: { conceptVersionId: version.id, subjectType: 'CONCEPT', actorType: 'USER' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    invariant(
      approval?.decision === 'APPROVED' &&
        approval.actorId &&
        version.concept.status !== 'ARCHIVED',
      'CONCEPT_APPROVAL_REQUIRED',
    );
    const knowledge = await this.knowledge(options.knowledgeSnapshotId);
    const templates = await this.db.templateVersion.findMany({
      where: { id: { in: options.templateVersionIds }, template: { status: 'ACTIVE' } },
      include: { template: true },
    });
    const profiles = await this.db.editingProfileVersion.findMany({
      where: { id: { in: options.editingProfileVersionIds }, editingProfile: { status: 'ACTIVE' } },
      include: { editingProfile: true },
    });
    const scenarios = await this.db.captureScenarioVersion.findMany({
      where: {
        id: { in: options.captureScenarioVersionIds },
        captureScenario: { status: 'ACTIVE' },
      },
      include: { captureScenario: true },
    });
    const assets = await this.db.asset.findMany({
      where: { id: { in: options.assetIds }, status: 'READY', deletedAt: null },
    });
    invariant(
      templates.length > 0 &&
        templates.length === new Set(options.templateVersionIds).size &&
        profiles.length > 0 &&
        profiles.length === new Set(options.editingProfileVersionIds).size &&
        scenarios.length === new Set(options.captureScenarioVersionIds).size &&
        assets.length === new Set(options.assetIds).size,
      'PRODUCTION_CANDIDATE_UNAVAILABLE',
    );
    const pattern = version.selectedPatternVersion;
    invariant(
      options.constraints.maxDurationSec > options.constraints.minDurationSec,
      'INVALID_DURATION_POLICY',
    );
    const input = CreativeDirectorInputSchema.parse({
      conceptVersion: {
        id: version.id,
        conceptId: version.conceptId,
        version: version.version,
        title: version.title,
        angle: version.angle,
        hook: version.hook,
        audience: version.audience,
        objective: version.objective,
        hypothesis: version.hypothesis,
        selectedPatternVersionId: version.selectedPatternVersionId,
      },
      ...(pattern
        ? {
            patternVersion: {
              id: pattern.id,
              patternId: pattern.patternId,
              version: pattern.version,
              key: pattern.pattern.key,
              name: pattern.pattern.name,
              category: pattern.pattern.category,
              description: pattern.description,
              whenToUse: pattern.whenToUse,
              hookStructure: record(pattern.hookStructureJson),
              storyStructure: record(pattern.storyStructureJson),
              visualStructure: record(pattern.visualStructureJson),
              ctaStyle: record(pattern.ctaStyleJson),
              constraints: record(pattern.constraintsJson),
            },
          }
        : {}),
      brandKnowledge: knowledge,
      templateCandidates: templates.map((v) => ({
        templateVersionId: v.id,
        templateKey: v.template.key,
        capabilities: record(v.capabilitiesJson),
        inputSchemaSummary: record(v.inputSchemaJson),
      })),
      editingProfileCandidates: profiles.map((v) => ({
        editingProfileVersionId: v.id,
        editingProfileKey: v.editingProfile.key,
        capabilities: [
          'pacing',
          'cut',
          'caption',
          'focus',
          'motion',
          'sound',
          'hook',
          'ending',
          'greenScreen',
        ].filter((key) => v[`${key}RulesJson` as keyof typeof v] !== null),
      })),
      captureScenarioCandidates: scenarios.map((v) => ({
        captureScenarioVersionId: v.id,
        scenarioKey: v.captureScenario.key,
        inputSchemaSummary: record(v.inputSchemaJson),
        outputCapabilities: z
          .array(z.object({ role: z.enum(['SCREENSHOT', 'VIDEO', 'FRAME']) }))
          .parse(v.outputSpecJson ?? [])
          .map((o) => o.role),
      })),
      availableAssets: assets.map((a) => ({
        assetId: a.id,
        kind: a.kind,
        source: a.sourceType,
        ...(a.durationMs !== null ? { durationMs: a.durationMs } : {}),
        ...(a.width !== null ? { width: a.width } : {}),
        ...(a.height !== null ? { height: a.height } : {}),
      })),
      productionCapabilities: options.productionCapabilities,
      constraints: options.constraints,
    });
    await this.sourcesExist(knowledge);
    const recentScripts = await this.db.scriptVersion.findMany({
      take: 100,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { fullText: true, conceptVersionId: true },
    });
    let deliberateVariant: z.infer<typeof VariantSchema> | undefined;
    try {
      const parsed = VariantSchema.safeParse(
        record(JSON.parse(version.rationale ?? '{}')).deliberateVariant,
      );
      if (parsed.success) deliberateVariant = parsed.data;
    } catch {
      /* Human-authored rationale is plain text. */
    }
    return { input, templates, recentScripts, deliberateVariant };
  }
  async createCreativePlan(
    options: DirectorOptions,
    policy: ModelPolicy,
    budget: Budget,
    execution?: JobExecution,
  ) {
    if (execution) await execution.leases.heartbeatJob(execution.jobId, execution.leaseToken);
    const context = await this.directorContext(options);
    const result = await this.gateway.generateStructured(
      {
        requestId: options.requestId,
        capability: 'CREATIVE_DIRECTOR',
        purpose: 'creative-director.plan',
        prompt: { key: 'creative-director', version: '1.0.0' },
        knowledgeSnapshot: context.input.brandKnowledge,
        input: context.input,
      },
      {
        input: CreativeDirectorInputSchema,
        output: CreativeDirectorOutputSchema,
        validate: async (input, output) => {
          validateDirector(input, output, await this.now());
          invariant(
            !context.recentScripts.some(
              (s) =>
                s.conceptVersionId !== context.deliberateVariant?.conceptVersionId &&
                textHash(normalize(s.fullText)) === textHash(normalize(output.script.fullText)),
            ),
            'DUPLICATE_SCRIPT',
          );
          await this.sourcesExist(input.brandKnowledge);
          const template = context.templates.find(
            (t) => t.id === output.creativePlan.templateVersionId,
          )!;
          const ms = Math.round(output.creativePlan.targetDurationSec * 1000);
          invariant(
            (template.minDurationMs === null || ms >= template.minDurationMs) &&
              (template.maxDurationMs === null || ms <= template.maxDurationMs),
            'TEMPLATE_DURATION_INCOMPATIBLE',
          );
          invariant(
            template.supportedAspectRatiosJson === null ||
              z
                .array(z.string())
                .parse(template.supportedAspectRatiosJson)
                .includes(input.constraints.targetAspectRatio),
            'TEMPLATE_ASPECT_RATIO_INCOMPATIBLE',
          );
        },
      },
      policy,
      budget,
    );
    return this.commit(async (u) => {
      await u.consumeInvocation(result.modelInvocationId, result.output);
      const roots = await u.productionRoots(options.conceptVersionId);
      const script = result.output.script;
      await u.rejectRepeatedScript(script.fullText, context.deliberateVariant?.conceptVersionId);
      const plan = result.output.creativePlan;
      const sv = await u.versions.scriptVersion({
        scriptId: roots.script.id,
        conceptVersionId: options.conceptVersionId,
        language: script.language,
        fullText: script.fullText,
        segmentsJson: script.segments,
        estimatedDurationMs: Math.round(script.estimatedDurationSec * 1000),
        voiceMode: script.voiceMode,
        createdByType: 'AI',
        modelInvocationId: result.modelInvocationId,
      });
      const cpv = await u.versions.creativePlanVersion({
        creativePlanId: roots.plan.id,
        scriptVersionId: sv.id,
        targetDurationMs: Math.round(plan.targetDurationSec * 1000),
        primaryFormat: plan.primaryFormat,
        templateVersionId: plan.templateVersionId,
        editingProfileVersionId: plan.editingProfileVersionId,
        scenePlanJson: plan.scenes,
        requiredRecordingsJson: plan.recordingRequests,
        requiredCapturesJson: plan.captureRequests as Prisma.InputJsonValue,
        requiredAssetsJson: plan.requiredExistingAssetIds,
        ctaJson: plan.cta,
        platformConsiderationsJson: plan.platformConsiderations,
        modelInvocationId: result.modelInvocationId,
      });
      await u.preserveClaimEvidence(
        'CreativePlan',
        roots.plan.id,
        cpv.id,
        result.output.factualClaims,
        options.knowledgeSnapshotId,
        result.modelInvocationId,
      );
      await u.markProductionReady(roots.script.id, roots.plan.id);
      return { ...result, scriptVersion: sv, creativePlanVersion: cpv };
    }, execution);
  }
}
