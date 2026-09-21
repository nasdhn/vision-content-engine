-- Phase 5 lossless EditingPlan persistence.
--
-- Historical EditingPlanVersion rows may remain NULL.
-- Phase 5 application writers persist the complete validated EditingPlanSpec.
ALTER TABLE "EditingPlanVersion"
ADD COLUMN "planSpecJson" JSONB;
