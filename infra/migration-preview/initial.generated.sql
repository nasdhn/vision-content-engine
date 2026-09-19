-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "BriefStatus" AS ENUM ('DRAFT', 'READY', 'GENERATING', 'ACTIVE', 'COMPLETED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "IdeaSourceType" AS ENUM ('USER', 'BRIEF_DERIVED', 'PERFORMANCE_DERIVED', 'RESEARCH_DERIVED');

-- CreateEnum
CREATE TYPE "IdeaStatus" AS ENUM ('DRAFT', 'ACTIVE', 'EXHAUSTED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "SourceReferenceType" AS ENUM ('INTERNAL_PRODUCT', 'INTERNAL_PRICING', 'OFFICIAL_DOCUMENTATION', 'PUBLIC_WEB', 'MANUAL_REFERENCE');

-- CreateEnum
CREATE TYPE "PatternStatus" AS ENUM ('DRAFT', 'ACTIVE', 'DEPRECATED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ConceptStatus" AS ENUM ('DRAFT', 'AWAITING_REVIEW', 'APPROVED', 'REJECTED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "CreatorType" AS ENUM ('HUMAN', 'AI', 'HYBRID');

-- CreateEnum
CREATE TYPE "ScriptStatus" AS ENUM ('DRAFT', 'READY', 'SUPERSEDED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "VoiceMode" AS ENUM ('NATURAL_USER_VOICE', 'NO_VOICE', 'OTHER_HUMAN', 'AI_VOICE');

-- CreateEnum
CREATE TYPE "CreativePlanStatus" AS ENUM ('DRAFT', 'READY', 'WAITING_FOR_INPUTS', 'READY_FOR_EDITING', 'SUPERSEDED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "RecordingRequestType" AS ENUM ('VOICE', 'GREEN_SCREEN_VIDEO', 'SCREEN_VIDEO', 'BROLL', 'OTHER');

-- CreateEnum
CREATE TYPE "RecordingRequestStatus" AS ENUM ('PENDING', 'READY_TO_RECORD', 'UPLOADED', 'ACCEPTED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RecordingStatus" AS ENUM ('UPLOADED', 'SELECTED', 'REJECTED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "AssetKind" AS ENUM ('IMAGE', 'VIDEO', 'AUDIO', 'FONT', 'SUBTITLE', 'JSON', 'OTHER');

-- CreateEnum
CREATE TYPE "AssetSourceType" AS ENUM ('UPLOAD', 'RECORDING', 'CAPTURE', 'RENDER', 'SYSTEM', 'EXTERNAL');

-- CreateEnum
CREATE TYPE "AssetStatus" AS ENUM ('UPLOADING', 'READY', 'FAILED', 'QUARANTINED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "CaptureRunStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DefinitionStatus" AS ENUM ('DRAFT', 'ACTIVE', 'DEPRECATED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "EditingPlanStatus" AS ENUM ('DRAFT', 'READY', 'SUPERSEDED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "RenderStatus" AS ENUM ('REQUESTED', 'QUEUED', 'RENDERING', 'TECHNICAL_QA', 'CREATIVE_QA', 'READY_FOR_REVIEW', 'APPROVED', 'REJECTED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AttemptStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CreativeQaResult" AS ENUM ('PASS', 'PASS_WITH_WARNINGS', 'FAIL');

-- CreateEnum
CREATE TYPE "ApprovalSubjectType" AS ENUM ('CONCEPT', 'RENDER');

-- CreateEnum
CREATE TYPE "ApprovalDecision" AS ENUM ('APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ApprovalActorType" AS ENUM ('USER', 'SYSTEM');

-- CreateEnum
CREATE TYPE "Platform" AS ENUM ('TIKTOK', 'INSTAGRAM', 'YOUTUBE');

-- CreateEnum
CREATE TYPE "PlatformAccountStatus" AS ENUM ('ACTIVE', 'REAUTH_REQUIRED', 'DISABLED', 'ERROR');

-- CreateEnum
CREATE TYPE "PublicationDeliveryMode" AS ENUM ('API_AUTOMATED', 'MANUAL_HANDOFF');

-- CreateEnum
CREATE TYPE "PublicationStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'READY_FOR_MANUAL_PUBLISH', 'PUBLISHING', 'PUBLISHING_UNKNOWN', 'PUBLISHED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AssetDerivationType" AS ENUM ('PLATFORM_DERIVATIVE');

-- CreateEnum
CREATE TYPE "PublicationResponseClass" AS ENUM ('SUCCESS', 'TRANSIENT_FAILURE', 'PERMANENT_FAILURE', 'RATE_LIMITED', 'UNKNOWN_SIDE_EFFECT');

-- CreateEnum
CREATE TYPE "AttributionEventType" AS ENUM ('WEBSITE_VISIT', 'SIGNUP', 'ACTIVATION', 'CUSTOMER', 'REVENUE');

-- CreateEnum
CREATE TYPE "AttributionConfidenceType" AS ENUM ('DIRECT', 'INFERRED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "AttributionSourceSystem" AS ENUM ('UMAMI', 'VISION_APP', 'STRIPE', 'MANUAL');

-- CreateEnum
CREATE TYPE "MetricCollectionMethod" AS ENUM ('PLATFORM_API', 'MANUAL_ENTRY');

-- CreateEnum
CREATE TYPE "ExperimentStatus" AS ENUM ('DRAFT', 'RUNNING', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "InsightConfidence" AS ENUM ('INSUFFICIENT_DATA', 'WEAK_SIGNAL', 'INTERESTING_SIGNAL', 'FAIRLY_SOLID');

-- CreateEnum
CREATE TYPE "RecommendationStatus" AS ENUM ('PROPOSED', 'ACCEPTED', 'REJECTED', 'EXECUTED');

-- CreateEnum
CREATE TYPE "WorkflowType" AS ENUM ('CONCEPT_GENERATION', 'CREATIVE_PRODUCTION', 'CAPTURE', 'RENDER', 'PUBLICATION', 'ANALYTICS', 'WEEKLY_ANALYSIS');

-- CreateEnum
CREATE TYPE "WorkflowStatus" AS ENUM ('PENDING', 'RUNNING', 'WAITING', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "JobAttemptStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'DISPATCHING', 'DISPATCHED', 'FAILED');

-- CreateEnum
CREATE TYPE "ModelInvocationStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED', 'REJECTED_SCHEMA');

-- CreateEnum
CREATE TYPE "CostCategory" AS ENUM ('AI', 'RENDER', 'STORAGE', 'BANDWIDTH', 'PLATFORM', 'OTHER');

-- CreateEnum
CREATE TYPE "AuditActorType" AS ENUM ('USER', 'SYSTEM', 'WORKER', 'AI');

-- CreateEnum
CREATE TYPE "CaptureAssetRole" AS ENUM ('SCREENSHOT', 'VIDEO', 'FRAME', 'TRACE', 'LOG', 'OTHER');

-- CreateEnum
CREATE TYPE "RenderInputRole" AS ENUM ('VOICE', 'GREEN_SCREEN_VIDEO', 'PRODUCT_CAPTURE', 'SCREENSHOT', 'BROLL', 'MUSIC', 'SFX', 'IMAGE', 'SUBTITLE_SOURCE', 'TEMPLATE_ASSET', 'OTHER');

-- CreateEnum
CREATE TYPE "TemplateAssetRole" AS ENUM ('LOGO', 'FONT', 'ICON', 'BACKGROUND', 'MUSIC', 'SFX', 'IMAGE', 'VIDEO', 'OTHER');

-- CreateTable
CREATE TABLE "Campaign" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "objective" TEXT,
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "startsAt" TIMESTAMPTZ(3),
    "endsAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Brief" (
    "id" UUID NOT NULL,
    "campaignId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "goal" TEXT,
    "audience" TEXT,
    "notes" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "status" "BriefStatus" NOT NULL DEFAULT 'DRAFT',
    "topics" JSONB,
    "productAreas" JSONB,
    "mustMention" JSONB,
    "mustAvoid" JSONB,
    "preferredFormats" JSONB,
    "targetPlatforms" JSONB,
    "targetContentCount" INTEGER,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Brief_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BriefVersion" (
    "id" UUID NOT NULL,
    "briefId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "payloadJson" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,

    CONSTRAINT "BriefVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Idea" (
    "id" UUID NOT NULL,
    "briefId" UUID,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "sourceType" "IdeaSourceType" NOT NULL,
    "sourceReferenceId" UUID,
    "status" "IdeaStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Idea_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceReference" (
    "id" UUID NOT NULL,
    "sourceType" "SourceReferenceType" NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT,
    "publisher" TEXT,
    "observedAt" TIMESTAMPTZ(3),
    "retrievedAt" TIMESTAMPTZ(3),
    "contentHash" TEXT,
    "metadataJson" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SourceReference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeSnapshot" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "contentHash" TEXT NOT NULL,
    "status" "DefinitionStatus" NOT NULL DEFAULT 'DRAFT',
    "effectiveAt" TIMESTAMPTZ(3) NOT NULL,
    "payloadJson" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,

    CONSTRAINT "KnowledgeSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pattern" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "status" "PatternStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Pattern_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PatternVersion" (
    "id" UUID NOT NULL,
    "patternId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "description" TEXT,
    "whenToUse" TEXT,
    "audienceFitJson" JSONB,
    "hookStructureJson" JSONB,
    "storyStructureJson" JSONB,
    "visualStructureJson" JSONB,
    "ctaStyleJson" JSONB,
    "constraintsJson" JSONB,
    "knownRisksJson" JSONB,
    "examplesJson" JSONB,
    "sourceType" TEXT,
    "sourceMetadataJson" JSONB,
    "confidence" DOUBLE PRECISION,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,

    CONSTRAINT "PatternVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Concept" (
    "id" UUID NOT NULL,
    "ideaId" UUID,
    "briefId" UUID NOT NULL,
    "status" "ConceptStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Concept_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConceptVersion" (
    "id" UUID NOT NULL,
    "conceptId" UUID NOT NULL,
    "briefVersionId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "angle" TEXT,
    "hook" TEXT,
    "audience" TEXT,
    "objective" TEXT,
    "hypothesis" TEXT,
    "selectedPatternVersionId" UUID,
    "rationale" TEXT,
    "creatorType" "CreatorType" NOT NULL,
    "creatorModelInvocationId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConceptVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Script" (
    "id" UUID NOT NULL,
    "conceptId" UUID NOT NULL,
    "status" "ScriptStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Script_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScriptVersion" (
    "id" UUID NOT NULL,
    "scriptId" UUID NOT NULL,
    "conceptVersionId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'fr',
    "fullText" TEXT NOT NULL,
    "segmentsJson" JSONB,
    "estimatedDurationMs" INTEGER,
    "voiceMode" "VoiceMode" NOT NULL DEFAULT 'NATURAL_USER_VOICE',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByType" "CreatorType" NOT NULL,
    "modelInvocationId" UUID,

    CONSTRAINT "ScriptVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreativePlan" (
    "id" UUID NOT NULL,
    "conceptId" UUID NOT NULL,
    "status" "CreativePlanStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CreativePlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreativePlanVersion" (
    "id" UUID NOT NULL,
    "creativePlanId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "scriptVersionId" UUID NOT NULL,
    "targetDurationMs" INTEGER,
    "primaryFormat" TEXT NOT NULL,
    "templateVersionId" UUID NOT NULL,
    "editingProfileVersionId" UUID NOT NULL,
    "scenePlanJson" JSONB NOT NULL,
    "requiredRecordingsJson" JSONB,
    "requiredCapturesJson" JSONB,
    "requiredAssetsJson" JSONB,
    "ctaJson" JSONB,
    "platformConsiderationsJson" JSONB,
    "modelInvocationId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreativePlanVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecordingRequest" (
    "id" UUID NOT NULL,
    "creativePlanVersionId" UUID NOT NULL,
    "type" "RecordingRequestType" NOT NULL,
    "title" TEXT NOT NULL,
    "instructions" TEXT,
    "scriptSegmentRef" TEXT,
    "shotInstructionsJson" JSONB,
    "status" "RecordingRequestStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMPTZ(3),

    CONSTRAINT "RecordingRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Recording" (
    "id" UUID NOT NULL,
    "recordingRequestId" UUID NOT NULL,
    "assetId" UUID NOT NULL,
    "takeNumber" INTEGER NOT NULL,
    "status" "RecordingStatus" NOT NULL DEFAULT 'UPLOADED',
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Recording_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" UUID NOT NULL,
    "kind" "AssetKind" NOT NULL,
    "storageProvider" TEXT NOT NULL,
    "bucket" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "checksumSha256" TEXT,
    "mimeType" TEXT,
    "sizeBytes" BIGINT,
    "width" INTEGER,
    "height" INTEGER,
    "durationMs" INTEGER,
    "fps" DOUBLE PRECISION,
    "audioChannels" INTEGER,
    "sampleRate" INTEGER,
    "status" "AssetStatus" NOT NULL DEFAULT 'UPLOADING',
    "sourceType" "AssetSourceType" NOT NULL,
    "sourceEntityType" TEXT,
    "sourceEntityId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetDerivation" (
    "id" UUID NOT NULL,
    "sourceAssetId" UUID NOT NULL,
    "derivedAssetId" UUID NOT NULL,
    "type" "AssetDerivationType" NOT NULL,
    "platform" "Platform",
    "transformationProfileKey" TEXT NOT NULL,
    "transformationProfileVersion" TEXT NOT NULL,
    "metadataJson" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssetDerivation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaptureScenario" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "DefinitionStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CaptureScenario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaptureScenarioVersion" (
    "id" UUID NOT NULL,
    "captureScenarioId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "targetEnvironment" TEXT NOT NULL,
    "stepsJson" JSONB NOT NULL,
    "inputSchemaJson" JSONB,
    "outputSpecJson" JSONB,
    "browserConfigJson" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,

    CONSTRAINT "CaptureScenarioVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaptureRun" (
    "id" UUID NOT NULL,
    "captureScenarioVersionId" UUID NOT NULL,
    "creativePlanVersionId" UUID,
    "operationId" UUID NOT NULL,
    "status" "CaptureRunStatus" NOT NULL DEFAULT 'PENDING',
    "startedAt" TIMESTAMPTZ(3),
    "finishedAt" TIMESTAMPTZ(3),
    "failureCode" TEXT,
    "failureMessage" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaptureRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaptureRunAsset" (
    "captureRunId" UUID NOT NULL,
    "assetId" UUID NOT NULL,
    "role" "CaptureAssetRole" NOT NULL,
    "sequence" INTEGER,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaptureRunAsset_pkey" PRIMARY KEY ("captureRunId","assetId","role")
);

-- CreateTable
CREATE TABLE "Template" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "status" "DefinitionStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TemplateVersion" (
    "id" UUID NOT NULL,
    "templateId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "inputSchemaJson" JSONB NOT NULL,
    "supportedAspectRatiosJson" JSONB,
    "minDurationMs" INTEGER,
    "maxDurationMs" INTEGER,
    "requiredSlotsJson" JSONB,
    "optionalSlotsJson" JSONB,
    "capabilitiesJson" JSONB,
    "rendererVersion" TEXT NOT NULL,
    "sourceRevision" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TemplateVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TemplateVersionAsset" (
    "templateVersionId" UUID NOT NULL,
    "assetId" UUID NOT NULL,
    "role" "TemplateAssetRole" NOT NULL,
    "slotKey" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TemplateVersionAsset_pkey" PRIMARY KEY ("templateVersionId","assetId","role")
);

-- CreateTable
CREATE TABLE "EditingProfile" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "DefinitionStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "EditingProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EditingProfileVersion" (
    "id" UUID NOT NULL,
    "editingProfileId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "pacingRulesJson" JSONB,
    "cutRulesJson" JSONB,
    "captionRulesJson" JSONB,
    "focusRulesJson" JSONB,
    "motionRulesJson" JSONB,
    "soundRulesJson" JSONB,
    "hookRulesJson" JSONB,
    "endingRulesJson" JSONB,
    "greenScreenRulesJson" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EditingProfileVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EditingPlan" (
    "id" UUID NOT NULL,
    "creativePlanId" UUID NOT NULL,
    "status" "EditingPlanStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "EditingPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EditingPlanVersion" (
    "id" UUID NOT NULL,
    "editingPlanId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "creativePlanVersionId" UUID NOT NULL,
    "editingProfileVersionId" UUID NOT NULL,
    "templateVersionId" UUID NOT NULL,
    "timelineJson" JSONB NOT NULL,
    "captionPlanJson" JSONB,
    "audioPlanJson" JSONB,
    "visualFocusJson" JSONB,
    "transitionPlanJson" JSONB,
    "greenScreenPlanJson" JSONB,
    "renderSettingsJson" JSONB,
    "modelInvocationId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EditingPlanVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Render" (
    "id" UUID NOT NULL,
    "editingPlanVersionId" UUID NOT NULL,
    "operationId" UUID NOT NULL,
    "status" "RenderStatus" NOT NULL DEFAULT 'REQUESTED',
    "approvedAssetId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Render_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RenderInputAsset" (
    "renderId" UUID NOT NULL,
    "assetId" UUID NOT NULL,
    "role" "RenderInputRole" NOT NULL,
    "slotKey" TEXT,
    "sequence" INTEGER,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RenderInputAsset_pkey" PRIMARY KEY ("renderId","assetId","role")
);

-- CreateTable
CREATE TABLE "RenderAttempt" (
    "id" UUID NOT NULL,
    "renderId" UUID NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "status" "AttemptStatus" NOT NULL DEFAULT 'QUEUED',
    "workerVersion" TEXT,
    "rendererVersion" TEXT,
    "startedAt" TIMESTAMPTZ(3),
    "finishedAt" TIMESTAMPTZ(3),
    "failureCode" TEXT,
    "failureMessage" TEXT,
    "outputAssetId" UUID,
    "diagnosticAssetId" UUID,
    "technicalQaJson" JSONB,
    "creativeQaResult" "CreativeQaResult",
    "creativeQaJson" JSONB,
    "creativeQaModelInvocationId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RenderAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Approval" (
    "id" UUID NOT NULL,
    "subjectType" "ApprovalSubjectType" NOT NULL,
    "conceptVersionId" UUID,
    "renderId" UUID,
    "decision" "ApprovalDecision" NOT NULL,
    "reasonCode" TEXT,
    "comment" TEXT,
    "actorType" "ApprovalActorType" NOT NULL,
    "actorId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Approval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformAccount" (
    "id" UUID NOT NULL,
    "platform" "Platform" NOT NULL,
    "displayName" TEXT NOT NULL,
    "remoteAccountId" TEXT NOT NULL,
    "status" "PlatformAccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "credentialsRef" TEXT,
    "capabilitiesJson" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PlatformAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Publication" (
    "id" UUID NOT NULL,
    "renderId" UUID NOT NULL,
    "platformAccountId" UUID NOT NULL,
    "operationId" UUID NOT NULL,
    "trackingCode" UUID NOT NULL,
    "deliveryMode" "PublicationDeliveryMode" NOT NULL,
    "status" "PublicationStatus" NOT NULL DEFAULT 'DRAFT',
    "scheduledAt" TIMESTAMPTZ(3),
    "publishedAt" TIMESTAMPTZ(3),
    "remotePostId" TEXT,
    "remoteUrl" TEXT,
    "mediaAssetId" UUID,
    "metadataJson" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Publication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PublicationAttempt" (
    "id" UUID NOT NULL,
    "publicationId" UUID NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "status" "AttemptStatus" NOT NULL DEFAULT 'QUEUED',
    "startedAt" TIMESTAMPTZ(3),
    "finishedAt" TIMESTAMPTZ(3),
    "remoteRequestId" TEXT,
    "remotePostId" TEXT,
    "responseClass" "PublicationResponseClass",
    "responseMetadataJson" JSONB,
    "failureCode" TEXT,
    "failureMessage" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PublicationAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MetricSnapshotRaw" (
    "id" UUID NOT NULL,
    "publicationId" UUID NOT NULL,
    "platform" "Platform" NOT NULL,
    "collectedAt" TIMESTAMPTZ(3) NOT NULL,
    "providerSchemaVersion" TEXT,
    "collectionMethod" "MetricCollectionMethod" NOT NULL,
    "collectionOperationId" UUID NOT NULL,
    "payloadJson" JSONB NOT NULL,
    "payloadHash" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MetricSnapshotRaw_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MetricSnapshotNormalized" (
    "id" UUID NOT NULL,
    "publicationId" UUID NOT NULL,
    "rawSnapshotId" UUID NOT NULL,
    "collectedAt" TIMESTAMPTZ(3) NOT NULL,
    "views" BIGINT,
    "engagedViews" BIGINT,
    "reach" BIGINT,
    "impressions" BIGINT,
    "likes" BIGINT,
    "comments" BIGINT,
    "shares" BIGINT,
    "saves" BIGINT,
    "watchTimeMs" BIGINT,
    "avgWatchDurationMs" INTEGER,
    "avgWatchPercentage" DOUBLE PRECISION,
    "completionRate" DOUBLE PRECISION,
    "profileVisits" BIGINT,
    "websiteClicks" BIGINT,
    "follows" BIGINT,
    "otherMetricsJson" JSONB,
    "availabilityJson" JSONB,
    "comparabilityJson" JSONB,
    "normalizerVersion" TEXT NOT NULL,
    "metricSemanticsVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MetricSnapshotNormalized_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttributionEvent" (
    "id" UUID NOT NULL,
    "publicationId" UUID,
    "campaignId" UUID,
    "eventType" "AttributionEventType" NOT NULL,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL,
    "source" TEXT,
    "sourceSystem" "AttributionSourceSystem" NOT NULL,
    "externalEventId" TEXT NOT NULL,
    "confidenceType" "AttributionConfidenceType" NOT NULL,
    "externalVisitorId" TEXT,
    "userId" TEXT,
    "valueAmountMinor" BIGINT,
    "valueCurrency" TEXT,
    "metadataJson" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttributionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Experiment" (
    "id" UUID NOT NULL,
    "campaignId" UUID,
    "name" TEXT NOT NULL,
    "hypothesis" TEXT NOT NULL,
    "primaryMetric" TEXT,
    "status" "ExperimentStatus" NOT NULL DEFAULT 'DRAFT',
    "startedAt" TIMESTAMPTZ(3),
    "endedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Experiment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExperimentArm" (
    "id" UUID NOT NULL,
    "experimentId" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "conceptVersionId" UUID,
    "publicationId" UUID,
    "variablesJson" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExperimentArm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Insight" (
    "id" UUID NOT NULL,
    "scopeType" TEXT NOT NULL,
    "scopeId" TEXT,
    "statement" TEXT NOT NULL,
    "confidence" "InsightConfidence" NOT NULL,
    "evidenceJson" JSONB NOT NULL,
    "limitationsJson" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modelInvocationId" UUID,

    CONSTRAINT "Insight_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Recommendation" (
    "id" UUID NOT NULL,
    "insightId" UUID,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "recommendedTestJson" JSONB,
    "status" "RecommendationStatus" NOT NULL DEFAULT 'PROPOSED',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Recommendation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowRun" (
    "id" UUID NOT NULL,
    "workflowType" "WorkflowType" NOT NULL,
    "rootEntityType" TEXT NOT NULL,
    "rootEntityId" TEXT NOT NULL,
    "status" "WorkflowStatus" NOT NULL DEFAULT 'PENDING',
    "currentStep" TEXT,
    "startedAt" TIMESTAMPTZ(3),
    "finishedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "WorkflowRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobAttempt" (
    "id" UUID NOT NULL,
    "workflowRunId" UUID,
    "queueName" TEXT NOT NULL,
    "jobType" TEXT NOT NULL,
    "operationId" UUID NOT NULL,
    "bullJobId" TEXT,
    "attemptNumber" INTEGER NOT NULL,
    "status" "JobAttemptStatus" NOT NULL DEFAULT 'QUEUED',
    "workerId" TEXT,
    "startedAt" TIMESTAMPTZ(3),
    "finishedAt" TIMESTAMPTZ(3),
    "failureCode" TEXT,
    "failureMessage" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboxEvent" (
    "id" UUID NOT NULL,
    "eventType" TEXT NOT NULL,
    "aggregateType" TEXT NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "payloadJson" JSONB NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dispatchedAt" TIMESTAMPTZ(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModelInvocation" (
    "id" UUID NOT NULL,
    "purpose" TEXT NOT NULL,
    "requestedProvider" TEXT,
    "requestedModel" TEXT,
    "reasoningLevel" TEXT,
    "promptKey" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "promptContentHash" TEXT NOT NULL,
    "knowledgeSnapshotId" UUID NOT NULL,
    "inputSchemaVersion" TEXT NOT NULL,
    "outputSchemaVersion" TEXT NOT NULL,
    "policyJson" JSONB,
    "status" "ModelInvocationStatus" NOT NULL DEFAULT 'RUNNING',
    "inputHash" TEXT NOT NULL,
    "outputHash" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "cachedInputTokens" INTEGER,
    "latencyMs" INTEGER,
    "costAmount" DECIMAL(18,8),
    "costCurrency" TEXT,
    "relatedEntityType" TEXT,
    "relatedEntityId" TEXT,
    "validationJson" JSONB,
    "startedAt" TIMESTAMPTZ(3) NOT NULL,
    "finishedAt" TIMESTAMPTZ(3),
    "failureCode" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModelInvocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModelInvocationAttempt" (
    "id" UUID NOT NULL,
    "modelInvocationId" UUID NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "reasoningLevel" TEXT,
    "status" "ModelInvocationStatus" NOT NULL DEFAULT 'RUNNING',
    "requestHash" TEXT NOT NULL,
    "responseHash" TEXT,
    "requestPayloadRef" TEXT,
    "responsePayloadRef" TEXT,
    "rawPayloadExpiresAt" TIMESTAMPTZ(3),
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "cachedInputTokens" INTEGER,
    "latencyMs" INTEGER,
    "costAmount" DECIMAL(18,8),
    "costCurrency" TEXT,
    "validationJson" JSONB,
    "failureCode" TEXT,
    "startedAt" TIMESTAMPTZ(3) NOT NULL,
    "finishedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModelInvocationAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CostEntry" (
    "id" UUID NOT NULL,
    "category" "CostCategory" NOT NULL,
    "provider" TEXT,
    "amount" DECIMAL(18,8) NOT NULL,
    "currency" TEXT NOT NULL,
    "quantity" DECIMAL(18,8),
    "unit" TEXT,
    "relatedEntityType" TEXT,
    "relatedEntityId" TEXT,
    "modelInvocationId" UUID,
    "renderAttemptId" UUID,
    "publicationId" UUID,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadataJson" JSONB,

    CONSTRAINT "CostEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" UUID NOT NULL,
    "actorType" "AuditActorType" NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "subjectVersionId" TEXT,
    "beforeJson" JSONB,
    "afterJson" JSONB,
    "metadataJson" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Campaign_slug_key" ON "Campaign"("slug");

-- CreateIndex
CREATE INDEX "Campaign_status_startsAt_idx" ON "Campaign"("status", "startsAt");

-- CreateIndex
CREATE INDEX "Brief_campaignId_status_idx" ON "Brief"("campaignId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "BriefVersion_briefId_version_key" ON "BriefVersion"("briefId", "version");

-- CreateIndex
CREATE INDEX "Idea_briefId_idx" ON "Idea"("briefId");

-- CreateIndex
CREATE INDEX "Idea_sourceReferenceId_idx" ON "Idea"("sourceReferenceId");

-- CreateIndex
CREATE INDEX "Idea_status_sourceType_idx" ON "Idea"("status", "sourceType");

-- CreateIndex
CREATE INDEX "SourceReference_sourceType_createdAt_idx" ON "SourceReference"("sourceType", "createdAt");

-- CreateIndex
CREATE INDEX "SourceReference_url_idx" ON "SourceReference"("url");

-- CreateIndex
CREATE INDEX "KnowledgeSnapshot_key_status_effectiveAt_idx" ON "KnowledgeSnapshot"("key", "status", "effectiveAt");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeSnapshot_key_version_key" ON "KnowledgeSnapshot"("key", "version");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeSnapshot_key_contentHash_key" ON "KnowledgeSnapshot"("key", "contentHash");

-- CreateIndex
CREATE UNIQUE INDEX "Pattern_key_key" ON "Pattern"("key");

-- CreateIndex
CREATE UNIQUE INDEX "PatternVersion_patternId_version_key" ON "PatternVersion"("patternId", "version");

-- CreateIndex
CREATE INDEX "Concept_briefId_status_idx" ON "Concept"("briefId", "status");

-- CreateIndex
CREATE INDEX "Concept_ideaId_idx" ON "Concept"("ideaId");

-- CreateIndex
CREATE INDEX "ConceptVersion_briefVersionId_idx" ON "ConceptVersion"("briefVersionId");

-- CreateIndex
CREATE INDEX "ConceptVersion_selectedPatternVersionId_idx" ON "ConceptVersion"("selectedPatternVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "ConceptVersion_conceptId_version_key" ON "ConceptVersion"("conceptId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "Script_conceptId_key" ON "Script"("conceptId");

-- CreateIndex
CREATE INDEX "ScriptVersion_conceptVersionId_idx" ON "ScriptVersion"("conceptVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "ScriptVersion_scriptId_version_key" ON "ScriptVersion"("scriptId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "CreativePlan_conceptId_key" ON "CreativePlan"("conceptId");

-- CreateIndex
CREATE INDEX "CreativePlanVersion_scriptVersionId_idx" ON "CreativePlanVersion"("scriptVersionId");

-- CreateIndex
CREATE INDEX "CreativePlanVersion_templateVersionId_idx" ON "CreativePlanVersion"("templateVersionId");

-- CreateIndex
CREATE INDEX "CreativePlanVersion_editingProfileVersionId_idx" ON "CreativePlanVersion"("editingProfileVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "CreativePlanVersion_creativePlanId_version_key" ON "CreativePlanVersion"("creativePlanId", "version");

-- CreateIndex
CREATE INDEX "RecordingRequest_creativePlanVersionId_status_idx" ON "RecordingRequest"("creativePlanVersionId", "status");

-- CreateIndex
CREATE INDEX "RecordingRequest_status_createdAt_idx" ON "RecordingRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Recording_assetId_idx" ON "Recording"("assetId");

-- CreateIndex
CREATE UNIQUE INDEX "Recording_recordingRequestId_takeNumber_key" ON "Recording"("recordingRequestId", "takeNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Asset_objectKey_key" ON "Asset"("objectKey");

-- CreateIndex
CREATE INDEX "Asset_sourceEntityType_sourceEntityId_idx" ON "Asset"("sourceEntityType", "sourceEntityId");

-- CreateIndex
CREATE INDEX "Asset_status_createdAt_idx" ON "Asset"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AssetDerivation_derivedAssetId_key" ON "AssetDerivation"("derivedAssetId");

-- CreateIndex
CREATE INDEX "AssetDerivation_sourceAssetId_createdAt_idx" ON "AssetDerivation"("sourceAssetId", "createdAt");

-- CreateIndex
CREATE INDEX "AssetDerivation_platform_type_createdAt_idx" ON "AssetDerivation"("platform", "type", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CaptureScenario_key_key" ON "CaptureScenario"("key");

-- CreateIndex
CREATE UNIQUE INDEX "CaptureScenarioVersion_captureScenarioId_version_key" ON "CaptureScenarioVersion"("captureScenarioId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "CaptureRun_operationId_key" ON "CaptureRun"("operationId");

-- CreateIndex
CREATE INDEX "CaptureRun_status_createdAt_idx" ON "CaptureRun"("status", "createdAt");

-- CreateIndex
CREATE INDEX "CaptureRun_creativePlanVersionId_idx" ON "CaptureRun"("creativePlanVersionId");

-- CreateIndex
CREATE INDEX "CaptureRunAsset_assetId_idx" ON "CaptureRunAsset"("assetId");

-- CreateIndex
CREATE UNIQUE INDEX "Template_key_key" ON "Template"("key");

-- CreateIndex
CREATE UNIQUE INDEX "TemplateVersion_templateId_version_key" ON "TemplateVersion"("templateId", "version");

-- CreateIndex
CREATE INDEX "TemplateVersionAsset_assetId_idx" ON "TemplateVersionAsset"("assetId");

-- CreateIndex
CREATE UNIQUE INDEX "EditingProfile_key_key" ON "EditingProfile"("key");

-- CreateIndex
CREATE UNIQUE INDEX "EditingProfileVersion_editingProfileId_version_key" ON "EditingProfileVersion"("editingProfileId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "EditingPlan_creativePlanId_key" ON "EditingPlan"("creativePlanId");

-- CreateIndex
CREATE INDEX "EditingPlanVersion_creativePlanVersionId_idx" ON "EditingPlanVersion"("creativePlanVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "EditingPlanVersion_editingPlanId_version_key" ON "EditingPlanVersion"("editingPlanId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "Render_operationId_key" ON "Render"("operationId");

-- CreateIndex
CREATE INDEX "Render_status_createdAt_idx" ON "Render"("status", "createdAt");

-- CreateIndex
CREATE INDEX "RenderInputAsset_assetId_idx" ON "RenderInputAsset"("assetId");

-- CreateIndex
CREATE INDEX "RenderAttempt_status_createdAt_idx" ON "RenderAttempt"("status", "createdAt");

-- CreateIndex
CREATE INDEX "RenderAttempt_creativeQaModelInvocationId_idx" ON "RenderAttempt"("creativeQaModelInvocationId");

-- CreateIndex
CREATE UNIQUE INDEX "RenderAttempt_renderId_attemptNumber_key" ON "RenderAttempt"("renderId", "attemptNumber");

-- CreateIndex
CREATE INDEX "Approval_subjectType_createdAt_idx" ON "Approval"("subjectType", "createdAt");

-- CreateIndex
CREATE INDEX "Approval_conceptVersionId_createdAt_idx" ON "Approval"("conceptVersionId", "createdAt");

-- CreateIndex
CREATE INDEX "Approval_renderId_createdAt_idx" ON "Approval"("renderId", "createdAt");

-- CreateIndex
CREATE INDEX "PlatformAccount_status_idx" ON "PlatformAccount"("status");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformAccount_platform_remoteAccountId_key" ON "PlatformAccount"("platform", "remoteAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Publication_operationId_key" ON "Publication"("operationId");

-- CreateIndex
CREATE UNIQUE INDEX "Publication_trackingCode_key" ON "Publication"("trackingCode");

-- CreateIndex
CREATE INDEX "Publication_status_scheduledAt_idx" ON "Publication"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "Publication_deliveryMode_status_scheduledAt_idx" ON "Publication"("deliveryMode", "status", "scheduledAt");

-- CreateIndex
CREATE INDEX "Publication_platformAccountId_publishedAt_idx" ON "Publication"("platformAccountId", "publishedAt");

-- CreateIndex
CREATE INDEX "Publication_renderId_idx" ON "Publication"("renderId");

-- CreateIndex
CREATE UNIQUE INDEX "Publication_platformAccountId_remotePostId_key" ON "Publication"("platformAccountId", "remotePostId");

-- CreateIndex
CREATE INDEX "PublicationAttempt_status_createdAt_idx" ON "PublicationAttempt"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PublicationAttempt_publicationId_attemptNumber_key" ON "PublicationAttempt"("publicationId", "attemptNumber");

-- CreateIndex
CREATE UNIQUE INDEX "MetricSnapshotRaw_collectionOperationId_key" ON "MetricSnapshotRaw"("collectionOperationId");

-- CreateIndex
CREATE INDEX "MetricSnapshotRaw_publicationId_collectedAt_idx" ON "MetricSnapshotRaw"("publicationId", "collectedAt");

-- CreateIndex
CREATE INDEX "MetricSnapshotRaw_platform_collectionMethod_collectedAt_idx" ON "MetricSnapshotRaw"("platform", "collectionMethod", "collectedAt");

-- CreateIndex
CREATE INDEX "MetricSnapshotNormalized_publicationId_collectedAt_idx" ON "MetricSnapshotNormalized"("publicationId", "collectedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MetricSnapshotNormalized_rawSnapshotId_normalizerVersion_key" ON "MetricSnapshotNormalized"("rawSnapshotId", "normalizerVersion");

-- CreateIndex
CREATE INDEX "AttributionEvent_eventType_occurredAt_idx" ON "AttributionEvent"("eventType", "occurredAt");

-- CreateIndex
CREATE INDEX "AttributionEvent_publicationId_occurredAt_idx" ON "AttributionEvent"("publicationId", "occurredAt");

-- CreateIndex
CREATE INDEX "AttributionEvent_campaignId_occurredAt_idx" ON "AttributionEvent"("campaignId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "AttributionEvent_sourceSystem_externalEventId_key" ON "AttributionEvent"("sourceSystem", "externalEventId");

-- CreateIndex
CREATE INDEX "Experiment_campaignId_status_idx" ON "Experiment"("campaignId", "status");

-- CreateIndex
CREATE INDEX "ExperimentArm_experimentId_idx" ON "ExperimentArm"("experimentId");

-- CreateIndex
CREATE INDEX "ExperimentArm_conceptVersionId_idx" ON "ExperimentArm"("conceptVersionId");

-- CreateIndex
CREATE INDEX "ExperimentArm_publicationId_idx" ON "ExperimentArm"("publicationId");

-- CreateIndex
CREATE INDEX "Insight_scopeType_scopeId_createdAt_idx" ON "Insight"("scopeType", "scopeId", "createdAt");

-- CreateIndex
CREATE INDEX "Recommendation_status_createdAt_idx" ON "Recommendation"("status", "createdAt");

-- CreateIndex
CREATE INDEX "WorkflowRun_status_workflowType_idx" ON "WorkflowRun"("status", "workflowType");

-- CreateIndex
CREATE INDEX "WorkflowRun_rootEntityType_rootEntityId_idx" ON "WorkflowRun"("rootEntityType", "rootEntityId");

-- CreateIndex
CREATE INDEX "JobAttempt_status_queueName_createdAt_idx" ON "JobAttempt"("status", "queueName", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "JobAttempt_operationId_attemptNumber_jobType_key" ON "JobAttempt"("operationId", "attemptNumber", "jobType");

-- CreateIndex
CREATE INDEX "OutboxEvent_status_availableAt_idx" ON "OutboxEvent"("status", "availableAt");

-- CreateIndex
CREATE INDEX "OutboxEvent_aggregateType_aggregateId_idx" ON "OutboxEvent"("aggregateType", "aggregateId");

-- CreateIndex
CREATE INDEX "ModelInvocation_purpose_createdAt_idx" ON "ModelInvocation"("purpose", "createdAt");

-- CreateIndex
CREATE INDEX "ModelInvocation_knowledgeSnapshotId_createdAt_idx" ON "ModelInvocation"("knowledgeSnapshotId", "createdAt");

-- CreateIndex
CREATE INDEX "ModelInvocation_relatedEntityType_relatedEntityId_idx" ON "ModelInvocation"("relatedEntityType", "relatedEntityId");

-- CreateIndex
CREATE INDEX "ModelInvocationAttempt_status_createdAt_idx" ON "ModelInvocationAttempt"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ModelInvocationAttempt_modelInvocationId_attemptNumber_key" ON "ModelInvocationAttempt"("modelInvocationId", "attemptNumber");

-- CreateIndex
CREATE INDEX "CostEntry_category_occurredAt_idx" ON "CostEntry"("category", "occurredAt");

-- CreateIndex
CREATE INDEX "CostEntry_relatedEntityType_relatedEntityId_idx" ON "CostEntry"("relatedEntityType", "relatedEntityId");

-- CreateIndex
CREATE INDEX "CostEntry_modelInvocationId_idx" ON "CostEntry"("modelInvocationId");

-- CreateIndex
CREATE INDEX "CostEntry_renderAttemptId_idx" ON "CostEntry"("renderAttemptId");

-- CreateIndex
CREATE INDEX "CostEntry_publicationId_idx" ON "CostEntry"("publicationId");

-- CreateIndex
CREATE INDEX "AuditEvent_subjectType_subjectId_createdAt_idx" ON "AuditEvent"("subjectType", "subjectId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_action_createdAt_idx" ON "AuditEvent"("action", "createdAt");

-- AddForeignKey
ALTER TABLE "Brief" ADD CONSTRAINT "Brief_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BriefVersion" ADD CONSTRAINT "BriefVersion_briefId_fkey" FOREIGN KEY ("briefId") REFERENCES "Brief"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Idea" ADD CONSTRAINT "Idea_briefId_fkey" FOREIGN KEY ("briefId") REFERENCES "Brief"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Idea" ADD CONSTRAINT "Idea_sourceReferenceId_fkey" FOREIGN KEY ("sourceReferenceId") REFERENCES "SourceReference"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PatternVersion" ADD CONSTRAINT "PatternVersion_patternId_fkey" FOREIGN KEY ("patternId") REFERENCES "Pattern"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Concept" ADD CONSTRAINT "Concept_ideaId_fkey" FOREIGN KEY ("ideaId") REFERENCES "Idea"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Concept" ADD CONSTRAINT "Concept_briefId_fkey" FOREIGN KEY ("briefId") REFERENCES "Brief"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConceptVersion" ADD CONSTRAINT "ConceptVersion_conceptId_fkey" FOREIGN KEY ("conceptId") REFERENCES "Concept"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConceptVersion" ADD CONSTRAINT "ConceptVersion_briefVersionId_fkey" FOREIGN KEY ("briefVersionId") REFERENCES "BriefVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConceptVersion" ADD CONSTRAINT "ConceptVersion_selectedPatternVersionId_fkey" FOREIGN KEY ("selectedPatternVersionId") REFERENCES "PatternVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConceptVersion" ADD CONSTRAINT "ConceptVersion_creatorModelInvocationId_fkey" FOREIGN KEY ("creatorModelInvocationId") REFERENCES "ModelInvocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Script" ADD CONSTRAINT "Script_conceptId_fkey" FOREIGN KEY ("conceptId") REFERENCES "Concept"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScriptVersion" ADD CONSTRAINT "ScriptVersion_scriptId_fkey" FOREIGN KEY ("scriptId") REFERENCES "Script"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScriptVersion" ADD CONSTRAINT "ScriptVersion_conceptVersionId_fkey" FOREIGN KEY ("conceptVersionId") REFERENCES "ConceptVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScriptVersion" ADD CONSTRAINT "ScriptVersion_modelInvocationId_fkey" FOREIGN KEY ("modelInvocationId") REFERENCES "ModelInvocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreativePlan" ADD CONSTRAINT "CreativePlan_conceptId_fkey" FOREIGN KEY ("conceptId") REFERENCES "Concept"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreativePlanVersion" ADD CONSTRAINT "CreativePlanVersion_creativePlanId_fkey" FOREIGN KEY ("creativePlanId") REFERENCES "CreativePlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreativePlanVersion" ADD CONSTRAINT "CreativePlanVersion_scriptVersionId_fkey" FOREIGN KEY ("scriptVersionId") REFERENCES "ScriptVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreativePlanVersion" ADD CONSTRAINT "CreativePlanVersion_templateVersionId_fkey" FOREIGN KEY ("templateVersionId") REFERENCES "TemplateVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreativePlanVersion" ADD CONSTRAINT "CreativePlanVersion_editingProfileVersionId_fkey" FOREIGN KEY ("editingProfileVersionId") REFERENCES "EditingProfileVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreativePlanVersion" ADD CONSTRAINT "CreativePlanVersion_modelInvocationId_fkey" FOREIGN KEY ("modelInvocationId") REFERENCES "ModelInvocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecordingRequest" ADD CONSTRAINT "RecordingRequest_creativePlanVersionId_fkey" FOREIGN KEY ("creativePlanVersionId") REFERENCES "CreativePlanVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recording" ADD CONSTRAINT "Recording_recordingRequestId_fkey" FOREIGN KEY ("recordingRequestId") REFERENCES "RecordingRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recording" ADD CONSTRAINT "Recording_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetDerivation" ADD CONSTRAINT "AssetDerivation_sourceAssetId_fkey" FOREIGN KEY ("sourceAssetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetDerivation" ADD CONSTRAINT "AssetDerivation_derivedAssetId_fkey" FOREIGN KEY ("derivedAssetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaptureScenarioVersion" ADD CONSTRAINT "CaptureScenarioVersion_captureScenarioId_fkey" FOREIGN KEY ("captureScenarioId") REFERENCES "CaptureScenario"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaptureRun" ADD CONSTRAINT "CaptureRun_captureScenarioVersionId_fkey" FOREIGN KEY ("captureScenarioVersionId") REFERENCES "CaptureScenarioVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaptureRun" ADD CONSTRAINT "CaptureRun_creativePlanVersionId_fkey" FOREIGN KEY ("creativePlanVersionId") REFERENCES "CreativePlanVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaptureRunAsset" ADD CONSTRAINT "CaptureRunAsset_captureRunId_fkey" FOREIGN KEY ("captureRunId") REFERENCES "CaptureRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaptureRunAsset" ADD CONSTRAINT "CaptureRunAsset_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateVersion" ADD CONSTRAINT "TemplateVersion_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Template"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateVersionAsset" ADD CONSTRAINT "TemplateVersionAsset_templateVersionId_fkey" FOREIGN KEY ("templateVersionId") REFERENCES "TemplateVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateVersionAsset" ADD CONSTRAINT "TemplateVersionAsset_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EditingProfileVersion" ADD CONSTRAINT "EditingProfileVersion_editingProfileId_fkey" FOREIGN KEY ("editingProfileId") REFERENCES "EditingProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EditingPlan" ADD CONSTRAINT "EditingPlan_creativePlanId_fkey" FOREIGN KEY ("creativePlanId") REFERENCES "CreativePlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EditingPlanVersion" ADD CONSTRAINT "EditingPlanVersion_editingPlanId_fkey" FOREIGN KEY ("editingPlanId") REFERENCES "EditingPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EditingPlanVersion" ADD CONSTRAINT "EditingPlanVersion_creativePlanVersionId_fkey" FOREIGN KEY ("creativePlanVersionId") REFERENCES "CreativePlanVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EditingPlanVersion" ADD CONSTRAINT "EditingPlanVersion_editingProfileVersionId_fkey" FOREIGN KEY ("editingProfileVersionId") REFERENCES "EditingProfileVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EditingPlanVersion" ADD CONSTRAINT "EditingPlanVersion_templateVersionId_fkey" FOREIGN KEY ("templateVersionId") REFERENCES "TemplateVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EditingPlanVersion" ADD CONSTRAINT "EditingPlanVersion_modelInvocationId_fkey" FOREIGN KEY ("modelInvocationId") REFERENCES "ModelInvocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Render" ADD CONSTRAINT "Render_editingPlanVersionId_fkey" FOREIGN KEY ("editingPlanVersionId") REFERENCES "EditingPlanVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Render" ADD CONSTRAINT "Render_approvedAssetId_fkey" FOREIGN KEY ("approvedAssetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RenderInputAsset" ADD CONSTRAINT "RenderInputAsset_renderId_fkey" FOREIGN KEY ("renderId") REFERENCES "Render"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RenderInputAsset" ADD CONSTRAINT "RenderInputAsset_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RenderAttempt" ADD CONSTRAINT "RenderAttempt_renderId_fkey" FOREIGN KEY ("renderId") REFERENCES "Render"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RenderAttempt" ADD CONSTRAINT "RenderAttempt_outputAssetId_fkey" FOREIGN KEY ("outputAssetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RenderAttempt" ADD CONSTRAINT "RenderAttempt_diagnosticAssetId_fkey" FOREIGN KEY ("diagnosticAssetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RenderAttempt" ADD CONSTRAINT "RenderAttempt_creativeQaModelInvocationId_fkey" FOREIGN KEY ("creativeQaModelInvocationId") REFERENCES "ModelInvocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_conceptVersionId_fkey" FOREIGN KEY ("conceptVersionId") REFERENCES "ConceptVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_renderId_fkey" FOREIGN KEY ("renderId") REFERENCES "Render"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Publication" ADD CONSTRAINT "Publication_renderId_fkey" FOREIGN KEY ("renderId") REFERENCES "Render"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Publication" ADD CONSTRAINT "Publication_platformAccountId_fkey" FOREIGN KEY ("platformAccountId") REFERENCES "PlatformAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Publication" ADD CONSTRAINT "Publication_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PublicationAttempt" ADD CONSTRAINT "PublicationAttempt_publicationId_fkey" FOREIGN KEY ("publicationId") REFERENCES "Publication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetricSnapshotRaw" ADD CONSTRAINT "MetricSnapshotRaw_publicationId_fkey" FOREIGN KEY ("publicationId") REFERENCES "Publication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetricSnapshotNormalized" ADD CONSTRAINT "MetricSnapshotNormalized_publicationId_fkey" FOREIGN KEY ("publicationId") REFERENCES "Publication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetricSnapshotNormalized" ADD CONSTRAINT "MetricSnapshotNormalized_rawSnapshotId_fkey" FOREIGN KEY ("rawSnapshotId") REFERENCES "MetricSnapshotRaw"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttributionEvent" ADD CONSTRAINT "AttributionEvent_publicationId_fkey" FOREIGN KEY ("publicationId") REFERENCES "Publication"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttributionEvent" ADD CONSTRAINT "AttributionEvent_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Experiment" ADD CONSTRAINT "Experiment_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExperimentArm" ADD CONSTRAINT "ExperimentArm_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "Experiment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExperimentArm" ADD CONSTRAINT "ExperimentArm_conceptVersionId_fkey" FOREIGN KEY ("conceptVersionId") REFERENCES "ConceptVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExperimentArm" ADD CONSTRAINT "ExperimentArm_publicationId_fkey" FOREIGN KEY ("publicationId") REFERENCES "Publication"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Insight" ADD CONSTRAINT "Insight_modelInvocationId_fkey" FOREIGN KEY ("modelInvocationId") REFERENCES "ModelInvocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recommendation" ADD CONSTRAINT "Recommendation_insightId_fkey" FOREIGN KEY ("insightId") REFERENCES "Insight"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobAttempt" ADD CONSTRAINT "JobAttempt_workflowRunId_fkey" FOREIGN KEY ("workflowRunId") REFERENCES "WorkflowRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModelInvocation" ADD CONSTRAINT "ModelInvocation_knowledgeSnapshotId_fkey" FOREIGN KEY ("knowledgeSnapshotId") REFERENCES "KnowledgeSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModelInvocationAttempt" ADD CONSTRAINT "ModelInvocationAttempt_modelInvocationId_fkey" FOREIGN KEY ("modelInvocationId") REFERENCES "ModelInvocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostEntry" ADD CONSTRAINT "CostEntry_modelInvocationId_fkey" FOREIGN KEY ("modelInvocationId") REFERENCES "ModelInvocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostEntry" ADD CONSTRAINT "CostEntry_renderAttemptId_fkey" FOREIGN KEY ("renderAttemptId") REFERENCES "RenderAttempt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostEntry" ADD CONSTRAINT "CostEntry_publicationId_fkey" FOREIGN KEY ("publicationId") REFERENCES "Publication"("id") ON DELETE SET NULL ON UPDATE CASCADE;
