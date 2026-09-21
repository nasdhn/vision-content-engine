-- CreateEnum
CREATE TYPE "EditingBlockerStatus" AS ENUM ('OPEN', 'RESOLVED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "EditingBlockerReasonCode" AS ENUM ('ASSET_QUALITY_INSUFFICIENT', 'PROOF_COVERAGE_INSUFFICIENT', 'SCRIPT_ASSET_MISMATCH', 'PRESENTER_COVERAGE_INSUFFICIENT', 'VOICE_COVERAGE_INSUFFICIENT', 'CREATIVE_PLAN_CONSTRAINT_CONFLICT');

-- CreateEnum
CREATE TYPE "EditingBlockerRecoverability" AS ENUM ('RECOVERABLE_WITH_INPUT', 'REQUIRES_CREATIVE_PLAN_REVISION');

-- CreateTable
CREATE TABLE "EditingBlocker" (
    "id" UUID NOT NULL,
    "creativePlanVersionId" UUID NOT NULL,
    "modelInvocationId" UUID NOT NULL,
    "status" "EditingBlockerStatus" NOT NULL DEFAULT 'OPEN',
    "reasonCode" "EditingBlockerReasonCode" NOT NULL,
    "recoverability" "EditingBlockerRecoverability" NOT NULL,
    "blockerSpecJson" JSONB NOT NULL,
    "resolvedByEditingPlanVersionId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMPTZ(3),

    CONSTRAINT "EditingBlocker_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "EditingBlocker_closed_state_check" CHECK (
      ("status" = 'OPEN' AND "closedAt" IS NULL AND "resolvedByEditingPlanVersionId" IS NULL) OR
      ("status" = 'RESOLVED' AND "closedAt" IS NOT NULL AND "resolvedByEditingPlanVersionId" IS NOT NULL) OR
      ("status" = 'SUPERSEDED' AND "closedAt" IS NOT NULL AND "resolvedByEditingPlanVersionId" IS NULL)
    )
);

-- CreateIndex
CREATE UNIQUE INDEX "EditingBlocker_modelInvocationId_key" ON "EditingBlocker"("modelInvocationId");

-- CreateIndex
CREATE INDEX "EditingBlocker_creativePlanVersionId_status_createdAt_idx" ON "EditingBlocker"("creativePlanVersionId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "EditingBlocker_status_createdAt_idx" ON "EditingBlocker"("status", "createdAt");

-- One unresolved blocker is canonical per immutable CreativePlanVersion.
CREATE UNIQUE INDEX "EditingBlocker_one_open_per_creative_plan_version"
ON "EditingBlocker"("creativePlanVersionId")
WHERE "status" = 'OPEN';

-- AddForeignKey
ALTER TABLE "EditingBlocker" ADD CONSTRAINT "EditingBlocker_creativePlanVersionId_fkey" FOREIGN KEY ("creativePlanVersionId") REFERENCES "CreativePlanVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EditingBlocker" ADD CONSTRAINT "EditingBlocker_modelInvocationId_fkey" FOREIGN KEY ("modelInvocationId") REFERENCES "ModelInvocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EditingBlocker" ADD CONSTRAINT "EditingBlocker_resolvedByEditingPlanVersionId_fkey" FOREIGN KEY ("resolvedByEditingPlanVersionId") REFERENCES "EditingPlanVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
