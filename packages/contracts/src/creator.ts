import { z } from 'zod';
import {
  BrandKnowledgeSnapshotSchema,
  ContentMemoryItemSchema,
  JsonRecordSchema,
  PlatformSchema,
  PrimaryFormatSchema,
  ProposedClaimSchema,
  UuidSchema,
} from './shared.js';

export const CreatorInputSchema = z
  .object({
    briefVersion: z
      .object({
        id: UuidSchema,
        payload: JsonRecordSchema,
      })
      .strict(),

    ideas: z.array(
      z
        .object({
          id: UuidSchema,
          title: z.string().min(1),
          description: z.string().optional(),
        })
        .strict(),
    ),

    patternCandidates: z.array(
      z
        .object({
          patternVersionId: UuidSchema,
          name: z.string().min(1),
          description: z.string().min(1),
          whenToUse: z.string().min(1),
          hookStructure: JsonRecordSchema,
          storyStructure: JsonRecordSchema,
          visualStructure: JsonRecordSchema,
          ctaStyle: JsonRecordSchema,
        })
        .strict(),
    ),

    brandKnowledge: BrandKnowledgeSnapshotSchema,
    contentMemory: z.array(ContentMemoryItemSchema),

    generationConstraints: z
      .object({
        requestedConceptCount: z.number().int().positive(),
        targetPlatforms: z.array(PlatformSchema).min(1),
        allowedPrimaryFormats: z.array(PrimaryFormatSchema).min(1),
        diversity: z
          .object({
            maxSamePatternCount: z.number().int().positive().optional(),
            maxSameAngleCount: z.number().int().positive().optional(),
            avoidRecentSemanticSimilarityAbove: z.number().min(0).max(1).optional(),
          })
          .strict(),
        explorationPolicy: z
          .object({
            mode: z.enum(['EXPLORE', 'BALANCED', 'EXPLOIT']),
            notes: z.string().optional(),
          })
          .strict(),
      })
      .strict(),
  })
  .strict();

export const CreatorOutputSchema = z
  .object({
    concepts: z.array(
      z
        .object({
          clientKey: z.string().min(1),
          ideaId: UuidSchema.optional(),
          title: z.string().min(1),
          angle: z.string().min(1),
          hook: z.string().min(1),
          audience: z.string().min(1),
          objective: z.string().min(1),
          hypothesis: z.string().min(1),
          selectedPatternVersionId: UuidSchema,
          rationale: z
            .object({
              whyThisPattern: z.string().min(1),
              whyThisAngle: z.string().min(1),
              whyThisCouldFitVision: z.string().min(1),
              differentiationFromRecentContent: z.string().min(1),
            })
            .strict(),
          formatRecommendation: z
            .object({
              primaryFormat: PrimaryFormatSchema,
              targetDurationSec: z.number().positive(),
            })
            .strict(),
          factualClaims: z.array(ProposedClaimSchema),
        })
        .strict(),
    ),
  })
  .strict();
