import { z } from "zod";
import {
  AssetSummarySchema,
  ConceptVersionSnapshotSchema,
  CreativePlanVersionSnapshotSchema,
  EditingProfileVersionSnapshotSchema,
  ScriptVersionSnapshotSchema,
  TemplateVersionSnapshotSchema,
} from "./shared";
import { EditingPlanSpecSchema } from "../editing-intelligence/schema";

export const EditingIntelligenceInputSchema = z.object({
  concept: ConceptVersionSnapshotSchema,
  scriptVersion: ScriptVersionSnapshotSchema,
  creativePlanVersion: CreativePlanVersionSnapshotSchema,
  editingProfile: EditingProfileVersionSnapshotSchema,
  template: TemplateVersionSnapshotSchema,
  assets: z.array(AssetSummarySchema),
  allowedMotionPresets: z.array(z.string()),
  allowedTransitionPresets: z.array(z.string()),
  allowedChromaKeyProfiles: z.array(z.string()),
  durationConstraints: z.object({
    minMs: z.number().int().nonnegative(),
    maxMs: z.number().int().positive(),
  }).strict(),
  renderConstraints: z.object({
    width: z.literal(1080),
    height: z.literal(1920),
    allowedFps: z.array(z.number().positive()).min(1),
  }).strict(),
}).strict().superRefine((value, ctx) => {
  if (value.creativePlanVersion.templateVersionId !== value.template.id) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "template must match CreativePlanVersion.templateVersionId",
      path: ["template","id"],
    });
  }
  if (value.creativePlanVersion.editingProfileVersionId !== value.editingProfile.id) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "editingProfile must match CreativePlanVersion.editingProfileVersionId",
      path: ["editingProfile","id"],
    });
  }
});

export const EditingIntelligenceOutputSchema = EditingPlanSpecSchema;
