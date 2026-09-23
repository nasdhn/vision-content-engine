import type * as AnalystDatabase from '@vision/database';
import type * as AnalystContracts from '@vision/contracts';
import type * as AnalystAI from '@vision/ai';
import type { ModelPolicy } from '@vision/ai';
import type { AnalystInput, AnalystOutput } from '@vision/contracts';
import { AnalystInputSchema, AnalystOutputSchema } from '@vision/contracts';
import type { Budget } from '@vision/database';

import type { EvidenceConfidence } from './learning-evidence.js';

const PHASE9C_FORBIDDEN_CAUSAL_ASSERTION =
  /(?:\b(?:cause(?:s|d|ing)?|led\s+to|leads?\s+to|result(?:ed|s)?\s+in|drove|drives|driven|responsible\s+for)\b|(?:caus(?:er|é|ée|és|ées)|provoqu(?:e|es|é|ée|és|ées|er|ant)|entra[iî]n(?:e|es|é|ée|és|ées|er|ant))(?=$|[^\p{L}\p{N}_]))/iu;

export const ANALYST_PROMPT = Object.freeze({
  key: 'analyst',
  version: '1.0.0',
} as const);

const CONFIDENCE_RANK: Record<EvidenceConfidence, number> = {
  INSUFFICIENT_DATA: 0,
  WEAK_SIGNAL: 1,
  INTERESTING_SIGNAL: 2,
  FAIRLY_SOLID: 3,
};

const CAUSAL_CLAIM_PATTERN =
  /\b(?:caus(?:e|ed|es|ing)|cause|causé|causée|causés|causées|provoque|provoqué|provoquée|entraîne|entraine|responsable de|due to|because of)\b/iu;

const UNIVERSAL_RULE_PATTERN =
  /\b(?:always|toujours|jamais|guarantee|guaranteed|garanti|garantie|garantit|systématiquement|systematiquement)\b/iu;

export type AnalystValidationContext = Readonly<{
  deterministicConfidenceCeiling: EvidenceConfidence;
  mandatoryLimitations: readonly string[];
  allowedPrimaryMetrics: readonly string[];
  allowedMeasurementWindows: readonly string[];
}>;

export type AnalystRuntimeRequest = Readonly<{
  requestId: string;
  purpose: string;
  knowledgeSnapshot: Readonly<{
    id: string;
    version: number;
    contentHash: string;
  }>;
  knowledgeContext: unknown;
  input: AnalystInput;
  validationContext: AnalystValidationContext;
  policy: ModelPolicy;
  budget: Budget;
  successCheckpointMetadata?: unknown;
}>;

type AnalystGateway = {
  generateStructured(
    request: AnalystAI.InvocationRequest<AnalystContracts.AnalystInput>,
    contracts: AnalystAI.Validation<AnalystContracts.AnalystInput, AnalystContracts.AnalystOutput>,
    inputPolicy: AnalystAI.ModelPolicy,
    budget: AnalystDatabase.Budget,
  ): Promise<{
    modelInvocationId: string;
    output: AnalystContracts.AnalystOutput;
    validation: {
      schema: 'PASS';
      references: 'PASS';
      businessRules: 'PASS';
      claims: 'PASS';
    };
    warnings: readonly string[];
  }>;
};

function fail(code: string): never {
  throw new Error(code);
}

function ensureUnique(values: readonly string[], code: string) {
  if (new Set(values).size !== values.length) fail(code);
}

function assertSubset(actual: readonly string[], allowed: ReadonlySet<string>, code: string) {
  for (const value of actual) if (!allowed.has(value)) fail(code);
}

function dimensionsFromInput(input: AnalystInput) {
  const patternVersionIds = new Set<string>();
  const editingProfileVersionIds = new Set<string>();
  const hookTypes = new Set<string>();
  const platforms = new Set<string>();

  for (const publication of input.publications) {
    platforms.add(publication.platform);
    const dimensions = publication.contentDimensions;
    if (dimensions.patternVersionId) patternVersionIds.add(dimensions.patternVersionId);
    if (dimensions.editingProfileVersionId) {
      editingProfileVersionIds.add(dimensions.editingProfileVersionId);
    }
    if (dimensions.hookType) hookTypes.add(dimensions.hookType);
  }

  return { patternVersionIds, editingProfileVersionIds, hookTypes, platforms };
}

export function validateAnalystOutput(
  input: AnalystInput,
  output: AnalystOutput,
  context: AnalystValidationContext,
): void {
  const allowedPublications = new Set(input.publications.map((item) => item.publicationId));
  const knownDimensions = dimensionsFromInput(input);
  const allowedMetrics = new Set(context.allowedPrimaryMetrics);
  const allowedWindows = new Set(context.allowedMeasurementWindows);

  for (const insight of output.insights) {
    // PHASE9C_CAUSAL_GUARD_V5: deterministic hard-validation guard.
    if (PHASE9C_FORBIDDEN_CAUSAL_ASSERTION.test(insight.statement)) {
      throw new Error('ANALYST_CAUSAL_CLAIM_FORBIDDEN');
    }

    ensureUnique(insight.evidencePublicationIds, 'ANALYST_DUPLICATE_EVIDENCE_ID');
    assertSubset(
      insight.evidencePublicationIds,
      allowedPublications,
      'ANALYST_UNKNOWN_EVIDENCE_PUBLICATION',
    );

    if (insight.confidence !== 'INSUFFICIENT_DATA' && insight.evidencePublicationIds.length === 0) {
      fail('ANALYST_EVIDENCE_REQUIRED');
    }

    if (
      CONFIDENCE_RANK[insight.confidence] > CONFIDENCE_RANK[context.deterministicConfidenceCeiling]
    ) {
      fail('ANALYST_CONFIDENCE_EXCEEDS_CEILING');
    }

    if (CAUSAL_CLAIM_PATTERN.test(insight.statement)) {
      fail('ANALYST_CAUSAL_CLAIM_FORBIDDEN');
    }
    if (UNIVERSAL_RULE_PATTERN.test(insight.statement)) {
      fail('ANALYST_UNIVERSAL_RULE_FORBIDDEN');
    }

    if (insight.dimensions.patternVersionIds) {
      ensureUnique(insight.dimensions.patternVersionIds, 'ANALYST_DUPLICATE_PATTERN_VERSION_ID');
      assertSubset(
        insight.dimensions.patternVersionIds,
        knownDimensions.patternVersionIds,
        'ANALYST_UNKNOWN_PATTERN_VERSION_ID',
      );
    }
    if (insight.dimensions.editingProfileVersionIds) {
      ensureUnique(
        insight.dimensions.editingProfileVersionIds,
        'ANALYST_DUPLICATE_EDITING_PROFILE_VERSION_ID',
      );
      assertSubset(
        insight.dimensions.editingProfileVersionIds,
        knownDimensions.editingProfileVersionIds,
        'ANALYST_UNKNOWN_EDITING_PROFILE_VERSION_ID',
      );
    }
    if (insight.dimensions.hookTypes) {
      ensureUnique(insight.dimensions.hookTypes, 'ANALYST_DUPLICATE_HOOK_TYPE');
      assertSubset(
        insight.dimensions.hookTypes,
        knownDimensions.hookTypes,
        'ANALYST_UNKNOWN_HOOK_TYPE',
      );
    }
    if (insight.dimensions.platforms) {
      ensureUnique(insight.dimensions.platforms, 'ANALYST_DUPLICATE_PLATFORM');
      assertSubset(
        insight.dimensions.platforms,
        knownDimensions.platforms,
        'ANALYST_UNKNOWN_PLATFORM',
      );
    }
  }

  for (const recommendation of output.recommendations) {
    if (!allowedMetrics.has(recommendation.nextTest.primaryMetric)) {
      fail('ANALYST_UNSUPPORTED_RECOMMENDATION_METRIC');
    }
    if (!allowedWindows.has(recommendation.nextTest.measurementWindow)) {
      fail('ANALYST_UNSUPPORTED_RECOMMENDATION_WINDOW');
    }
    if (UNIVERSAL_RULE_PATTERN.test(recommendation.description)) {
      fail('ANALYST_UNIVERSAL_RULE_FORBIDDEN');
    }
  }
}

export function mergeDeterministicAnalystLimitations(
  output: AnalystOutput,
  mandatoryLimitations: readonly string[],
): AnalystOutput {
  return {
    ...output,
    insights: output.insights.map((insight) => ({
      ...insight,
      limitations: [...new Set([...mandatoryLimitations, ...insight.limitations])],
    })),
  };
}

export class AnalystRuntime {
  constructor(private readonly gateway: AnalystGateway) {}

  async analyze(request: AnalystRuntimeRequest) {
    const input = AnalystInputSchema.parse(request.input);

    const response = await this.gateway.generateStructured(
      {
        requestId: request.requestId,
        capability: 'ANALYST',
        purpose: request.purpose,
        prompt: ANALYST_PROMPT,
        knowledgeSnapshot: request.knowledgeSnapshot,
        knowledgeContext: request.knowledgeContext,
        ...(request.successCheckpointMetadata === undefined
          ? {}
          : { successCheckpointMetadata: request.successCheckpointMetadata }),
        input,
      },
      {
        input: AnalystInputSchema,
        output: AnalystOutputSchema,
        validate: (validatedInput, output) =>
          validateAnalystOutput(validatedInput, output, request.validationContext),
      },
      request.policy,
      request.budget,
    );

    return {
      ...response,
      output: mergeDeterministicAnalystLimitations(
        response.output,
        request.validationContext.mandatoryLimitations,
      ),
    };
  }
}
