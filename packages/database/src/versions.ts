import { assertSameLineage, invariant } from '@vision/domain';
import type { Prisma } from './generated/prisma/client.js';
import { changed, lock } from './transaction.js';
import type { Transaction, Actor } from './transaction.js';
import { validateScript, validateCreative, validateEditing } from './lineage.js';
import { pendingConceptSelection } from './concept-selection.js';

/** Append-only API: no update, delete, upsert or nested relation mutation. */
export class Versions {
  constructor(
    private readonly tx: Transaction,
    private readonly actor: Actor,
  ) {}
  async briefVersion(
    data: Pick<Prisma.BriefVersionUncheckedCreateInput, 'briefId' | 'payloadJson' | 'createdBy'>,
  ) {
    invariant(
      Object.keys(data).every((key) => ['briefId', 'payloadJson', 'createdBy'].includes(key)),
      'IMMUTABLE_VERSION_INPUT',
    );
    await lock(this.tx, 'Brief', data.briefId);
    const latest = await this.tx.briefVersion.aggregate({
      where: { briefId: data.briefId },
      _max: { version: true },
    });
    const result = await this.tx.briefVersion.create({
      data: { ...data, version: (latest._max.version ?? 0) + 1 },
    });
    await changed(this.tx, this.actor, 'BriefVersion.created', 'Brief', data.briefId, result.id);
    return result;
  }
  async conceptVersion(
    data: Pick<
      Prisma.ConceptVersionUncheckedCreateInput,
      | 'conceptId'
      | 'briefVersionId'
      | 'title'
      | 'angle'
      | 'hook'
      | 'audience'
      | 'objective'
      | 'hypothesis'
      | 'selectedPatternVersionId'
      | 'rationale'
      | 'creatorType'
      | 'creatorModelInvocationId'
    >,
  ) {
    invariant(
      Object.keys(data).every((key) =>
        [
          'conceptId',
          'briefVersionId',
          'title',
          'angle',
          'hook',
          'audience',
          'objective',
          'hypothesis',
          'selectedPatternVersionId',
          'rationale',
          'creatorType',
          'creatorModelInvocationId',
        ].includes(key),
      ),
      'IMMUTABLE_VERSION_INPUT',
    );
    await lock(this.tx, 'Concept', data.conceptId);
    const concept = await this.tx.concept.findUniqueOrThrow({ where: { id: data.conceptId } });
    invariant(concept.status !== 'ARCHIVED', 'INVALID_TRANSITION');
    const brief = await this.tx.briefVersion.findUniqueOrThrow({
      where: { id: data.briefVersionId },
    });
    assertSameLineage(concept.briefId, brief.briefId);
    // A deliberate selection pins its own review subject; a new version cannot replace it.
    if (!(await pendingConceptSelection(this.tx, concept.id))) {
      await this.tx.concept.update({ where: { id: concept.id }, data: { status: 'DRAFT' } });
    }
    const latest = await this.tx.conceptVersion.aggregate({
      where: { conceptId: data.conceptId },
      _max: { version: true },
    });
    const result = await this.tx.conceptVersion.create({
      data: { ...data, version: (latest._max.version ?? 0) + 1 },
    });
    await changed(
      this.tx,
      this.actor,
      'ConceptVersion.created',
      'Concept',
      data.conceptId,
      result.id,
    );
    return result;
  }
  async scriptVersion(
    data: Pick<
      Prisma.ScriptVersionUncheckedCreateInput,
      | 'scriptId'
      | 'conceptVersionId'
      | 'language'
      | 'fullText'
      | 'segmentsJson'
      | 'estimatedDurationMs'
      | 'voiceMode'
      | 'createdByType'
      | 'modelInvocationId'
    >,
  ) {
    invariant(
      Object.keys(data).every((key) =>
        [
          'scriptId',
          'conceptVersionId',
          'language',
          'fullText',
          'segmentsJson',
          'estimatedDurationMs',
          'voiceMode',
          'createdByType',
          'modelInvocationId',
        ].includes(key),
      ),
      'IMMUTABLE_VERSION_INPUT',
    );
    await lock(this.tx, 'Script', data.scriptId);
    await validateScript(this.tx, data.scriptId, data.conceptVersionId);
    const latest = await this.tx.scriptVersion.aggregate({
      where: { scriptId: data.scriptId },
      _max: { version: true },
    });
    const result = await this.tx.scriptVersion.create({
      data: { ...data, version: (latest._max.version ?? 0) + 1 },
    });
    await changed(this.tx, this.actor, 'ScriptVersion.created', 'Script', data.scriptId, result.id);
    return result;
  }
  async creativePlanVersion(
    data: Pick<
      Prisma.CreativePlanVersionUncheckedCreateInput,
      | 'creativePlanId'
      | 'scriptVersionId'
      | 'targetDurationMs'
      | 'primaryFormat'
      | 'templateVersionId'
      | 'editingProfileVersionId'
      | 'scenePlanJson'
      | 'requiredRecordingsJson'
      | 'requiredCapturesJson'
      | 'requiredAssetsJson'
      | 'ctaJson'
      | 'platformConsiderationsJson'
      | 'modelInvocationId'
    >,
  ) {
    invariant(
      Object.keys(data).every((key) =>
        [
          'creativePlanId',
          'scriptVersionId',
          'targetDurationMs',
          'primaryFormat',
          'templateVersionId',
          'editingProfileVersionId',
          'scenePlanJson',
          'requiredRecordingsJson',
          'requiredCapturesJson',
          'requiredAssetsJson',
          'ctaJson',
          'platformConsiderationsJson',
          'modelInvocationId',
        ].includes(key),
      ),
      'IMMUTABLE_VERSION_INPUT',
    );
    await lock(this.tx, 'CreativePlan', data.creativePlanId);
    await validateCreative(this.tx, data.creativePlanId, data.scriptVersionId);
    const latest = await this.tx.creativePlanVersion.aggregate({
      where: { creativePlanId: data.creativePlanId },
      _max: { version: true },
    });
    const result = await this.tx.creativePlanVersion.create({
      data: { ...data, version: (latest._max.version ?? 0) + 1 },
    });
    await changed(
      this.tx,
      this.actor,
      'CreativePlanVersion.created',
      'CreativePlan',
      data.creativePlanId,
      result.id,
    );
    return result;
  }
  async editingPlanVersion(
    data: Pick<
      Prisma.EditingPlanVersionUncheckedCreateInput,
      | 'editingPlanId'
      | 'creativePlanVersionId'
      | 'editingProfileVersionId'
      | 'templateVersionId'
      | 'planSpecJson'
      | 'timelineJson'
      | 'captionPlanJson'
      | 'audioPlanJson'
      | 'visualFocusJson'
      | 'transitionPlanJson'
      | 'greenScreenPlanJson'
      | 'renderSettingsJson'
      | 'modelInvocationId'
    >,
  ) {
    invariant(
      Object.keys(data).every((key) =>
        [
          'editingPlanId',
          'creativePlanVersionId',
          'editingProfileVersionId',
          'templateVersionId',
          'planSpecJson',
          'timelineJson',
          'captionPlanJson',
          'audioPlanJson',
          'visualFocusJson',
          'transitionPlanJson',
          'greenScreenPlanJson',
          'renderSettingsJson',
          'modelInvocationId',
        ].includes(key),
      ),
      'IMMUTABLE_VERSION_INPUT',
    );
    await lock(this.tx, 'EditingPlan', data.editingPlanId);
    await validateEditing(this.tx, data);
    const latest = await this.tx.editingPlanVersion.aggregate({
      where: { editingPlanId: data.editingPlanId },
      _max: { version: true },
    });
    const result = await this.tx.editingPlanVersion.create({
      data: { ...data, version: (latest._max.version ?? 0) + 1 },
    });
    await changed(
      this.tx,
      this.actor,
      'EditingPlanVersion.created',
      'EditingPlan',
      data.editingPlanId,
      result.id,
    );
    return result;
  }
  async patternVersion(
    data: Pick<
      Prisma.PatternVersionUncheckedCreateInput,
      | 'patternId'
      | 'description'
      | 'whenToUse'
      | 'audienceFitJson'
      | 'hookStructureJson'
      | 'storyStructureJson'
      | 'visualStructureJson'
      | 'ctaStyleJson'
      | 'constraintsJson'
      | 'knownRisksJson'
      | 'examplesJson'
      | 'sourceType'
      | 'sourceMetadataJson'
      | 'confidence'
      | 'createdBy'
    >,
  ) {
    invariant(
      Object.keys(data).every((key) =>
        [
          'patternId',
          'description',
          'whenToUse',
          'audienceFitJson',
          'hookStructureJson',
          'storyStructureJson',
          'visualStructureJson',
          'ctaStyleJson',
          'constraintsJson',
          'knownRisksJson',
          'examplesJson',
          'sourceType',
          'sourceMetadataJson',
          'confidence',
          'createdBy',
        ].includes(key),
      ),
      'IMMUTABLE_VERSION_INPUT',
    );
    await lock(this.tx, 'Pattern', data.patternId);
    const latest = await this.tx.patternVersion.aggregate({
      where: { patternId: data.patternId },
      _max: { version: true },
    });
    const result = await this.tx.patternVersion.create({
      data: { ...data, version: (latest._max.version ?? 0) + 1 },
    });
    await changed(
      this.tx,
      this.actor,
      'PatternVersion.created',
      'Pattern',
      data.patternId,
      result.id,
    );
    return result;
  }
  async templateVersion(
    data: Pick<
      Prisma.TemplateVersionUncheckedCreateInput,
      | 'id'
      | 'templateId'
      | 'inputSchemaJson'
      | 'supportedAspectRatiosJson'
      | 'minDurationMs'
      | 'maxDurationMs'
      | 'requiredSlotsJson'
      | 'optionalSlotsJson'
      | 'capabilitiesJson'
      | 'rendererVersion'
      | 'sourceRevision'
    >,
  ) {
    invariant(
      Object.keys(data).every((key) =>
        [
          'id',
          'templateId',
          'inputSchemaJson',
          'supportedAspectRatiosJson',
          'minDurationMs',
          'maxDurationMs',
          'requiredSlotsJson',
          'optionalSlotsJson',
          'capabilitiesJson',
          'rendererVersion',
          'sourceRevision',
        ].includes(key),
      ),
      'IMMUTABLE_VERSION_INPUT',
    );
    await lock(this.tx, 'Template', data.templateId);
    const latest = await this.tx.templateVersion.aggregate({
      where: { templateId: data.templateId },
      _max: { version: true },
    });
    const result = await this.tx.templateVersion.create({
      data: { ...data, version: (latest._max.version ?? 0) + 1 },
    });
    await changed(
      this.tx,
      this.actor,
      'TemplateVersion.created',
      'Template',
      data.templateId,
      result.id,
    );
    return result;
  }
  async editingProfileVersion(
    data: Pick<
      Prisma.EditingProfileVersionUncheckedCreateInput,
      | 'id'
      | 'editingProfileId'
      | 'pacingRulesJson'
      | 'cutRulesJson'
      | 'captionRulesJson'
      | 'focusRulesJson'
      | 'motionRulesJson'
      | 'soundRulesJson'
      | 'hookRulesJson'
      | 'endingRulesJson'
      | 'greenScreenRulesJson'
    >,
  ) {
    invariant(
      Object.keys(data).every((key) =>
        [
          'id',
          'editingProfileId',
          'pacingRulesJson',
          'cutRulesJson',
          'captionRulesJson',
          'focusRulesJson',
          'motionRulesJson',
          'soundRulesJson',
          'hookRulesJson',
          'endingRulesJson',
          'greenScreenRulesJson',
        ].includes(key),
      ),
      'IMMUTABLE_VERSION_INPUT',
    );
    await lock(this.tx, 'EditingProfile', data.editingProfileId);
    const latest = await this.tx.editingProfileVersion.aggregate({
      where: { editingProfileId: data.editingProfileId },
      _max: { version: true },
    });
    const result = await this.tx.editingProfileVersion.create({
      data: { ...data, version: (latest._max.version ?? 0) + 1 },
    });
    await changed(
      this.tx,
      this.actor,
      'EditingProfileVersion.created',
      'EditingProfile',
      data.editingProfileId,
      result.id,
    );
    return result;
  }
  async captureScenarioVersion(
    data: Pick<
      Prisma.CaptureScenarioVersionUncheckedCreateInput,
      | 'captureScenarioId'
      | 'targetEnvironment'
      | 'stepsJson'
      | 'inputSchemaJson'
      | 'outputSpecJson'
      | 'browserConfigJson'
      | 'createdBy'
    >,
  ) {
    invariant(
      Object.keys(data).every((key) =>
        [
          'captureScenarioId',
          'targetEnvironment',
          'stepsJson',
          'inputSchemaJson',
          'outputSpecJson',
          'browserConfigJson',
          'createdBy',
        ].includes(key),
      ),
      'IMMUTABLE_VERSION_INPUT',
    );
    await lock(this.tx, 'CaptureScenario', data.captureScenarioId);
    const latest = await this.tx.captureScenarioVersion.aggregate({
      where: { captureScenarioId: data.captureScenarioId },
      _max: { version: true },
    });
    const result = await this.tx.captureScenarioVersion.create({
      data: { ...data, version: (latest._max.version ?? 0) + 1 },
    });
    await changed(
      this.tx,
      this.actor,
      'CaptureScenarioVersion.created',
      'CaptureScenario',
      data.captureScenarioId,
      result.id,
    );
    return result;
  }
}
