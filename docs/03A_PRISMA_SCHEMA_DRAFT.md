# 03A — Prisma Schema Draft

> **Historical design record — not final implementation authority.**  
> Final field-level authority after spec-v0.16 is `docs/spec-artifacts/schema.prisma` plus `docs/18_FINAL_RECONCILIATION.md`.

**Status:** PROPOSED  
**Specification version:** spec-v0.3 candidate  
**Purpose:** translate the accepted Domain Model into an implementation-shaped relational schema before workflows are frozen.

---

## 1. Important

This is still a **specification artifact**, not implementation authorization.

It exists to catch:

- missing relations;
- contradictory cardinalities;
- weak uniqueness rules;
- incorrect delete behavior;
- index needs;
- places where JSON is hiding core relational data.

No application scaffolding should start from this file until this draft is reviewed and accepted.

---

## 2. Draft schema

```prisma
// Vision Content Engine — Prisma schema draft
// Status: DRAFT FOR REVIEW. Not implementation-authorized.

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum CampaignStatus {
  DRAFT
  ACTIVE
  PAUSED
  COMPLETED
  ARCHIVED
}

enum IdeaSourceType {
  USER
  BRIEF_DERIVED
  PERFORMANCE_DERIVED
  RESEARCH_DERIVED
}

enum PatternStatus {
  DRAFT
  ACTIVE
  DEPRECATED
  ARCHIVED
}

enum ConceptStatus {
  DRAFT
  AWAITING_REVIEW
  APPROVED
  REJECTED
  ARCHIVED
}

enum CreatorType {
  HUMAN
  AI
  HYBRID
}

enum VoiceMode {
  NATURAL_USER_VOICE
  NO_VOICE
  OTHER_HUMAN
  AI_VOICE
}

enum RecordingRequestType {
  VOICE
  GREEN_SCREEN_VIDEO
  SCREEN_VIDEO
  BROLL
  OTHER
}

enum RecordingRequestStatus {
  PENDING
  READY
  UPLOADED
  ACCEPTED
  REJECTED
  CANCELLED
}

enum RecordingStatus {
  UPLOADED
  SELECTED
  REJECTED
  ARCHIVED
}

enum AssetKind {
  IMAGE
  VIDEO
  AUDIO
  SUBTITLE
  JSON
  OTHER
}

enum AssetSourceType {
  UPLOAD
  RECORDING
  CAPTURE
  RENDER
  SYSTEM
  EXTERNAL
}

enum AssetStatus {
  UPLOADING
  READY
  FAILED
  QUARANTINED
  ARCHIVED
}

enum CaptureRunStatus {
  PENDING
  RUNNING
  SUCCEEDED
  FAILED
  CANCELLED
}

enum GenericLifecycleStatus {
  DRAFT
  ACTIVE
  DEPRECATED
  ARCHIVED
}

enum RenderStatus {
  REQUESTED
  QUEUED
  RENDERING
  TECHNICAL_QA
  CREATIVE_QA
  READY_FOR_REVIEW
  APPROVED
  REJECTED
  FAILED
  CANCELLED
}

enum AttemptStatus {
  QUEUED
  RUNNING
  SUCCEEDED
  FAILED
  CANCELLED
}

enum ApprovalSubjectType {
  CONCEPT
  RENDER
}

enum ApprovalDecision {
  APPROVED
  REJECTED
}

enum ApprovalActorType {
  USER
  SYSTEM
}

enum Platform {
  TIKTOK
  INSTAGRAM
  YOUTUBE
}

enum PlatformAccountStatus {
  ACTIVE
  REAUTH_REQUIRED
  DISABLED
  ERROR
}

enum PublicationStatus {
  DRAFT
  SCHEDULED
  PUBLISHING
  PUBLISHING_UNKNOWN
  PUBLISHED
  FAILED
  CANCELLED
}

enum PublicationResponseClass {
  SUCCESS
  TRANSIENT_FAILURE
  PERMANENT_FAILURE
  RATE_LIMITED
  UNKNOWN_SIDE_EFFECT
}

enum AttributionEventType {
  WEBSITE_VISIT
  SIGNUP
  ACTIVATION
  CUSTOMER
  REVENUE
}

enum AttributionConfidenceType {
  DIRECT
  INFERRED
  UNKNOWN
}

enum ExperimentStatus {
  DRAFT
  RUNNING
  COMPLETED
  CANCELLED
}

enum InsightConfidence {
  INSUFFICIENT_DATA
  WEAK_SIGNAL
  INTERESTING_SIGNAL
  FAIRLY_SOLID
}

enum RecommendationStatus {
  PROPOSED
  ACCEPTED
  REJECTED
  EXECUTED
}

enum WorkflowType {
  CONCEPT_GENERATION
  CREATIVE_PRODUCTION
  CAPTURE
  RENDER
  PUBLICATION
  ANALYTICS
  WEEKLY_ANALYSIS
}

enum WorkflowStatus {
  PENDING
  RUNNING
  WAITING
  SUCCEEDED
  FAILED
  CANCELLED
}

enum JobAttemptStatus {
  QUEUED
  RUNNING
  SUCCEEDED
  FAILED
  CANCELLED
}

enum OutboxStatus {
  PENDING
  DISPATCHING
  DISPATCHED
  FAILED
}

enum ModelInvocationStatus {
  RUNNING
  SUCCEEDED
  FAILED
  REJECTED_SCHEMA
}

enum CostCategory {
  AI
  RENDER
  STORAGE
  BANDWIDTH
  PLATFORM
  OTHER
}

enum AuditActorType {
  USER
  SYSTEM
  WORKER
  AI
}

model Campaign {
  id          String         @id @default(cuid())
  name        String
  slug        String         @unique
  objective   String?
  status      CampaignStatus @default(DRAFT)
  startsAt    DateTime?
  endsAt      DateTime?
  createdAt   DateTime       @default(now())
  updatedAt   DateTime       @updatedAt

  briefs      Brief[]
  experiments Experiment[]
  attributionEvents AttributionEvent[]

  @@index([status, startsAt])
}

model Brief {
  id                 String   @id @default(cuid())
  campaignId         String
  title              String
  goal               String?
  audience           String?
  notes              String?
  priority           Int      @default(0)
  status             String   @default("DRAFT")
  topics             Json?
  productAreas       Json?
  mustMention        Json?
  mustAvoid          Json?
  preferredFormats   Json?
  targetPlatforms    Json?
  targetContentCount Int?
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt

  campaign           Campaign @relation(fields: [campaignId], references: [id], onDelete: Restrict)
  versions           BriefVersion[]
  ideas              Idea[]
  concepts           Concept[]

  @@index([campaignId, status])
}

model BriefVersion {
  id        String   @id @default(cuid())
  briefId   String
  version   Int
  payloadJson Json
  createdAt DateTime @default(now())
  createdBy String?

  brief     Brief @relation(fields: [briefId], references: [id], onDelete: Restrict)
  conceptVersions ConceptVersion[]

  @@unique([briefId, version])
}

model Idea {
  id                String         @id @default(cuid())
  briefId           String?
  title             String
  description       String?
  sourceType        IdeaSourceType
  sourceReferenceId String?
  status            String         @default("ACTIVE")
  createdAt         DateTime       @default(now())
  updatedAt         DateTime       @updatedAt

  brief             Brief?         @relation(fields: [briefId], references: [id], onDelete: SetNull)
  concepts          Concept[]

  @@index([briefId])
  @@index([sourceType])
}

model Pattern {
  id        String        @id @default(cuid())
  key       String        @unique
  name      String
  category  String?
  status    PatternStatus @default(DRAFT)
  createdAt DateTime      @default(now())
  updatedAt DateTime      @updatedAt

  versions  PatternVersion[]
}

model PatternVersion {
  id                 String   @id @default(cuid())
  patternId          String
  version            Int
  description        String?
  whenToUse          String?
  audienceFitJson    Json?
  hookStructureJson  Json?
  storyStructureJson Json?
  visualStructureJson Json?
  ctaStyleJson       Json?
  constraintsJson    Json?
  knownRisksJson     Json?
  examplesJson       Json?
  sourceType         String?
  sourceMetadataJson Json?
  confidence         Float?
  createdAt          DateTime @default(now())
  createdBy          String?

  pattern            Pattern @relation(fields: [patternId], references: [id], onDelete: Restrict)
  conceptVersions    ConceptVersion[]

  @@unique([patternId, version])
}

model Concept {
  id        String        @id @default(cuid())
  ideaId    String?
  briefId   String
  status    ConceptStatus @default(DRAFT)
  createdAt DateTime      @default(now())
  updatedAt DateTime      @updatedAt

  idea      Idea? @relation(fields: [ideaId], references: [id], onDelete: SetNull)
  brief     Brief @relation(fields: [briefId], references: [id], onDelete: Restrict)
  versions  ConceptVersion[]
  script    Script?
  creativePlan CreativePlan?

  @@index([briefId, status])
  @@index([ideaId])
}

model ConceptVersion {
  id                       String   @id @default(cuid())
  conceptId                String
  briefVersionId           String
  version                  Int
  title                    String
  angle                    String?
  hook                     String?
  audience                 String?
  objective                String?
  hypothesis               String?
  selectedPatternVersionId String?
  rationale                String?
  creatorType              CreatorType
  creatorModelInvocationId String?
  createdAt                DateTime @default(now())

  concept                  Concept @relation(fields: [conceptId], references: [id], onDelete: Restrict)
  briefVersion             BriefVersion @relation(fields: [briefVersionId], references: [id], onDelete: Restrict)
  selectedPatternVersion   PatternVersion? @relation(fields: [selectedPatternVersionId], references: [id], onDelete: SetNull)
  creatorModelInvocation   ModelInvocation? @relation("ConceptCreatorInvocation", fields: [creatorModelInvocationId], references: [id], onDelete: SetNull)
  approvals                Approval[] @relation("ConceptVersionApprovals")
  experimentArms           ExperimentArm[]

  @@unique([conceptId, version])
  @@index([selectedPatternVersionId])
}

model Script {
  id        String   @id @default(cuid())
  conceptId String   @unique
  status    String   @default("ACTIVE")
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  concept   Concept @relation(fields: [conceptId], references: [id], onDelete: Restrict)
  versions  ScriptVersion[]
}

model ScriptVersion {
  id                String    @id @default(cuid())
  scriptId          String
  version           Int
  language          String    @default("fr")
  fullText          String
  segmentsJson      Json?
  estimatedDurationMs Int?
  voiceMode         VoiceMode @default(NATURAL_USER_VOICE)
  createdAt         DateTime  @default(now())
  createdByType     CreatorType
  modelInvocationId String?

  script            Script @relation(fields: [scriptId], references: [id], onDelete: Restrict)
  modelInvocation   ModelInvocation? @relation("ScriptInvocation", fields: [modelInvocationId], references: [id], onDelete: SetNull)
  creativePlanVersions CreativePlanVersion[]

  @@unique([scriptId, version])
}

model CreativePlan {
  id        String   @id @default(cuid())
  conceptId String   @unique
  status    String   @default("ACTIVE")
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  concept   Concept @relation(fields: [conceptId], references: [id], onDelete: Restrict)
  versions  CreativePlanVersion[]
  editingPlan EditingPlan?
}

model CreativePlanVersion {
  id                     String   @id @default(cuid())
  creativePlanId         String
  version                Int
  scriptVersionId        String
  targetDurationMs       Int?
  primaryFormat          String
  templateFamily         String?
  editingProfileKey      String?
  scenePlanJson          Json
  requiredRecordingsJson Json?
  requiredCapturesJson   Json?
  requiredAssetsJson     Json?
  ctaJson                Json?
  platformConsiderationsJson Json?
  modelInvocationId      String?
  createdAt              DateTime @default(now())

  creativePlan           CreativePlan @relation(fields: [creativePlanId], references: [id], onDelete: Restrict)
  scriptVersion          ScriptVersion @relation(fields: [scriptVersionId], references: [id], onDelete: Restrict)
  modelInvocation        ModelInvocation? @relation("CreativePlanInvocation", fields: [modelInvocationId], references: [id], onDelete: SetNull)
  recordingRequests      RecordingRequest[]
  captureRuns            CaptureRun[]
  editingPlanVersions    EditingPlanVersion[]

  @@unique([creativePlanId, version])
}

model RecordingRequest {
  id                    String                 @id @default(cuid())
  creativePlanVersionId String
  type                  RecordingRequestType
  title                 String
  instructions          String?
  scriptSegmentRef      String?
  shotInstructionsJson  Json?
  status                RecordingRequestStatus @default(PENDING)
  createdAt             DateTime               @default(now())
  completedAt           DateTime?

  creativePlanVersion   CreativePlanVersion @relation(fields: [creativePlanVersionId], references: [id], onDelete: Restrict)
  recordings            Recording[]

  @@index([creativePlanVersionId, status])
}

model Recording {
  id                 String          @id @default(cuid())
  recordingRequestId String
  assetId            String
  takeNumber         Int
  status             RecordingStatus @default(UPLOADED)
  notes              String?
  createdAt          DateTime        @default(now())

  recordingRequest   RecordingRequest @relation(fields: [recordingRequestId], references: [id], onDelete: Restrict)
  asset              Asset            @relation(fields: [assetId], references: [id], onDelete: Restrict)

  @@unique([recordingRequestId, takeNumber])
  @@index([assetId])
}

model Asset {
  id               String          @id @default(cuid())
  kind             AssetKind
  storageProvider  String
  bucket           String
  objectKey        String          @unique
  checksumSha256   String?
  mimeType         String?
  sizeBytes        BigInt?
  width            Int?
  height           Int?
  durationMs       Int?
  fps              Float?
  audioChannels    Int?
  sampleRate       Int?
  status           AssetStatus     @default(UPLOADING)
  sourceType       AssetSourceType
  sourceEntityType String?
  sourceEntityId   String?
  createdAt        DateTime        @default(now())
  deletedAt        DateTime?

  recordings       Recording[]
  renderOutputs    RenderAttempt[] @relation("RenderOutputAsset")
  renderDiagnostics RenderAttempt[] @relation("RenderDiagnosticAsset")
  approvedForRenders Render[] @relation("ApprovedRenderAsset")
  captureTraceFor  CaptureRun[] @relation("CaptureTraceAsset")

  @@index([sourceEntityType, sourceEntityId])
  @@index([status, createdAt])
}

model CaptureScenario {
  id        String                 @id @default(cuid())
  key       String                 @unique
  name      String
  status    GenericLifecycleStatus @default(DRAFT)
  createdAt DateTime               @default(now())
  updatedAt DateTime               @updatedAt

  versions  CaptureScenarioVersion[]
}

model CaptureScenarioVersion {
  id                String   @id @default(cuid())
  captureScenarioId String
  version           Int
  targetEnvironment String
  stepsJson         Json
  inputSchemaJson   Json?
  outputSpecJson    Json?
  browserConfigJson Json?
  createdAt         DateTime @default(now())
  createdBy         String?

  captureScenario   CaptureScenario @relation(fields: [captureScenarioId], references: [id], onDelete: Restrict)
  runs              CaptureRun[]

  @@unique([captureScenarioId, version])
}

model CaptureRun {
  id                       String           @id @default(cuid())
  captureScenarioVersionId String
  creativePlanVersionId    String?
  operationId              String           @unique
  status                   CaptureRunStatus @default(PENDING)
  startedAt                DateTime?
  finishedAt               DateTime?
  failureCode              String?
  failureMessage           String?
  traceAssetId             String?
  createdAt                DateTime         @default(now())

  captureScenarioVersion   CaptureScenarioVersion @relation(fields: [captureScenarioVersionId], references: [id], onDelete: Restrict)
  creativePlanVersion      CreativePlanVersion? @relation(fields: [creativePlanVersionId], references: [id], onDelete: SetNull)
  traceAsset               Asset? @relation("CaptureTraceAsset", fields: [traceAssetId], references: [id], onDelete: SetNull)

  @@index([status, createdAt])
}

model Template {
  id        String                 @id @default(cuid())
  key       String                 @unique
  name      String
  category  String?
  status    GenericLifecycleStatus @default(DRAFT)
  createdAt DateTime               @default(now())
  updatedAt DateTime               @updatedAt

  versions  TemplateVersion[]
}

model TemplateVersion {
  id                       String   @id @default(cuid())
  templateId               String
  version                  Int
  inputSchemaJson          Json
  supportedAspectRatiosJson Json?
  minDurationMs            Int?
  maxDurationMs            Int?
  requiredSlotsJson        Json?
  optionalSlotsJson        Json?
  capabilitiesJson         Json?
  rendererVersion          String
  sourceRevision           String?
  createdAt                DateTime @default(now())

  template                 Template @relation(fields: [templateId], references: [id], onDelete: Restrict)
  editingPlanVersions      EditingPlanVersion[]

  @@unique([templateId, version])
}

model EditingProfile {
  id        String                 @id @default(cuid())
  key       String                 @unique
  name      String
  status    GenericLifecycleStatus @default(DRAFT)
  createdAt DateTime               @default(now())
  updatedAt DateTime               @updatedAt

  versions  EditingProfileVersion[]
}

model EditingProfileVersion {
  id                String   @id @default(cuid())
  editingProfileId  String
  version           Int
  pacingRulesJson   Json?
  cutRulesJson      Json?
  captionRulesJson  Json?
  focusRulesJson    Json?
  motionRulesJson   Json?
  soundRulesJson    Json?
  hookRulesJson     Json?
  endingRulesJson   Json?
  greenScreenRulesJson Json?
  createdAt         DateTime @default(now())

  editingProfile    EditingProfile @relation(fields: [editingProfileId], references: [id], onDelete: Restrict)
  editingPlanVersions EditingPlanVersion[]

  @@unique([editingProfileId, version])
}

model EditingPlan {
  id             String   @id @default(cuid())
  creativePlanId String   @unique
  status         String   @default("ACTIVE")
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  creativePlan   CreativePlan @relation(fields: [creativePlanId], references: [id], onDelete: Restrict)
  versions       EditingPlanVersion[]
}

model EditingPlanVersion {
  id                      String   @id @default(cuid())
  editingPlanId           String
  version                 Int
  creativePlanVersionId   String
  editingProfileVersionId String
  templateVersionId       String
  timelineJson            Json
  captionPlanJson         Json?
  audioPlanJson           Json?
  visualFocusJson         Json?
  transitionPlanJson      Json?
  greenScreenPlanJson     Json?
  renderSettingsJson      Json?
  modelInvocationId       String?
  createdAt               DateTime @default(now())

  editingPlan             EditingPlan @relation(fields: [editingPlanId], references: [id], onDelete: Restrict)
  creativePlanVersion     CreativePlanVersion @relation(fields: [creativePlanVersionId], references: [id], onDelete: Restrict)
  editingProfileVersion   EditingProfileVersion @relation(fields: [editingProfileVersionId], references: [id], onDelete: Restrict)
  templateVersion         TemplateVersion @relation(fields: [templateVersionId], references: [id], onDelete: Restrict)
  modelInvocation         ModelInvocation? @relation("EditingPlanInvocation", fields: [modelInvocationId], references: [id], onDelete: SetNull)
  renders                 Render[]

  @@unique([editingPlanId, version])
  @@index([creativePlanVersionId])
}

model Render {
  id                   String       @id @default(cuid())
  editingPlanVersionId String
  operationId          String       @unique
  status               RenderStatus @default(REQUESTED)
  approvedAssetId      String?
  createdAt            DateTime     @default(now())
  updatedAt            DateTime     @updatedAt

  editingPlanVersion   EditingPlanVersion @relation(fields: [editingPlanVersionId], references: [id], onDelete: Restrict)
  approvedAsset        Asset? @relation("ApprovedRenderAsset", fields: [approvedAssetId], references: [id], onDelete: SetNull)
  attempts             RenderAttempt[]
  approvals            Approval[] @relation("RenderApprovals")
  publications         Publication[]

  @@index([status, createdAt])
}

model RenderAttempt {
  id                String        @id @default(cuid())
  renderId          String
  attemptNumber     Int
  status            AttemptStatus @default(QUEUED)
  workerVersion     String?
  rendererVersion   String?
  startedAt         DateTime?
  finishedAt        DateTime?
  failureCode       String?
  failureMessage    String?
  outputAssetId     String?
  diagnosticAssetId String?
  technicalQaJson   Json?
  createdAt         DateTime      @default(now())

  render            Render @relation(fields: [renderId], references: [id], onDelete: Restrict)
  outputAsset       Asset? @relation("RenderOutputAsset", fields: [outputAssetId], references: [id], onDelete: SetNull)
  diagnosticAsset   Asset? @relation("RenderDiagnosticAsset", fields: [diagnosticAssetId], references: [id], onDelete: SetNull)
  costEntries       CostEntry[]

  @@unique([renderId, attemptNumber])
  @@index([status, createdAt])
}

model Approval {
  id               String              @id @default(cuid())
  subjectType      ApprovalSubjectType
  subjectId        String
  subjectVersionId String?
  decision         ApprovalDecision
  reasonCode       String?
  comment          String?
  actorType        ApprovalActorType
  actorId          String?
  createdAt        DateTime            @default(now())

  conceptVersionId String?
  renderId         String?

  conceptVersion   ConceptVersion? @relation("ConceptVersionApprovals", fields: [conceptVersionId], references: [id], onDelete: Restrict)
  render           Render? @relation("RenderApprovals", fields: [renderId], references: [id], onDelete: Restrict)

  @@index([subjectType, subjectId, createdAt])
}

model PlatformAccount {
  id               String                @id @default(cuid())
  platform         Platform
  displayName      String
  remoteAccountId  String
  status           PlatformAccountStatus @default(ACTIVE)
  credentialsRef   String
  capabilitiesJson Json?
  createdAt        DateTime              @default(now())
  updatedAt        DateTime              @updatedAt

  publications     Publication[]

  @@unique([platform, remoteAccountId])
}

model Publication {
  id                String            @id @default(cuid())
  renderId          String
  platformAccountId String
  operationId       String            @unique
  status            PublicationStatus @default(DRAFT)
  scheduledAt       DateTime?
  publishedAt       DateTime?
  remotePostId      String?
  remoteUrl         String?
  metadataJson      Json
  createdAt         DateTime          @default(now())
  updatedAt         DateTime          @updatedAt

  render            Render @relation(fields: [renderId], references: [id], onDelete: Restrict)
  platformAccount   PlatformAccount @relation(fields: [platformAccountId], references: [id], onDelete: Restrict)
  attempts          PublicationAttempt[]
  rawMetrics        MetricSnapshotRaw[]
  normalizedMetrics MetricSnapshotNormalized[]
  attributionEvents AttributionEvent[]
  experimentArms    ExperimentArm[]
  costEntries       CostEntry[]

  @@unique([platformAccountId, remotePostId])
  @@index([status, scheduledAt])
  @@index([platformAccountId, publishedAt])
}

model PublicationAttempt {
  id                   String                   @id @default(cuid())
  publicationId        String
  attemptNumber        Int
  status               AttemptStatus            @default(QUEUED)
  startedAt            DateTime?
  finishedAt           DateTime?
  remoteRequestId      String?
  remotePostId         String?
  responseClass        PublicationResponseClass?
  responseMetadataJson Json?
  failureCode          String?
  failureMessage       String?
  createdAt            DateTime                 @default(now())

  publication          Publication @relation(fields: [publicationId], references: [id], onDelete: Restrict)

  @@unique([publicationId, attemptNumber])
}

model MetricSnapshotRaw {
  id                    String   @id @default(cuid())
  publicationId         String
  platform              Platform
  collectedAt           DateTime
  providerSchemaVersion String?
  payloadJson           Json
  payloadHash           String?
  createdAt             DateTime @default(now())

  publication           Publication @relation(fields: [publicationId], references: [id], onDelete: Restrict)
  normalizedSnapshots   MetricSnapshotNormalized[]

  @@index([publicationId, collectedAt])
}

model MetricSnapshotNormalized {
  id                   String   @id @default(cuid())
  publicationId        String
  rawSnapshotId        String?
  collectedAt          DateTime
  views                BigInt?
  likes                BigInt?
  comments             BigInt?
  shares               BigInt?
  saves                BigInt?
  watchTimeMs          BigInt?
  avgWatchDurationMs   Int?
  avgWatchPercentage   Float?
  completionRate       Float?
  profileVisits        BigInt?
  websiteClicks        BigInt?
  otherMetricsJson     Json?
  normalizerVersion    String
  createdAt            DateTime @default(now())

  publication          Publication @relation(fields: [publicationId], references: [id], onDelete: Restrict)
  rawSnapshot          MetricSnapshotRaw? @relation(fields: [rawSnapshotId], references: [id], onDelete: SetNull)

  @@index([publicationId, collectedAt])
}

model AttributionEvent {
  id                String                    @id @default(cuid())
  publicationId     String?
  campaignId        String?
  eventType         AttributionEventType
  occurredAt        DateTime
  source            String?
  confidenceType    AttributionConfidenceType
  externalVisitorId String?
  userId            String?
  metadataJson      Json?
  createdAt         DateTime                  @default(now())

  publication       Publication? @relation(fields: [publicationId], references: [id], onDelete: SetNull)
  campaign          Campaign? @relation(fields: [campaignId], references: [id], onDelete: SetNull)

  @@index([eventType, occurredAt])
  @@index([publicationId, occurredAt])
}

model Experiment {
  id            String           @id @default(cuid())
  campaignId    String?
  name          String
  hypothesis    String
  primaryMetric String?
  status        ExperimentStatus @default(DRAFT)
  startedAt     DateTime?
  endedAt       DateTime?
  createdAt     DateTime         @default(now())

  campaign      Campaign? @relation(fields: [campaignId], references: [id], onDelete: SetNull)
  arms          ExperimentArm[]

  @@index([campaignId, status])
}

model ExperimentArm {
  id               String   @id @default(cuid())
  experimentId     String
  label            String
  conceptVersionId String?
  publicationId    String?
  variablesJson    Json
  createdAt        DateTime @default(now())

  experiment       Experiment @relation(fields: [experimentId], references: [id], onDelete: Restrict)
  conceptVersion   ConceptVersion? @relation(fields: [conceptVersionId], references: [id], onDelete: SetNull)
  publication      Publication? @relation(fields: [publicationId], references: [id], onDelete: SetNull)

  @@index([experimentId])
}

model Insight {
  id                String            @id @default(cuid())
  scopeType         String
  scopeId           String?
  statement         String
  confidence        InsightConfidence
  evidenceJson      Json
  limitationsJson   Json?
  createdAt         DateTime          @default(now())
  modelInvocationId String?

  modelInvocation   ModelInvocation? @relation("InsightInvocation", fields: [modelInvocationId], references: [id], onDelete: SetNull)
  recommendations   Recommendation[]

  @@index([scopeType, scopeId, createdAt])
}

model Recommendation {
  id                  String               @id @default(cuid())
  insightId           String?
  title               String
  description         String?
  recommendedTestJson Json?
  status              RecommendationStatus @default(PROPOSED)
  createdAt           DateTime             @default(now())

  insight             Insight? @relation(fields: [insightId], references: [id], onDelete: SetNull)
}

model WorkflowRun {
  id             String         @id @default(cuid())
  workflowType   WorkflowType
  rootEntityType String
  rootEntityId   String
  status         WorkflowStatus @default(PENDING)
  currentStep    String?
  startedAt      DateTime?
  finishedAt     DateTime?
  createdAt      DateTime       @default(now())
  updatedAt      DateTime       @updatedAt

  jobAttempts    JobAttempt[]

  @@index([status, workflowType])
  @@index([rootEntityType, rootEntityId])
}

model JobAttempt {
  id             String           @id @default(cuid())
  workflowRunId  String?
  queueName      String
  jobType        String
  operationId    String
  bullJobId      String?
  attemptNumber  Int
  status         JobAttemptStatus @default(QUEUED)
  workerId       String?
  startedAt      DateTime?
  finishedAt     DateTime?
  failureCode    String?
  failureMessage String?
  createdAt      DateTime         @default(now())

  workflowRun    WorkflowRun? @relation(fields: [workflowRunId], references: [id], onDelete: SetNull)

  @@unique([operationId, attemptNumber, jobType])
  @@index([status, queueName, createdAt])
}

model OutboxEvent {
  id            String       @id @default(cuid())
  eventType     String
  aggregateType String
  aggregateId   String
  payloadJson   Json
  status        OutboxStatus @default(PENDING)
  attemptCount  Int          @default(0)
  availableAt   DateTime     @default(now())
  dispatchedAt  DateTime?
  lastError     String?
  createdAt     DateTime     @default(now())

  @@index([status, availableAt])
  @@index([aggregateType, aggregateId])
}

model ModelInvocation {
  id                  String                @id @default(cuid())
  purpose             String
  provider            String
  model               String
  promptKey           String
  promptVersion       String
  inputSchemaVersion  String
  outputSchemaVersion String
  status              ModelInvocationStatus @default(RUNNING)
  inputHash           String
  outputHash          String?
  inputTokens         Int?
  outputTokens        Int?
  cachedInputTokens   Int?
  latencyMs           Int?
  costAmount          Decimal?              @db.Decimal(18, 8)
  costCurrency        String?
  relatedEntityType   String?
  relatedEntityId     String?
  startedAt           DateTime
  finishedAt          DateTime?
  failureCode         String?
  createdAt           DateTime              @default(now())

  conceptVersions     ConceptVersion[] @relation("ConceptCreatorInvocation")
  scriptVersions      ScriptVersion[] @relation("ScriptInvocation")
  creativePlanVersions CreativePlanVersion[] @relation("CreativePlanInvocation")
  editingPlanVersions EditingPlanVersion[] @relation("EditingPlanInvocation")
  insights            Insight[] @relation("InsightInvocation")
  costEntries         CostEntry[]

  @@index([purpose, createdAt])
  @@index([relatedEntityType, relatedEntityId])
}

model CostEntry {
  id                String       @id @default(cuid())
  category          CostCategory
  provider          String?
  amount            Decimal      @db.Decimal(18, 8)
  currency          String
  quantity          Decimal?     @db.Decimal(18, 8)
  unit              String?
  relatedEntityType String?
  relatedEntityId   String?
  modelInvocationId String?
  renderAttemptId   String?
  publicationId     String?
  occurredAt        DateTime
  createdAt         DateTime     @default(now())
  metadataJson      Json?

  modelInvocation   ModelInvocation? @relation(fields: [modelInvocationId], references: [id], onDelete: SetNull)
  renderAttempt     RenderAttempt? @relation(fields: [renderAttemptId], references: [id], onDelete: SetNull)
  publication       Publication? @relation(fields: [publicationId], references: [id], onDelete: SetNull)

  @@index([category, occurredAt])
  @@index([relatedEntityType, relatedEntityId])
}

model AuditEvent {
  id               String         @id @default(cuid())
  actorType        AuditActorType
  actorId          String?
  action           String
  subjectType      String
  subjectId        String
  subjectVersionId String?
  beforeJson       Json?
  afterJson        Json?
  metadataJson     Json?
  createdAt        DateTime       @default(now())

  @@index([subjectType, subjectId, createdAt])
  @@index([action, createdAt])
}

```

---

## 3. Review notes

### 3.1 Intentionally generic fields still to refine later

Some lifecycle/status fields are still strings where their exact enum belongs to the workflow specification, for example:

- Brief.status
- Idea.status
- Script.status
- CreativePlan.status
- EditingPlan.status

This is deliberate. `04_WORKFLOWS.md` must freeze those states before they become Prisma enums.

### 3.2 Approval polymorphism

Prisma does not provide generic foreign keys.

The draft therefore keeps:

- generic `subjectType/subjectId`
- plus optional explicit relations for V1 subjects (`conceptVersionId`, `renderId`)

Before implementation we should either:
1. keep this hybrid approach; or
2. use separate `ConceptApproval` / `RenderApproval` models.

Recommended V1 direction: keep one Approval table with explicit nullable FK columns for supported subjects.

### 3.3 Asset provenance

`Asset.sourceEntityType/sourceEntityId` remains generic for audit/provenance search.

Core strong relations (Recording → Asset, RenderAttempt → Asset, CaptureRun trace → Asset) remain relational.

### 3.4 Capture output assets

The accepted Domain Model says a CaptureRun produces many Assets.

The current draft intentionally does **not** yet add a `CaptureRunAsset` join model because we should first decide whether one asset can belong to multiple capture runs.

Recommended direction:
- add `CaptureRunAsset` in the final schema;
- include `role` (`SCREENSHOT`, `VIDEO`, `FRAME`, `TRACE`, etc.).

### 3.5 Render input asset lineage

The current draft links a Render to its EditingPlanVersion and output assets.

It does not yet have the explicit many-to-many set of exact input Asset IDs consumed by a render.

Recommended direction:
- add `RenderInputAsset(renderId, assetId, role)`;
- this is important for exact reproducibility.

### 3.6 Template-owned assets

A future `TemplateAsset` join model may be required so a TemplateVersion can pin exact fonts/icons/backgrounds/music.

Do not rely on mutable filesystem paths.

### 3.7 Credential storage

`PlatformAccount.credentialsRef` is only a reference to secret storage/encrypted credentials.

Raw OAuth tokens must not be stored in this plain field.

### 3.8 Remote post uniqueness and NULL

`@@unique([platformAccountId, remotePostId])` is appropriate only when remotePostId is present.
PostgreSQL allows multiple NULL values, which is desirable before publication.

### 3.9 Monetary values

Decimal is used for costs instead of floating point.

### 3.10 IDs

`cuid()` is a placeholder implementation choice.

Before implementation we must choose consistently between:
- CUID2-like opaque IDs;
- UUID v7 / UUID;
- another sortable opaque ID strategy.

The domain only requires stable opaque identifiers.

---

## 4. Missing pieces to resolve before acceptance

- [ ] Decide final ID strategy.
- [ ] Add `CaptureRunAsset`.
- [ ] Add `RenderInputAsset`.
- [ ] Decide whether TemplateVersion pins exact asset records.
- [ ] Validate Approval polymorphism approach.
- [ ] Freeze lifecycle enums after workflow specification where necessary.
- [ ] Decide whether BriefVersion payload snapshot plus relational Brief fields is sufficient.
- [ ] Confirm delete policies on every published-lineage relation.
- [ ] Validate all indexes against expected worker/dashboard queries.
- [ ] Run `prisma format` / `prisma validate` once a minimal implementation workspace exists.

## 5. Acceptance gate

The Prisma draft is accepted only when:
- the missing join models are resolved;
- no core lineage is hidden in unqueryable JSON;
- all V1 cardinalities are clear;
- delete policies preserve historical truth;
- workflow-dependent enums have an explicit owner/spec;
- the schema can be validated by Prisma during the implementation bootstrap phase.
