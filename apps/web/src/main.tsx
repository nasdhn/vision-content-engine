import { StrictMode, useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent, FormEvent, MouseEvent, ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

type Take = {
  id: string;
  assetId: string;
  number: number;
  status: string;
  assetStatus: string;
  kind: string;
  durationMs: number | null;
  warnings: string[];
};

type RecordingRequest = {
  id: string;
  title: string;
  status: string;
  type: string;
  instructions: string;
  text: string;
  targetDurationSec?: number;
  shot: {
    framing?: string;
    presenterPosition?: string;
    gestureDirection?: string;
    background?: string;
    eyeLine?: string;
  };
  takes: Take[];
};

type Pack = {
  versionId: string;
  version: number;
  status: string;
  requests: RecordingRequest[];
};

type DashboardSummary = {
  generatedAt: string;
  counts: {
    needsAttention: number;
    conceptsAwaitingReview: number;
    activeProduction: number;
    rendersReadyForReview: number;
  };
  recentChanges: {
    id: string;
    action: string;
    subjectType: string;
    subjectId: string;
    subjectVersionId: string | null;
    createdAt: string;
  }[];
};

type AttentionItem = {
  id: string;
  kind: string;
  severity: 'ACTION' | 'ERROR';
  title: string;
  reason: string;
  affectedEntity: { type: string; id: string };
  createdAt: string;
  recommendedAction: string;
  targetRoute: string;
};

type ConceptReviewItem = {
  conceptId: string;
  conceptVersionId: string;
  version: number;
  title: string;
  hook: string | null;
  angle: string | null;
  audience: string | null;
  objective: string | null;
  hypothesis: string | null;
  rationale: string | null;
  createdAt: string;
  pattern: { id: string; key: string; name: string; version: number } | null;
  brief: {
    id: string;
    title: string;
    goal: string | null;
    audience: string | null;
    campaign: { id: string; name: string; slug: string };
  };
};

type ConceptReviewDetail = ConceptReviewItem & {
  status: string;
  latestConceptVersionId: string;
  isLatest: boolean;
  decisionAllowed: boolean;
  previousDecision: {
    id: string;
    decision: string;
    reasonCode: string | null;
    comment: string | null;
    createdAt: string;
  } | null;
};

type ProductionStage = 'WAITING_FOR_ME' | 'CAPTURING' | 'EDITING' | 'RENDERING' | 'FAILED' | 'DONE';

type ProductionItem = {
  creativePlanId: string;
  creativePlanVersionId: string;
  version: number;
  status: string;
  title: string;
  hook: string | null;
  campaignName: string;
  primaryFormat: string;
  targetDurationMs: number | null;
  stage: ProductionStage;
  nextAction: string;
  recordings: {
    total: number;
    pending: number;
    readyToRecord: number;
    uploaded: number;
    accepted: number;
  };
  capture: {
    id: string;
    status: string;
    failureCode: string | null;
    createdAt: string;
  } | null;
  blocker: {
    id: string;
    reasonCode: string;
    recoverability: string;
    createdAt: string;
  } | null;
  editing: {
    editingPlanVersionId: string;
    status: string;
    version: number;
  } | null;
  render: {
    id: string;
    status: string;
    attemptStatus: string | null;
    technicalQaResult: string | null;
    creativeQaResult: string | null;
  } | null;
  createdAt: string;
};

type ProductionDetail = ProductionItem & {
  script: {
    scriptVersionId: string;
    fullText: string;
    estimatedDurationMs: number | null;
    voiceMode: string;
  };
  template: { key: string; name: string; version: number };
  editingProfile: { key: string; name: string; version: number };
  recordingRequests: {
    id: string;
    title: string;
    type: string;
    status: string;
    takeCount: number;
    selectedTakeCount: number;
  }[];
  captures: {
    id: string;
    status: string;
    failureCode: string | null;
    startedAt: string | null;
    finishedAt: string | null;
    createdAt: string;
  }[];
  blockers: {
    id: string;
    reasonCode: string;
    recoverability: string;
    createdAt: string;
  }[];
  renderDetail: {
    id: string;
    status: string;
    attemptNumber: number | null;
    attemptStatus: string | null;
    failureCode: string | null;
    technicalQaResult: string | null;
    creativeQaResult: string | null;
  } | null;
};

type RenderReviewItem = {
  renderId: string;
  status: string;
  title: string;
  hook: string | null;
  creativePlanVersionId: string;
  creativePlanVersion: number;
  primaryFormat: string;
  targetDurationMs: number | null;
  creativeQaResult: 'PASS' | 'PASS_WITH_WARNINGS';
  creativeQaSummary: string;
  issueCount: number;
  createdAt: string;
};

type RenderReviewDetail = RenderReviewItem & {
  decisionAllowed: boolean;
  concept: {
    angle: string | null;
    audience: string | null;
    objective: string | null;
    hypothesis: string | null;
    rationale: string | null;
  };
  script: {
    fullText: string;
    estimatedDurationMs: number | null;
    voiceMode: string;
  };
  cta: unknown;
  platformIntent: unknown;
  creativeQa: {
    result: 'PASS' | 'PASS_WITH_WARNINGS';
    summary: string;
    evaluatedDimensions: string[];
    notEvaluatedDimensions: string[];
    issues: {
      code: string;
      severity: 'WARNING' | 'ERROR';
      startMs: number | null;
      endMs: number | null;
      explanation: string;
      suggestedFix: string | null;
    }[];
  };
  technicalQa: {
    result: 'PASS';
    durationMs: number;
    width: number | null;
    height: number | null;
    fps: number | null;
    rendererVersion: string;
    colorProfileKey: string;
    codecProfileKey: string;
    audioProfileKey: string;
    checks: { key: string; status: string; message: string | null }[];
  };
  lineage: {
    editingPlanVersionId: string;
    creativePlanVersionId: string;
    renderAttemptId: string;
    attemptNumber: number;
    outputAssetId: string;
    approvedAssetId: string | null;
  };
  previousDecision: {
    id: string;
    decision: string;
    reasonCode: string | null;
    comment: string | null;
    createdAt: string;
  } | null;
};

type PublicationReadItem = {
  publicationId: string;
  renderId: string;
  platform: string;
  accountName: string;
  accountStatus: string;
  deliveryMode: string;
  status: string;
  scheduledAt: string | null;
  publishedAt: string | null;
  remoteUrl: string | null;
  mediaAssetId: string | null;
  createdAt: string;
  updatedAt: string;
};

type CalendarReadModel = {
  readOnly: true;
  schedulingAvailable: false;
  entries: PublicationReadItem[];
};

type PublishedReadModel = {
  readOnly: true;
  remotePublishingAvailable: false;
  entries: PublicationReadItem[];
};

type ManualHandoffItem = {
  publicationId: string;
  accountName: string;
  status: string;
  scheduledAt: string;
  captionPreview: string;
  hashtagCount: number;
  commercialDisclosureReminder: boolean;
};

type ManualHandoffDetail = ManualHandoffItem & {
  completionAllowed: boolean;
  publishedAt: string | null;
  remoteUrl: string | null;
  metadata: {
    caption: string;
    hashtags: string[];
    ctaNotes: string | null;
    coverRecommendation: string | null;
    commercialDisclosureReminder: boolean;
  };
  media: {
    assetId: string;
    mimeType: string;
    sizeBytes: string;
    width: number | null;
    height: number | null;
    durationMs: number | null;
  };
};

type AssetReadItem = {
  assetId: string;
  kind: string;
  status: string;
  sourceType: string;
  sourceEntityType: string | null;
  sourceEntityId: string | null;
  mimeType: string | null;
  sizeBytes: string | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  fps: number | null;
  audioChannels: number | null;
  sampleRate: number | null;
  createdAt: string;
  deletedAt: string | null;
  usage: {
    recordings: number;
    captureRuns: number;
    renderInputs: number;
    templateVersions: number;
    renderOutputs: number;
    renderDiagnostics: number;
    approvedRenders: number;
    publications: number;
  };
};

type AssetReadDetail = AssetReadItem & {
  derivation: {
    parent: null | {
      sourceAssetId: string;
      type: string;
      platform: string | null;
      transformationProfileKey: string;
      transformationProfileVersion: string;
      createdAt: string;
    };
    children: {
      derivedAssetId: string;
      type: string;
      platform: string | null;
      transformationProfileKey: string;
      transformationProfileVersion: string;
      createdAt: string;
    }[];
  };
};

type PatternReadItem = {
  patternId: string;
  key: string;
  name: string;
  category: string | null;
  status: string;
  versionCount: number;
  usageCount: number;
  latestVersion: null | {
    id: string;
    version: number;
    description: string | null;
    whenToUse: string | null;
    sourceType: string | null;
    confidence: number | null;
    createdAt: string;
  };
  updatedAt: string;
};

type TemplateReadItem = {
  templateId: string;
  key: string;
  name: string;
  category: string | null;
  status: string;
  versionCount: number;
  latestVersion: null | {
    id: string;
    version: number;
    supportedAspectRatios: string[];
    minDurationMs: number | null;
    maxDurationMs: number | null;
    rendererVersion: string;
    sourceRevision: string | null;
    usage: { assets: number; creativePlans: number; editingPlans: number };
    createdAt: string;
  };
  updatedAt: string;
};

type DistributionOverview = {
  generatedAt: string;
  safety: { realProvidersEnabled: boolean };
  accounts: {
    id: string;
    platform: string;
    displayName: string;
    status: string;
    credentialsConfigured: boolean;
    capabilities: null | {
      canPublishVideo: boolean;
      canPublishPublic: boolean;
      supportsNativeScheduling: boolean;
      checkedAt: string;
      limitations: string[];
    };
    refreshAllowed: boolean;
    updatedAt: string;
  }[];
  publications: {
    publicationId: string;
    platform: string;
    accountName: string;
    accountStatus: string;
    deliveryMode: string;
    status: string;
    scheduledAt: string | null;
    updatedAt: string;
    latestAttempt: null | {
      id: string;
      attemptNumber: number;
      status: string;
      responseClass: string | null;
      failureCode: string | null;
      createdAt: string;
    };
    actions: { reconcile: boolean; reschedule: boolean; cancel: boolean };
  }[];
};

type AnalyticsReadModel = {
  generatedAt: string;
  funnel: {
    websiteVisits: ConfidenceCounts;
    signups: ConfidenceCounts;
    activations: ConfidenceCounts;
    customers: ConfidenceCounts;
    revenueEvents: ConfidenceCounts;
    revenueByCurrency: { currency: string; amountMinor: string; eventCount: number }[];
  };
  attribution: ConfidenceCounts;
  freshness: {
    latestEvidenceAt: string | null;
    ageSeconds: number | null;
    publicationsWithoutMeasurement: number;
  };
  quality: { states: { code: string; count: number }[] };
  platforms: {
    platform: string;
    publishedCount: number;
    measuredCount: number;
    latestCollectedAt: string | null;
    attribution: ConfidenceCounts;
    warnings: string[];
  }[];
  publications: {
    publicationId: string;
    platform: string;
    accountName: string;
    title: string;
    campaignName: string;
    remoteUrl: string | null;
    publishedAt: string;
    measurement: null | {
      collectedAt: string;
      ageSeconds: number;
      windowKey: string | null;
      windowLabel: string;
      collectionMethod: string;
      metricSemanticsVersion: string;
      availabilityStatus: string;
      unavailableMetrics: string[];
      notes: string[];
      comparabilityNotes: string[];
      metrics: {
        views: string | null;
        engagedViews: string | null;
        reach: string | null;
        impressions: string | null;
        likes: string | null;
        comments: string | null;
        shares: string | null;
        saves: string | null;
        watchTimeMs: string | null;
        avgWatchDurationMs: number | null;
        avgWatchPercentage: number | null;
        completionRate: number | null;
        profileVisits: string | null;
        websiteClicks: string | null;
        follows: string | null;
      };
    };
    attribution: ConfidenceCounts;
  }[];
  experiments: {
    id: string;
    name: string;
    hypothesis: string;
    primaryMetric: string | null;
    status: string;
    startedAt: string | null;
    endedAt: string | null;
    arms: {
      id: string;
      label: string;
      publicationId: string | null;
      conceptVersionId: string | null;
    }[];
  }[];
};

type ConfidenceCounts = {
  total: number;
  direct: number;
  inferred: number;
  unknown: number;
};

type TikTokManualAnalyticsOverview = {
  generatedAt: string;
  collectionMethod: 'MANUAL_ENTRY';
  summary: { due: number; overdue: number; upcoming: number; completed: number };
  prompts: {
    jobAttemptId: string;
    publicationId: string;
    accountName: string;
    remoteUrl: string | null;
    windowKey: string;
    dueAt: string;
    overdueAt: string;
    state: 'DUE' | 'OVERDUE' | 'UPCOMING' | 'COMPLETED';
    materiallyOverdue: boolean;
    completedAt: string | null;
  }[];
};

type SettingsSummary = {
  environment: string;
  webOrigin: string;
  authMode: 'LOCAL_SINGLE_USER';
  storageMode: 'PRIVATE_S3_COMPATIBLE';
  publicationMutationAvailable: false;
  analyticsEvidenceAvailable: boolean;
  safety: {
    pauseAllPublishing: boolean;
    pauseAiGeneration: boolean;
    pauseCapture: boolean;
    pauseRendering: boolean;
    pauseAnalyticsCollection: boolean;
    realProvidersEnabled: boolean;
  };
  platformAccounts: {
    id: string;
    platform: string;
    displayName: string;
    status: string;
    credentialsConfigured: boolean;
    capabilitiesConfigured: boolean;
    updatedAt: string;
  }[];
};

const labels: Record<string, string> = {
  ACCEPTED: 'Prise sélectionnée',
  UPLOADED: 'Sélection requise',
  READY_TO_RECORD: 'À enregistrer',
  WAITING_FOR_INPUTS: 'En attente des éléments nécessaires',
  READY_FOR_EDITING: 'Prêt pour le montage',
  SELECTED: 'Sélectionnée',
  REJECTED: 'Rejetée',
  AUDIO_MISSING: 'Aucune piste audio : vérifier si la voix est enregistrée séparément',
  SHORTER_THAN_TARGET: 'Plus court que la durée cible',
  LONGER_THAN_TARGET: 'Plus long que la durée cible',
  LANDSCAPE_SOURCE: 'Source horizontale : vérifier le cadrage',
  GREEN_SCREEN_REQUIRES_VISUAL_REVIEW: 'Fond vert : vérifier visuellement la qualité',
  LEFT: 'Gauche',
  RIGHT: 'Droite',
  CENTER: 'Centre',
  NONE: 'Aucun',
  NATURAL: 'Naturel',
  GREEN_SCREEN: 'Fond vert',
  OTHER: 'Autre',
  WAITING_FOR_ME: 'En attente de moi',
  CAPTURING: 'Capture',
  EDITING: 'Montage',
  RENDERING: 'Rendu',
  FAILED: 'Échec',
  DONE: 'Terminé',
  PASS: 'Validé',
  PASS_WITH_WARNINGS: 'Validé avec avertissements',
  WARNING: 'Avertissement',
  ERROR: 'Erreur',
  READY_FOR_REVIEW: 'Prêt pour review',
  APPROVED: 'Approuvé',
};

type LearningReportSummary = {
  analysisOperationKey: string;
  workflowRunId: string;
  status: string;
  currentStep: string | null;
  analysisWindow: { from: string; to: string };
  measurementWindow: string;
  createdAt: string;
  finishedAt: string | null;
  insightCount: number;
};

type LearningWeeklyReport = LearningReportSummary & {
  generatedAt: string;
  businessOutcomes: Record<
    'websiteVisits' | 'signups' | 'activations' | 'customers' | 'revenueEvents',
    {
      total: number | null;
      direct: number | null;
      inferred: number | null;
      unknown: number | null;
      sourceSystem: string;
    }
  > & {
    revenueByCurrency: { currency: string; amountMinor: string }[];
    attributionSummary: {
      directPublicationLinks: number | null;
      inferredSignals: number | null;
      unknownSignals: number | null;
    };
  };
  funnel: {
    stage: 'CONTENT' | 'WEBSITE' | 'SIGNUP' | 'ACTIVATION' | 'CUSTOMER' | 'REVENUE';
    value: number | null;
    availability: 'OBSERVED' | 'UNAVAILABLE';
    unit: string | null;
  }[];
  platformPerformance: {
    platform: string;
    publicationCount: number;
    measurementWindow: string;
    metrics: {
      metric: string;
      observedValues: number[];
      unavailableCount: number;
      comparableSampleSize: number;
      semanticVersions: string[];
      limitations: string[];
    }[];
  }[];
  contentSignals: {
    insightId: string;
    statement: string;
    confidence: string;
    sampleSize: number;
    measurementWindow: string;
    limitations: string[];
    patternVersionIds: string[];
    hookTypes: string[];
    platforms: string[];
  }[];
  contentContext: {
    patternVersionIds: { value: string; count: number }[];
    hookTypes: { value: string; count: number }[];
    primaryFormats: { value: string; count: number }[];
    ctaTypes: { value: string; count: number }[];
  };
  editingSignals: {
    insightId: string;
    statement: string;
    confidence: string;
    sampleSize: number;
    measurementWindow: string;
    limitations: string[];
    editingProfileVersionIds: string[];
  }[];
  editingContext: {
    editingProfileVersionIds: { value: string; count: number }[];
    templateVersionIds: { value: string; count: number }[];
    durationsMs: { value: string; count: number }[];
  };
  insights: {
    id: string;
    statement: string;
    confidence: string;
    citedPublicationIds: string[];
    citedSampleSize: number;
    weeklySampleSize: number | null;
    measurementWindow: string;
    limitations: string[];
    dimensions: Record<string, string[]>;
    sourceContext: {
      evidencePolicyVersion: string | null;
      platforms: string[];
      sourceAuthority: Record<string, string>;
    };
    createdAt: string;
  }[];
  recommendations: {
    id: string;
    title: string;
    description: string | null;
    status: string;
    recommendedTest: null | {
      hypothesis: string;
      change: string;
      keepConstant: string[];
      primaryMetric: string;
      measurementWindow: string;
    };
    experimentProposal: null | {
      experimentId: string;
      status: string;
      campaignId: string | null;
    };
    createdAt: string;
  }[];
  experiments: {
    experimentId: string;
    name: string;
    hypothesis: string;
    status: string;
    primaryMetric: string | null;
    measurementWindow: string;
    readiness: string;
    arms: {
      label: string;
      publicationId: string | null;
      readiness: string;
      metricValue: number | null;
      platform: string | null;
      metricSemanticsVersion: string | null;
      limitations: string[];
    }[];
    limitations: string[];
  }[];
  dataQuality: {
    issues: { category: string; detail: string }[];
    excludedPublicationCount: number;
    unavailableMetricCount: number;
  };
};

const errors: Record<string, string> = {
  AUTH_FAILED: 'Clé incorrecte.',
  AUTH_REQUIRED: 'Reconnectez-vous pour continuer.',
  AUTH_RATE_LIMITED: 'Trop de tentatives. Réessayez dans cinq minutes.',
  UPLOAD_TOO_LARGE: 'Le fichier dépasse 512 Mio.',
  UNSUPPORTED_HDR_COLOR: 'Couleur HDR non prise en charge. Fournissez un original SDR.',
  AUDIO_MISSING: 'La piste audio requise est absente.',
  VIDEO_MISSING: 'La piste vidéo requise est absente.',
  UPLOAD_FAILED:
    'Le fichier est illisible ou le transfert a échoué. Réessayez avec une nouvelle prise.',
  INVALID_RECORDING_ASSET: 'Ce fichier ne peut pas être sélectionné.',
  PREVIEW_CAPACITY_REACHED: 'Une prévisualisation est en cours. Réessayez dans un instant.',
  ASSET_NOT_AVAILABLE: 'Fichier privé indisponible. Rechargez l’état avant de réessayer.',
  DASHBOARD_OPERATION_FAILED: 'Le tableau de bord est momentanément indisponible.',
  CONCEPT_OPERATION_FAILED: 'La review du concept est momentanément indisponible.',
  CONCEPT_VERSION_NOT_FOUND: 'Cette version de concept est introuvable.',
  STALE_VERSION: 'Une version plus récente existe. Rechargez la review avant de décider.',
  INVALID_TRANSITION: 'Cet élément ne peut plus être validé depuis son état actuel.',
  EXPLICIT_SELECTION_REQUIRED: 'Une sélection explicite de version est déjà en cours.',
  INVALID_CONCEPT_REASON: 'La raison de rejet n’est pas valide.',
  PRODUCTION_OPERATION_FAILED: 'La production est momentanément indisponible.',
  CREATIVE_PLAN_VERSION_NOT_FOUND: 'Cette version de production est introuvable.',
  REVIEW_OPERATION_FAILED: 'La review finale est momentanément indisponible.',
  RENDER_NOT_FOUND: 'Ce rendu est introuvable.',
  RENDER_NOT_REVIEWABLE: 'Ce rendu n’est pas disponible pour cette review.',
  RENDER_OUTPUT_MISMATCH: 'La sortie du rendu ne correspond plus à la lineage attendue.',
  RENDER_REVIEW_EVIDENCE_INVALID: 'Les preuves QA du rendu sont incomplètes.',
  RENDER_REJECTION_REASON_REQUIRED: 'Choisissez une raison avant de rejeter le rendu.',
  INVALID_RENDER_REASON: 'La raison de rejet du rendu n’est pas valide.',
  SUPPORTING_READ_OPERATION_FAILED: 'Cette surface de lecture est momentanément indisponible.',
  ASSET_NOT_FOUND: 'Cet asset est introuvable.',
  MANUAL_HANDOFF_OPERATION_FAILED: 'Le handoff TikTok est momentanément indisponible.',
  PUBLICATION_NOT_FOUND: 'Cette publication est introuvable.',
  MANUAL_HANDOFF_REQUIRED: 'Cette publication ne relève pas du handoff manuel.',
  TIKTOK_MANUAL_ONLY: 'Cette opération est réservée au handoff TikTok manuel.',
  MANUAL_HANDOFF_NOT_AVAILABLE: 'Ce handoff TikTok n’est plus disponible dans cet état.',
  MANUAL_TARGET_TIME_REQUIRED: 'L’heure cible du handoff est absente.',
  INVALID_PUBLICATION_TRANSITION: 'Cette publication a déjà changé d’état. Rechargez la page.',
  PLATFORM_ACCOUNT_NOT_ACTIVE: 'Le compte TikTok n’est plus actif.',
  PUBLICATION_LINEAGE_INVALID: 'La lineage de cette publication n’est plus valide.',
  DISTRIBUTION_OPERATION_FAILED: 'Les contrôles de distribution sont momentanément indisponibles.',
  RECONCILIATION_REQUIRED: 'Cette publication ne nécessite plus de réconciliation.',
  PUBLICATION_RESCHEDULE_NOT_SAFE: 'Cette publication ne peut plus être replanifiée.',
  REAL_PROVIDERS_DISABLED: 'Les providers réels restent désactivés pour cette phase.',
  ACCOUNT_HEALTH_REFRESH_UNAVAILABLE:
    'Le contrôle distant de ce compte n’est pas encore disponible.',
  PLATFORM_ACCOUNT_DISABLED: 'Ce compte plateforme est désactivé.',
  PLATFORM_ACCOUNT_IDENTITY_MISMATCH: 'L’identité distante ne correspond plus au compte configuré.',
  MANUAL_METRICS_REQUIRED: 'Renseignez au moins une métrique TikTok observée.',
  MANUAL_SNAPSHOT_NOT_DUE: 'Cette fenêtre de mesure TikTok n’est pas encore due.',
  MANUAL_ANALYTICS_JOB_NOT_PENDING: 'Cette mesure TikTok a déjà été traitée.',
  MANUAL_ANALYTICS_OPERATION_FAILED: 'La saisie Analytics n’a pas pu être enregistrée.',
  LEARNING_OPERATION_FAILED: 'Le rapport Learning est momentanément indisponible.',
  LEARNING_REPORT_NOT_FOUND: 'Ce rapport Learning est introuvable.',
  INVALID_RECOMMENDATION_TRANSITION: 'Cette Recommendation a déjà changé d’état.',
  RECOMMENDATION_NOT_ACCEPTED:
    'La Recommendation doit être acceptée avant de créer une expérience.',
  EXPERIMENT_PROPOSAL_CONFLICT: 'Une proposition d’expérience différente existe déjà.',
};

const navigation = [
  ['/', 'Vue d’ensemble'],
  ['/attention', 'À traiter'],
  ['/concepts', 'Concepts'],
  ['/production', 'Production'],
  ['/review', 'Review finale'],
  ['/manual-publish', 'TikTok manuel'],
  ['/distribution', 'Distribution'],
  ['/calendar', 'Calendrier'],
  ['/published', 'Publiées'],
  ['/assets', 'Assets'],
  ['/patterns', 'Patterns'],
  ['/templates', 'Templates'],
  ['/settings', 'Réglages'],
  ['/analytics', 'Analytics'],
  ['/learning', 'Learning'],
] as const;

const deferredTitles: Record<string, { title: string; note: string }> = {
  '/calendar': {
    title: 'Calendrier',
    note: 'Lecture uniquement en Phase 6. Le scheduling appartient à la Phase 7.',
  },
  '/published': {
    title: 'Publiées',
    note: 'La distribution distante appartient à la Phase 7.',
  },
  '/assets': {
    title: 'Assets',
    note: 'La surface opérationnelle détaillée arrive dans la tranche 6E.',
  },
  '/patterns': {
    title: 'Patterns',
    note: 'La surface de lecture arrive dans la tranche 6E.',
  },
  '/templates': {
    title: 'Templates',
    note: 'La surface de lecture arrive dans la tranche 6E.',
  },
  '/settings': {
    title: 'Réglages',
    note: 'La synthèse opérationnelle arrive dans la tranche 6E.',
  },
  '/analytics': {
    title: 'Analytics',
    note: 'Les données Analytics réelles appartiennent à la Phase 8. Aucune donnée n’est simulée ici.',
  },
};

async function call(path: string, csrf: string, data?: unknown) {
  const response = await fetch(`/api/${path}`, {
    ...(data !== undefined
      ? {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrf,
          },
          body: JSON.stringify(data),
        }
      : {}),
    credentials: 'same-origin',
  });

  const result: unknown = await response.json();

  if (!response.ok) {
    const code =
      typeof result === 'object' && result && 'message' in result ? String(result.message) : '';
    throw new Error(errors[code] ?? 'Action impossible. Rechargez la page et réessayez.');
  }

  return result;
}

function usePathname() {
  const [pathname, setPathname] = useState(() => window.location.pathname);

  useEffect(() => {
    const update = () => setPathname(window.location.pathname);
    window.addEventListener('popstate', update);
    return () => window.removeEventListener('popstate', update);
  }, []);

  return [pathname, setPathname] as const;
}

function AppLink({
  href,
  current,
  onNavigate,
  children,
  className,
}: {
  href: string;
  current?: boolean;
  onNavigate: (path: string) => void;
  children: ReactNode;
  className?: string;
}) {
  function click(event: MouseEvent<HTMLAnchorElement>) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
      return;

    event.preventDefault();
    onNavigate(href);
  }

  return (
    <a
      href={href}
      aria-current={current ? 'page' : undefined}
      className={className}
      onClick={click}
    >
      {children}
    </a>
  );
}

function Login({
  accessKey,
  setAccessKey,
  busy,
  onSubmit,
}: {
  accessKey: string;
  setAccessKey: (value: string) => void;
  busy: boolean;
  onSubmit: (event: FormEvent) => void;
}) {
  return (
    <main className="login-layout">
      <div className="login-brand">
        <p className="eyebrow">VISION · CONTENT ENGINE</p>
        <h1>Control Room</h1>
        <p>Validation humaine, production et exceptions au même endroit.</p>
      </div>
      <form className="login-card" onSubmit={onSubmit}>
        <h2>Accès privé</h2>
        <label htmlFor="access">Clé d’accès locale</label>
        <input
          id="access"
          type="password"
          value={accessKey}
          required
          autoComplete="current-password"
          onChange={(event) => setAccessKey(event.target.value)}
        />
        <button disabled={busy}>Se connecter</button>
      </form>
    </main>
  );
}

function DashboardView({
  summary,
  onNavigate,
}: {
  summary: DashboardSummary | null;
  onNavigate: (path: string) => void;
}) {
  if (!summary)
    return (
      <section className="panel" aria-busy="true">
        <p>Chargement du tableau de bord…</p>
      </section>
    );

  const cards = [
    {
      label: 'À traiter',
      value: summary.counts.needsAttention,
      href: '/attention',
      testId: 'count-attention',
    },
    {
      label: 'Concepts à valider',
      value: summary.counts.conceptsAwaitingReview,
      href: '/concepts',
      testId: 'count-concepts',
    },
    {
      label: 'En production',
      value: summary.counts.activeProduction,
      href: '/production',
      testId: 'count-production',
    },
    {
      label: 'Reviews finales',
      value: summary.counts.rendersReadyForReview,
      href: '/review',
      testId: 'count-review',
    },
  ];

  return (
    <>
      <section className="page-heading">
        <p className="eyebrow">AUJOURD’HUI</p>
        <h1>Tableau de bord</h1>
        <p>Ce qui demande une décision, ce qui avance et ce qui a changé récemment.</p>
      </section>

      <section className="metric-grid" aria-label="État de la production">
        {cards.map((card) => (
          <AppLink key={card.href} href={card.href} onNavigate={onNavigate} className="metric-card">
            <span>{card.label}</span>
            <strong data-testid={card.testId}>{card.value}</strong>
          </AppLink>
        ))}
      </section>

      <section className="panel">
        <div className="section-head">
          <div>
            <p className="eyebrow">ACTIVITÉ</p>
            <h2>Changements récents</h2>
          </div>
        </div>
        {!summary.recentChanges.length ? (
          <p className="muted">Aucune activité récente.</p>
        ) : (
          <ol className="activity-list">
            {summary.recentChanges.map((event) => (
              <li key={event.id}>
                <div>
                  <strong>{event.action}</strong>
                  <span>
                    {event.subjectType} · {event.subjectId.slice(0, 8)}
                  </span>
                </div>
                <time dateTime={event.createdAt}>
                  {new Date(event.createdAt).toLocaleString('fr-FR')}
                </time>
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );
}

function AttentionView({
  items,
  onNavigate,
}: {
  items: AttentionItem[] | null;
  onNavigate: (path: string) => void;
}) {
  if (items === null)
    return (
      <section className="panel" aria-busy="true">
        <p>Chargement des éléments à traiter…</p>
      </section>
    );

  return (
    <>
      <section className="page-heading">
        <p className="eyebrow">EXCEPTIONS</p>
        <h1>À traiter</h1>
        <p>Seulement les éléments qui nécessitent une intervention humaine ou une inspection.</p>
      </section>

      {!items.length ? (
        <section className="panel empty-state">
          <h2>Rien à traiter</h2>
          <p>Les workflows peuvent continuer sans intervention humaine pour le moment.</p>
        </section>
      ) : (
        <section className="attention-list" aria-label="Éléments à traiter">
          {items.map((item) => (
            <article className={`attention-card ${item.severity.toLowerCase()}`} key={item.id}>
              <div className="attention-topline">
                <span className="badge">{item.kind.replaceAll('_', ' ')}</span>
                <time dateTime={item.createdAt}>
                  {new Date(item.createdAt).toLocaleString('fr-FR')}
                </time>
              </div>
              <h2>{item.title}</h2>
              <p>{item.reason}</p>
              <p className="muted">{item.recommendedAction}</p>
              <AppLink href={item.targetRoute} onNavigate={onNavigate} className="text-link">
                Ouvrir
              </AppLink>
            </article>
          ))}
        </section>
      )}
    </>
  );
}

function ConceptReviewView({
  pathname,
  concepts,
  detail,
  busy,
  onNavigate,
  onDecision,
}: {
  pathname: string;
  concepts: ConceptReviewItem[];
  detail: ConceptReviewDetail | null;
  busy: boolean;
  onNavigate: (path: string) => void;
  onDecision: (
    decision: 'APPROVED' | 'REJECTED',
    reasonCode?: string,
    comment?: string,
  ) => Promise<void>;
}) {
  const [reasonCode, setReasonCode] = useState('');
  const [comment, setComment] = useState('');

  useEffect(() => {
    setReasonCode('');
    setComment('');
  }, [detail?.conceptVersionId]);

  if (pathname === '/concepts') {
    return (
      <>
        <section className="page-heading">
          <p className="eyebrow">HUMAN GATE · 1/2</p>
          <h1>Concepts</h1>
          <p>Validez l’idée créative exacte avant que la production ne continue.</p>
        </section>

        {!concepts.length ? (
          <section className="panel empty-state">
            <h2>Aucun concept à valider</h2>
            <p>La file de review est vide.</p>
          </section>
        ) : (
          <section className="concept-grid" aria-label="Concepts à valider">
            {concepts.map((concept) => (
              <article className="concept-card" key={concept.conceptVersionId}>
                <div className="concept-meta">
                  <span className="badge">Version {concept.version}</span>
                  <span>{concept.brief.campaign.name}</span>
                </div>
                <h2>{concept.title}</h2>
                {concept.hook && <blockquote>{concept.hook}</blockquote>}
                <dl>
                  <dt>Angle</dt>
                  <dd>{concept.angle ?? 'Non précisé'}</dd>
                  <dt>Audience</dt>
                  <dd>{concept.audience ?? concept.brief.audience ?? 'Non précisée'}</dd>
                  <dt>Pattern</dt>
                  <dd>{concept.pattern?.name ?? 'Aucun pattern lié'}</dd>
                </dl>
                <AppLink
                  href={`/concepts/${concept.conceptVersionId}`}
                  onNavigate={onNavigate}
                  className="text-link"
                >
                  Ouvrir {concept.title}
                </AppLink>
              </article>
            ))}
          </section>
        )}
      </>
    );
  }

  if (!detail)
    return (
      <section className="panel" aria-busy="true">
        <p>Chargement de la version du concept…</p>
      </section>
    );

  return (
    <>
      <section className="page-heading">
        <p className="eyebrow">CONCEPT · VERSION {detail.version}</p>
        <h1>{detail.title}</h1>
        <p>
          {detail.brief.campaign.name} · {detail.brief.title}
        </p>
      </section>

      {!detail.decisionAllowed && (
        <section className="panel stale-panel" role="alert">
          <h2>Cette version n’est plus décisionnable</h2>
          <p>
            {detail.isLatest
              ? `Le concept est maintenant ${detail.status}.`
              : 'Une version plus récente existe. La décision est volontairement bloquée.'}
          </p>
        </section>
      )}

      <section className="concept-detail-grid">
        <article className="panel">
          <p className="eyebrow">ACCROCHE</p>
          <blockquote>{detail.hook ?? 'Aucune accroche renseignée.'}</blockquote>

          <dl className="detail-list">
            <dt>Angle</dt>
            <dd>{detail.angle ?? 'Non précisé'}</dd>
            <dt>Audience</dt>
            <dd>{detail.audience ?? detail.brief.audience ?? 'Non précisée'}</dd>
            <dt>Objectif</dt>
            <dd>{detail.objective ?? detail.brief.goal ?? 'Non précisé'}</dd>
            <dt>Hypothèse</dt>
            <dd>{detail.hypothesis ?? 'Non précisée'}</dd>
            <dt>Pattern</dt>
            <dd>
              {detail.pattern ? `${detail.pattern.name} · v${detail.pattern.version}` : 'Aucun'}
            </dd>
          </dl>
        </article>

        <article className="panel">
          <p className="eyebrow">RATIONALE</p>
          <p>{detail.rationale ?? 'Aucune rationale renseignée.'}</p>
        </article>
      </section>

      {detail.decisionAllowed && (
        <section className="panel decision-panel">
          <div className="section-head">
            <div>
              <p className="eyebrow">DÉCISION HUMAINE</p>
              <h2>Valider cette version exacte</h2>
            </div>
            <span className="badge">v{detail.version}</span>
          </div>

          <label htmlFor="concept-reason">Raison du rejet</label>
          <select
            id="concept-reason"
            value={reasonCode}
            onChange={(event) => setReasonCode(event.target.value)}
          >
            <option value="">Optionnelle</option>
            <option value="HOOK_WEAK">Hook faible</option>
            <option value="ANGLE_TOO_GENERIC">Angle trop générique</option>
            <option value="TOO_AD_LIKE">Trop publicitaire</option>
            <option value="TOO_REPETITIVE">Trop répétitif</option>
            <option value="NOT_TRUE_TO_VISION">Pas fidèle à Vision</option>
            <option value="WRONG_AUDIENCE">Mauvaise audience</option>
            <option value="OTHER">Autre</option>
          </select>

          <label htmlFor="concept-comment">Commentaire de review</label>
          <textarea
            id="concept-comment"
            rows={4}
            maxLength={1000}
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            placeholder="Optionnel · expliquez ce qui doit changer."
          />

          <div className="decision-actions">
            <button
              className="approve-button"
              disabled={busy}
              onClick={() => void onDecision('APPROVED', undefined, comment)}
            >
              Approuver le concept
            </button>
            <button
              className="reject-button"
              disabled={busy}
              onClick={() => void onDecision('REJECTED', reasonCode || undefined, comment)}
            >
              Rejeter le concept
            </button>
          </div>
        </section>
      )}
    </>
  );
}

function ProductionView({
  pathname,
  items,
  detail,
  packs,
  busy,
  csrf,
  action,
  refresh,
  upload,
  drop,
  setNotice,
  onNavigate,
}: {
  pathname: string;
  items: ProductionItem[];
  detail: ProductionDetail | null;
  packs: Pack[];
  busy: boolean;
  csrf: string;
  action: (work: () => Promise<void>) => Promise<void>;
  refresh: () => Promise<void>;
  upload: (request: RecordingRequest, files: FileList | null) => Promise<void>;
  drop: (event: DragEvent, request: RecordingRequest) => void;
  setNotice: (value: string) => void;
  onNavigate: (path: string) => void;
}) {
  if (pathname === '/production') {
    return (
      <>
        <section className="page-heading">
          <p className="eyebrow">PIPELINE</p>
          <h1>Production</h1>
          <p>
            Suivez l’état canonique de chaque contenu sans piloter le workflow depuis l’interface.
          </p>
        </section>

        {!items.length ? (
          <section className="panel empty-state">
            <h2>Aucune production active</h2>
            <p>Les plans créatifs apparaîtront ici dès qu’ils entreront dans le pipeline.</p>
          </section>
        ) : (
          <section className="production-grid" aria-label="Productions actives">
            {items.map((item) => (
              <article className="production-card" key={item.creativePlanVersionId}>
                <div className="production-card-top">
                  <span className={`stage-badge stage-${item.stage.toLowerCase()}`}>
                    {labels[item.stage] ?? item.stage}
                  </span>
                  <span>v{item.version}</span>
                </div>
                <h2>{item.title}</h2>
                {item.hook && <p className="production-hook">{item.hook}</p>}
                <p className="muted">
                  {item.campaignName} · {item.primaryFormat}
                </p>
                <dl className="production-mini">
                  <dt>Enregistrements</dt>
                  <dd>
                    {item.recordings.accepted}/{item.recordings.total} acceptés
                  </dd>
                  <dt>Capture</dt>
                  <dd>{item.capture?.status ?? 'Pas encore lancée'}</dd>
                  <dt>Montage</dt>
                  <dd>{item.editing?.status ?? 'Pas encore généré'}</dd>
                  <dt>Rendu</dt>
                  <dd>{item.render?.status ?? 'Pas encore lancé'}</dd>
                </dl>
                <p className="next-action">{item.nextAction}</p>
                <AppLink
                  href={`/production/${item.creativePlanVersionId}`}
                  onNavigate={onNavigate}
                  className="text-link"
                >
                  Ouvrir la production
                </AppLink>
              </article>
            ))}
          </section>
        )}
      </>
    );
  }

  if (!detail)
    return (
      <section className="panel" aria-busy="true">
        <p>Chargement de la production…</p>
      </section>
    );

  const matchingPacks = packs.filter((pack) => pack.versionId === detail.creativePlanVersionId);

  return (
    <>
      <section className="page-heading">
        <p className="eyebrow">PRODUCTION · VERSION {detail.version}</p>
        <h1>État de production</h1>
        <p>{detail.title}</p>
      </section>

      <div className="production-detail-top">
        <article className="panel production-summary">
          <div className="section-head">
            <div>
              <p className="eyebrow">ÉTAT CANONIQUE</p>
              <h2>{labels[detail.stage] ?? detail.stage}</h2>
            </div>
            <span className={`stage-badge stage-${detail.stage.toLowerCase()}`}>
              {labels[detail.stage] ?? detail.stage}
            </span>
          </div>
          <p className="next-action">{detail.nextAction}</p>
          {detail.hook && <blockquote>{detail.hook}</blockquote>}
          <dl className="detail-list">
            <dt>Format</dt>
            <dd>{detail.primaryFormat}</dd>
            <dt>Durée cible</dt>
            <dd>
              {detail.targetDurationMs
                ? `${(detail.targetDurationMs / 1000).toFixed(0)} s`
                : 'Libre'}
            </dd>
            <dt>Template</dt>
            <dd>
              {detail.template.name} · v{detail.template.version}
            </dd>
            <dt>Profil montage</dt>
            <dd>
              {detail.editingProfile.name} · v{detail.editingProfile.version}
            </dd>
          </dl>
        </article>

        <article className="panel">
          <p className="eyebrow">SCRIPT</p>
          <p className="script-preview">{detail.script.fullText}</p>
          <p className="muted">
            {detail.script.voiceMode}
            {detail.script.estimatedDurationMs
              ? ` · ${(detail.script.estimatedDurationMs / 1000).toFixed(1)} s estimées`
              : ''}
          </p>
        </article>
      </div>

      <section className="pipeline-strip" aria-label="État technique de la production">
        <article>
          <span>Capture</span>
          <strong>{detail.capture?.status ?? 'NON LANCÉE'}</strong>
          {detail.capture?.failureCode && <small>{detail.capture.failureCode}</small>}
        </article>
        <article>
          <span>Montage</span>
          <strong>{detail.editing?.status ?? 'NON GÉNÉRÉ'}</strong>
          {detail.blocker && <small>{detail.blocker.reasonCode}</small>}
        </article>
        <article>
          <span>Rendu</span>
          <strong>{detail.render?.status ?? 'NON LANCÉ'}</strong>
          {detail.render?.creativeQaResult && <small>QA {detail.render.creativeQaResult}</small>}
        </article>
      </section>

      {detail.blockers.length > 0 && (
        <section className="panel">
          <p className="eyebrow">BLOCKERS OUVERTS</p>
          <h2>Le montage nécessite une intervention</h2>
          <ul className="simple-list">
            {detail.blockers.map((blocker) => (
              <li key={blocker.id}>
                <strong>{blocker.reasonCode}</strong>
                <span>{blocker.recoverability}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <RecordingPackView
        packs={matchingPacks}
        busy={busy}
        csrf={csrf}
        action={action}
        refresh={refresh}
        upload={upload}
        drop={drop}
        setNotice={setNotice}
        embedded
      />
    </>
  );
}

function RecordingPackView({
  packs,
  busy,
  csrf,
  action,
  refresh,
  upload,
  drop,
  setNotice,
  embedded = false,
}: {
  packs: Pack[];
  busy: boolean;
  csrf: string;
  action: (work: () => Promise<void>) => Promise<void>;
  refresh: () => Promise<void>;
  upload: (request: RecordingRequest, files: FileList | null) => Promise<void>;
  drop: (event: DragEvent, request: RecordingRequest) => void;
  setNotice: (value: string) => void;
  embedded?: boolean;
}) {
  return (
    <>
      <section className={embedded ? 'section-heading' : 'page-heading'}>
        <p className="eyebrow">PRODUCTION · INPUT HUMAIN</p>
        <h1>Recording Pack</h1>
        <p>Vos enregistrements bruts, prêts pour la prochaine étape.</p>
      </section>

      {!embedded && (
        <button className="secondary-button" disabled={busy} onClick={() => void action(refresh)}>
          Actualiser
        </button>
      )}

      {!packs.length && (
        <section className="panel empty-state">
          <h2>Aucun enregistrement à préparer</h2>
          <p>
            Les demandes apparaîtront lorsque le plan créatif nécessitera votre voix ou une vidéo.
          </p>
        </section>
      )}

      {packs.map((pack) => (
        <section
          className="panel"
          key={pack.versionId}
          aria-label={`Plan créatif version ${pack.version}`}
        >
          <div className="section-head">
            <div>
              <p className="eyebrow">PLAN CRÉATIF</p>
              <h2>Version {pack.version}</h2>
            </div>
            <span className="badge">{labels[pack.status] ?? pack.status}</span>
          </div>

          {pack.requests.map((request) => (
            <article className="recording-request" key={request.id}>
              <div className="request-head">
                <h3>{request.title}</h3>
                <span className="badge">{labels[request.status] ?? request.status}</span>
              </div>
              <p>{request.instructions}</p>

              <div className="instructions">
                <div>
                  {request.text && <blockquote>{request.text}</blockquote>}
                  <dl>
                    <dt>Durée cible</dt>
                    <dd>
                      {request.targetDurationSec ? `${request.targetDurationSec} s` : 'Libre'}
                    </dd>
                    <dt>Cadrage</dt>
                    <dd>{request.shot.framing ?? 'Selon les instructions'}</dd>
                    <dt>Position</dt>
                    <dd>{labels[request.shot.presenterPosition ?? ''] ?? 'Libre'}</dd>
                    <dt>Geste</dt>
                    <dd>{labels[request.shot.gestureDirection ?? ''] ?? 'Libre'}</dd>
                    <dt>Fond</dt>
                    <dd>{labels[request.shot.background ?? ''] ?? 'Selon les instructions'}</dd>
                    {request.shot.eyeLine && (
                      <>
                        <dt>Regard</dt>
                        <dd>{request.shot.eyeLine}</dd>
                      </>
                    )}
                  </dl>
                </div>
                <figure>
                  <svg
                    viewBox="0 0 108 192"
                    role="img"
                    aria-label="Repère indicatif de position dans le cadre vertical"
                  >
                    <rect width="108" height="192" rx="6" fill="#e3ebe7" />
                    <circle
                      cx={
                        request.shot.presenterPosition === 'LEFT'
                          ? 30
                          : request.shot.presenterPosition === 'RIGHT'
                            ? 78
                            : 54
                      }
                      cy="65"
                      r="12"
                      fill="#376357"
                    />
                    <rect
                      x={
                        request.shot.presenterPosition === 'LEFT'
                          ? 17
                          : request.shot.presenterPosition === 'RIGHT'
                            ? 65
                            : 41
                      }
                      y="80"
                      width="26"
                      height="62"
                      rx="10"
                      fill="#376357"
                    />
                  </svg>
                  <figcaption>Repère de position indicatif</figcaption>
                </figure>
              </div>

              <div
                className="drop"
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => drop(event, request)}
              >
                <label htmlFor={`upload-${request.id}`}>
                  Ajouter des prises · déposer ici ou choisir des fichiers
                </label>
                <input
                  id={`upload-${request.id}`}
                  type="file"
                  accept="audio/*,video/*"
                  multiple
                  disabled={busy}
                  onChange={(event) => {
                    void upload(request, event.target.files);
                    event.target.value = '';
                  }}
                />
                <small>512 Mio maximum par prise. Les fichiers originaux sont conservés.</small>
              </div>

              <ul className="takes">
                {request.takes.map((take) => (
                  <li key={take.id}>
                    <h4>
                      Prise {take.number} · {labels[take.status] ?? take.status}
                    </h4>
                    <p>
                      {take.durationMs
                        ? `${(take.durationMs / 1000).toFixed(1)} s`
                        : 'Durée indisponible'}
                    </p>
                    {take.assetStatus === 'READY' ? (
                      take.kind === 'VIDEO' ? (
                        <video
                          controls
                          preload="none"
                          src={`/api/assets/${take.assetId}/preview`}
                          aria-label={`Prévisualiser la prise ${take.number}`}
                        />
                      ) : (
                        <audio
                          controls
                          preload="none"
                          src={`/api/assets/${take.assetId}/preview`}
                          aria-label={`Écouter la prise ${take.number}`}
                        />
                      )
                    ) : (
                      <p role="alert">Fichier indisponible : ajoutez une nouvelle prise.</p>
                    )}

                    {take.warnings.map((warning) => (
                      <p key={warning} className="warning">
                        {labels[warning] ?? warning}
                      </p>
                    ))}

                    <div className="actions">
                      {(['SELECTED', 'UPLOADED', 'REJECTED'] as const).map((status) => (
                        <button
                          key={status}
                          disabled={
                            busy ||
                            take.status === status ||
                            (status === 'SELECTED' && take.assetStatus !== 'READY')
                          }
                          onClick={() =>
                            void action(async () => {
                              await call(`recordings/${take.id}/selection`, csrf, { status });
                              await refresh();
                              setNotice('Sélection mise à jour.');
                            })
                          }
                        >
                          {status === 'SELECTED'
                            ? 'Sélectionner'
                            : status === 'REJECTED'
                              ? 'Rejeter'
                              : 'Désélectionner'}
                        </button>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </section>
      ))}
    </>
  );
}

function readableEvidence(value: unknown): string {
  if (value === null || value === undefined) return 'Non précisé';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return 'Valeur indisponible';
  }
}

function RenderReviewView({
  pathname,
  items,
  detail,
  busy,
  onNavigate,
  onDecision,
}: {
  pathname: string;
  items: RenderReviewItem[];
  detail: RenderReviewDetail | null;
  busy: boolean;
  onNavigate: (path: string) => void;
  onDecision: (
    decision: 'APPROVED' | 'REJECTED',
    reasonCode?: string,
    comment?: string,
  ) => Promise<void>;
}) {
  const [reasonCode, setReasonCode] = useState('');
  const [comment, setComment] = useState('');
  const player = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    setReasonCode('');
    setComment('');
  }, [detail?.renderId]);

  if (pathname === '/review') {
    return (
      <>
        <section className="page-heading">
          <p className="eyebrow">HUMAN GATE · 2/2</p>
          <h1>Review finale</h1>
          <p>Inspectez le master exact rendu et validé par les contrôles QA avant publication.</p>
        </section>

        {!items.length ? (
          <section className="panel empty-state">
            <h2>Aucun rendu à valider</h2>
            <p>La file contient uniquement les Render au statut READY_FOR_REVIEW.</p>
          </section>
        ) : (
          <section className="review-grid" aria-label="Rendus prêts pour review">
            {items.map((item) => (
              <article className="review-card" key={item.renderId}>
                <div className="review-card-top">
                  <span className="badge">{labels[item.creativeQaResult]}</span>
                  <time dateTime={item.createdAt}>
                    {new Date(item.createdAt).toLocaleString('fr-FR')}
                  </time>
                </div>
                <h2>{item.title}</h2>
                {item.hook && <blockquote>{item.hook}</blockquote>}
                <p className="muted">
                  Plan créatif v{item.creativePlanVersion} · {item.primaryFormat}
                </p>
                <p>{item.creativeQaSummary}</p>
                <p className="muted">
                  {item.issueCount
                    ? `${item.issueCount} point${item.issueCount > 1 ? 's' : ''} QA à inspecter`
                    : 'Aucun avertissement Creative QA'}
                </p>
                <AppLink
                  href={`/review/${item.renderId}`}
                  onNavigate={onNavigate}
                  className="text-link"
                >
                  Ouvrir la review finale
                </AppLink>
              </article>
            ))}
          </section>
        )}
      </>
    );
  }

  if (!detail)
    return (
      <section className="panel" aria-busy="true">
        <p>Chargement du rendu final…</p>
      </section>
    );

  const seek = (startMs: number | null) => {
    if (startMs === null || !player.current) return;
    player.current.currentTime = startMs / 1000;
    void player.current.play().catch(() => {});
  };

  return (
    <>
      <section className="page-heading review-heading">
        <div>
          <p className="eyebrow">FINAL RENDER · PLAN V{detail.creativePlanVersion}</p>
          <h1>{detail.title}</h1>
          <p>{detail.hook ?? 'Aucune accroche renseignée.'}</p>
        </div>
        <span className="badge">{labels[detail.status] ?? detail.status}</span>
      </section>

      {!detail.decisionAllowed && (
        <section className="panel stale-panel" role="status">
          <h2>Décision déjà enregistrée</h2>
          <p>
            Ce rendu est maintenant {labels[detail.status]?.toLowerCase() ?? detail.status}. La
            preview reste accessible pour audit.
          </p>
        </section>
      )}

      <section className="review-layout">
        <article className="panel review-player-panel">
          <div className="section-head">
            <div>
              <p className="eyebrow">MASTER PRIVÉ</p>
              <h2>Rendu exact à valider</h2>
            </div>
            <span className="badge">{Math.round(detail.technicalQa.durationMs / 1000)} s</span>
          </div>
          <div className="vertical-player-frame">
            <video
              ref={player}
              controls
              playsInline
              preload="metadata"
              src={`/api/review/${detail.renderId}/media`}
              aria-label="Rendu final à valider"
            />
          </div>
          <p className="muted">
            {detail.technicalQa.width ?? '—'}×{detail.technicalQa.height ?? '—'} ·{' '}
            {detail.technicalQa.fps ?? '—'} fps · {detail.technicalQa.codecProfileKey}
          </p>
        </article>

        <div className="review-side">
          <article className="panel">
            <p className="eyebrow">CREATIVE QA</p>
            <div className="section-head compact">
              <h2>{labels[detail.creativeQa.result]}</h2>
              <span className={`qa-result qa-${detail.creativeQa.result.toLowerCase()}`}>
                {detail.creativeQa.result}
              </span>
            </div>
            <p>{detail.creativeQa.summary}</p>

            {detail.creativeQa.issues.length ? (
              <ul className="qa-issues">
                {detail.creativeQa.issues.map((issue, index) => (
                  <li key={`${issue.code}-${index}`}>
                    <div>
                      <strong>{issue.code.replaceAll('_', ' ')}</strong>
                      <span className={`issue-severity severity-${issue.severity.toLowerCase()}`}>
                        {labels[issue.severity]}
                      </span>
                    </div>
                    <p>{issue.explanation}</p>
                    {issue.suggestedFix && <p className="muted">{issue.suggestedFix}</p>}
                    {issue.startMs !== null && (
                      <button
                        className="timestamp-button"
                        type="button"
                        onClick={() => seek(issue.startMs)}
                      >
                        Aller à {(issue.startMs / 1000).toFixed(1)} s
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">Aucune issue Creative QA signalée.</p>
            )}
          </article>

          <article className="panel">
            <p className="eyebrow">CONTENU</p>
            <h2>Script & intention</h2>
            <blockquote>{detail.script.fullText}</blockquote>
            <dl className="detail-list">
              <dt>Angle</dt>
              <dd>{detail.concept.angle ?? 'Non précisé'}</dd>
              <dt>Audience</dt>
              <dd>{detail.concept.audience ?? 'Non précisée'}</dd>
              <dt>Objectif</dt>
              <dd>{detail.concept.objective ?? 'Non précisé'}</dd>
              <dt>Hypothèse</dt>
              <dd>{detail.concept.hypothesis ?? 'Non précisée'}</dd>
              <dt>Rationale</dt>
              <dd>{detail.concept.rationale ?? 'Non précisée'}</dd>
              <dt>CTA</dt>
              <dd>
                <pre className="evidence-value">{readableEvidence(detail.cta)}</pre>
              </dd>
              <dt>Intent plateforme</dt>
              <dd>
                <pre className="evidence-value">{readableEvidence(detail.platformIntent)}</pre>
              </dd>
            </dl>
          </article>
        </div>
      </section>

      <section className="review-evidence-grid">
        <article className="panel">
          <p className="eyebrow">TECHNICAL QA</p>
          <h2>{labels[detail.technicalQa.result]}</h2>
          <dl className="detail-list">
            <dt>Renderer</dt>
            <dd>{detail.technicalQa.rendererVersion}</dd>
            <dt>Couleur</dt>
            <dd>{detail.technicalQa.colorProfileKey}</dd>
            <dt>Audio</dt>
            <dd>{detail.technicalQa.audioProfileKey}</dd>
          </dl>
          {detail.technicalQa.checks.length > 0 && (
            <ul className="simple-list">
              {detail.technicalQa.checks.map((check) => (
                <li key={check.key}>
                  <strong>{check.key}</strong>
                  <span>{check.status}</span>
                  {check.message && <small>{check.message}</small>}
                </li>
              ))}
            </ul>
          )}
        </article>

        <article className="panel">
          <p className="eyebrow">LINEAGE</p>
          <h2>Version exacte</h2>
          <dl className="detail-list lineage-list">
            <dt>Render</dt>
            <dd>{detail.renderId}</dd>
            <dt>RenderAttempt</dt>
            <dd>
              #{detail.lineage.attemptNumber} · {detail.lineage.renderAttemptId}
            </dd>
            <dt>EditingPlanVersion</dt>
            <dd>{detail.lineage.editingPlanVersionId}</dd>
            <dt>CreativePlanVersion</dt>
            <dd>{detail.lineage.creativePlanVersionId}</dd>
            <dt>Output Asset</dt>
            <dd>{detail.lineage.outputAssetId}</dd>
          </dl>
        </article>
      </section>

      {detail.decisionAllowed && (
        <section className="panel decision-panel render-decision-panel">
          <div className="section-head">
            <div>
              <p className="eyebrow">DÉCISION HUMAINE FINALE</p>
              <h2>Approuver ou rejeter ce master exact</h2>
            </div>
            <span className="badge">Gate 2/2</span>
          </div>

          <label htmlFor="render-reason">Raison du rejet</label>
          <select
            id="render-reason"
            value={reasonCode}
            onChange={(event) => setReasonCode(event.target.value)}
          >
            <option value="">Requise uniquement pour rejeter</option>
            <option value="PACING_TOO_SLOW">Pacing trop lent</option>
            <option value="PACING_TOO_FAST">Pacing trop rapide</option>
            <option value="CUTS_TOO_MECHANICAL">Cuts trop mécaniques</option>
            <option value="CAPTIONS_TOO_BUSY">Sous-titres trop chargés</option>
            <option value="PRODUCT_NOT_VISIBLE_ENOUGH">Produit pas assez visible</option>
            <option value="HOOK_VISUALLY_WEAK">Hook visuel faible</option>
            <option value="SOUND_TOO_BUSY">Sound design trop chargé</option>
            <option value="CTA_TOO_LONG">CTA trop long</option>
            <option value="GREEN_SCREEN_BAD_PLACEMENT">Placement fond vert incorrect</option>
            <option value="SCRIPT_VISUAL_MISMATCH">Décalage script / visuel</option>
            <option value="OTHER">Autre</option>
          </select>

          <label htmlFor="render-comment">Commentaire de review</label>
          <textarea
            id="render-comment"
            rows={4}
            maxLength={1000}
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            placeholder="Optionnel · précisez ce qui doit changer."
          />

          <div className="decision-actions">
            <button
              className="approve-button"
              disabled={busy}
              onClick={() => void onDecision('APPROVED', undefined, comment)}
            >
              Approuver le rendu final
            </button>
            <button
              className="reject-button"
              disabled={busy || !reasonCode}
              onClick={() => void onDecision('REJECTED', reasonCode || undefined, comment)}
            >
              Rejeter le rendu
            </button>
          </div>
        </section>
      )}

      <AppLink href="/review" onNavigate={onNavigate} className="text-link">
        Retour à la file de review
      </AppLink>
    </>
  );
}

function formatDateTime(value: string | null) {
  return value ? new Date(value).toLocaleString('fr-FR') : 'Non renseigné';
}

function formatBytes(value: string | null) {
  if (!value) return 'Non renseignée';
  const size = Number(value);
  if (!Number.isFinite(size)) return `${value} octets`;
  if (size < 1024) return `${size} o`;
  if (size < 1024 ** 2) return `${(size / 1024).toFixed(1)} Kio`;
  if (size < 1024 ** 3) return `${(size / 1024 ** 2).toFixed(1)} Mio`;
  return `${(size / 1024 ** 3).toFixed(1)} Gio`;
}

function ManualHandoffView({
  pathname,
  items,
  detail,
  busy,
  onNavigate,
  onComplete,
}: {
  pathname: string;
  items: ManualHandoffItem[];
  detail: ManualHandoffDetail | null;
  busy: boolean;
  onNavigate: (path: string) => void;
  onComplete: (remoteUrl?: string) => Promise<void>;
}) {
  const publicationId = pathname.match(/^\/manual-publish\/([0-9a-f-]+)$/)?.[1];
  const [remoteUrl, setRemoteUrl] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [copyNotice, setCopyNotice] = useState('');

  useEffect(() => {
    setRemoteUrl(detail?.remoteUrl ?? '');
    setConfirmed(false);
    setCopyNotice('');
  }, [detail?.publicationId]);

  async function copyText(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopyNotice(`${label} copié.`);
    } catch {
      setCopyNotice('Copie impossible depuis ce navigateur. Sélectionnez le texte manuellement.');
    }
  }

  if (!publicationId) {
    return (
      <>
        <section className="page-heading">
          <p className="eyebrow">TIKTOK — HANDOFF MANUEL</p>
          <h1>À publier sur TikTok</h1>
          <p>
            Vision prépare la vidéo et les métadonnées. La publication finale reste une action
            humaine dans l’application TikTok : aucun Direct Post API n’est utilisé.
          </p>
        </section>
        {!items.length ? (
          <section className="panel empty-state">
            <h2>Aucun handoff TikTok prêt</h2>
            <p>Les publications dues apparaîtront ici après passage à READY FOR MANUAL PUBLISH.</p>
          </section>
        ) : (
          <section className="support-grid" aria-label="Handoffs TikTok prêts">
            {items.map((item) => (
              <article className="support-card" key={item.publicationId}>
                <div className="support-card-head">
                  <span className="badge">TIKTOK</span>
                  <span className="badge subtle">PRÊT MANUELLEMENT</span>
                </div>
                <h2>{item.accountName}</h2>
                <p>{item.captionPreview}</p>
                <dl className="detail-list compact">
                  <dt>Heure cible</dt>
                  <dd>{formatDateTime(item.scheduledAt)}</dd>
                  <dt>Hashtags</dt>
                  <dd>{item.hashtagCount}</dd>
                </dl>
                {item.commercialDisclosureReminder && (
                  <p className="manual-warning">Rappel de divulgation commerciale requis.</p>
                )}
                <AppLink
                  href={`/manual-publish/${item.publicationId}`}
                  onNavigate={onNavigate}
                  className="text-link"
                >
                  Ouvrir le handoff
                </AppLink>
              </article>
            ))}
          </section>
        )}
      </>
    );
  }

  if (!detail || detail.publicationId !== publicationId) {
    return (
      <section className="panel" aria-busy="true">
        <p>Chargement du handoff TikTok…</p>
      </section>
    );
  }

  const hashtags = detail.metadata.hashtags
    .map((tag) => (tag.startsWith('#') ? tag : `#${tag}`))
    .join(' ');
  const completeText = [detail.metadata.caption.trim(), hashtags].filter(Boolean).join('\n\n');

  return (
    <>
      <section className="page-heading">
        <p className="eyebrow">TIKTOK — HANDOFF MANUEL</p>
        <h1>{detail.accountName}</h1>
        <p>
          Téléchargez la vidéo, copiez le paquet éditorial, publiez dans TikTok puis confirmez ici
          uniquement lorsque la publication distante existe réellement.
        </p>
      </section>

      <section className="manual-handoff-layout">
        <article className="panel review-player-panel">
          <div className="support-card-head">
            <span className="badge">TIKTOK</span>
            <span className="badge subtle">{detail.status.replaceAll('_', ' ')}</span>
          </div>
          <video
            controls
            preload="metadata"
            src={`/api/manual-publish/${detail.publicationId}/media`}
            aria-label="Prévisualisation privée TikTok"
          />
          <div className="actions">
            <a
              className="secondary-button download-link"
              href={`/api/manual-publish/${detail.publicationId}/download`}
              download
            >
              Télécharger la vidéo
            </a>
          </div>
          <dl className="detail-list compact">
            <dt>Heure cible</dt>
            <dd>{formatDateTime(detail.scheduledAt)}</dd>
            <dt>Format</dt>
            <dd>
              {detail.media.width ?? '?'} × {detail.media.height ?? '?'} ·{' '}
              {detail.media.durationMs
                ? `${(detail.media.durationMs / 1000).toFixed(1)} s`
                : 'durée inconnue'}
            </dd>
            <dt>Asset</dt>
            <dd>
              <code>{detail.media.assetId.slice(0, 8)}</code>
            </dd>
          </dl>
        </article>

        <div className="manual-handoff-stack">
          <article className="panel">
            <p className="eyebrow">PAQUET ÉDITORIAL</p>
            <h2>Légende</h2>
            <pre className="copy-block">{detail.metadata.caption}</pre>
            <div className="actions">
              <button
                className="secondary-button"
                type="button"
                onClick={() => void copyText(detail.metadata.caption, 'Légende')}
              >
                Copier la légende
              </button>
            </div>

            <h3>Hashtags</h3>
            <pre className="copy-block">{hashtags || 'Aucun hashtag'}</pre>
            <div className="actions">
              <button
                className="secondary-button"
                type="button"
                onClick={() => void copyText(hashtags, 'Hashtags')}
                disabled={!hashtags}
              >
                Copier les hashtags
              </button>
              <button
                className="secondary-button"
                type="button"
                onClick={() => void copyText(completeText, 'Texte complet')}
              >
                Copier tout
              </button>
            </div>
            {copyNotice && (
              <p className="live-status" role="status" aria-live="polite">
                {copyNotice}
              </p>
            )}

            {detail.metadata.ctaNotes && (
              <>
                <h3>CTA</h3>
                <p>{detail.metadata.ctaNotes}</p>
              </>
            )}
            {detail.metadata.coverRecommendation && (
              <>
                <h3>Couverture</h3>
                <p>{detail.metadata.coverRecommendation}</p>
              </>
            )}
          </article>

          <article className="panel manual-completion-panel">
            <p className="eyebrow">APRÈS PUBLICATION DANS TIKTOK</p>
            {detail.metadata.commercialDisclosureReminder && (
              <div className="manual-warning" role="note">
                Vérifiez le réglage de divulgation commerciale approprié dans TikTok avant de
                publier. Vision ne l’active pas à votre place.
              </div>
            )}

            {detail.completionAllowed ? (
              <>
                <label>
                  URL TikTok publiée — optionnelle
                  <input
                    type="url"
                    inputMode="url"
                    placeholder="https://www.tiktok.com/@.../video/..."
                    value={remoteUrl}
                    onChange={(event) => setRemoteUrl(event.target.value)}
                  />
                </label>
                <label className="confirmation-check">
                  <input
                    type="checkbox"
                    checked={confirmed}
                    onChange={(event) => setConfirmed(event.target.checked)}
                  />
                  <span>Je confirme que cette vidéo a réellement été publiée dans TikTok.</span>
                </label>
                <button
                  type="button"
                  className="primary-button"
                  disabled={busy || !confirmed}
                  onClick={() => void onComplete(remoteUrl.trim() || undefined)}
                >
                  Marquer comme publiée
                </button>
              </>
            ) : (
              <>
                <p>Cette publication a déjà été confirmée dans l’état canonique.</p>
                <dl className="detail-list compact">
                  <dt>Publiée</dt>
                  <dd>{formatDateTime(detail.publishedAt)}</dd>
                </dl>
                {detail.remoteUrl && (
                  <a className="text-link" href={detail.remoteUrl} target="_blank" rel="noreferrer">
                    Ouvrir la publication TikTok
                  </a>
                )}
              </>
            )}
          </article>
        </div>
      </section>

      <AppLink href="/manual-publish" onNavigate={onNavigate} className="text-link">
        Retour aux handoffs TikTok
      </AppLink>
    </>
  );
}

function CalendarView({ model }: { model: CalendarReadModel | null }) {
  return (
    <>
      <section className="page-heading">
        <p className="eyebrow">LECTURE SEULE</p>
        <h1>Calendrier</h1>
        <p>
          État canonique des publications déjà planifiées. Le scheduler Phase 7A peut les faire
          avancer, mais cette vue reste volontairement en lecture seule.
        </p>
      </section>
      {!model ? (
        <section className="panel" aria-busy="true">
          <p>Chargement du calendrier…</p>
        </section>
      ) : !model.entries.length ? (
        <section className="panel empty-state">
          <h2>Aucune publication planifiée</h2>
          <p>Aucun scheduling canonique n’est actuellement présent.</p>
        </section>
      ) : (
        <section className="support-grid" aria-label="Publications planifiées">
          {model.entries.map((entry) => (
            <article className="support-card" key={entry.publicationId}>
              <div className="support-card-head">
                <span className="badge">{entry.platform}</span>
                <span className="badge subtle">{entry.status.replaceAll('_', ' ')}</span>
              </div>
              <h2>{entry.accountName}</h2>
              <dl className="detail-list compact">
                <dt>Prévue</dt>
                <dd>{formatDateTime(entry.scheduledAt)}</dd>
                <dt>Mode</dt>
                <dd>{entry.deliveryMode.replaceAll('_', ' ')}</dd>
                <dt>Render</dt>
                <dd>
                  <code>{entry.renderId.slice(0, 8)}</code>
                </dd>
              </dl>
            </article>
          ))}
        </section>
      )}
    </>
  );
}

function PublishedView({ model }: { model: PublishedReadModel | null }) {
  return (
    <>
      <section className="page-heading">
        <p className="eyebrow">LECTURE SEULE</p>
        <h1>Publiées</h1>
        <p>
          Publications déjà présentes dans l’état canonique. Aucun upload distant, retry ou
          reconcile n’est déclenché directement depuis cette page.
        </p>
      </section>
      {!model ? (
        <section className="panel" aria-busy="true">
          <p>Chargement des publications…</p>
        </section>
      ) : !model.entries.length ? (
        <section className="panel empty-state">
          <h2>Aucune publication enregistrée</h2>
          <p>Aucune publication canonique terminée n’est actuellement présente.</p>
        </section>
      ) : (
        <section className="support-grid" aria-label="Publications terminées">
          {model.entries.map((entry) => (
            <article className="support-card" key={entry.publicationId}>
              <div className="support-card-head">
                <span className="badge">{entry.platform}</span>
                <span className="badge subtle">Publié</span>
              </div>
              <h2>{entry.accountName}</h2>
              <dl className="detail-list compact">
                <dt>Publié</dt>
                <dd>{formatDateTime(entry.publishedAt)}</dd>
                <dt>Mode</dt>
                <dd>{entry.deliveryMode.replaceAll('_', ' ')}</dd>
                <dt>Render</dt>
                <dd>
                  <code>{entry.renderId.slice(0, 8)}</code>
                </dd>
              </dl>
              {entry.remoteUrl && (
                <a className="text-link" href={entry.remoteUrl} target="_blank" rel="noreferrer">
                  Ouvrir la publication distante
                </a>
              )}
            </article>
          ))}
        </section>
      )}
    </>
  );
}

function AssetsView({
  pathname,
  items,
  detail,
  onNavigate,
}: {
  pathname: string;
  items: AssetReadItem[];
  detail: AssetReadDetail | null;
  onNavigate: (path: string) => void;
}) {
  if (pathname === '/assets') {
    return (
      <>
        <section className="page-heading">
          <p className="eyebrow">MÉDIAS PRIVÉS</p>
          <h1>Assets</h1>
          <p>
            Métadonnées techniques et usages canoniques, sans exposition des chemins de stockage.
          </p>
        </section>
        {!items.length ? (
          <section className="panel empty-state">
            <h2>Aucun asset</h2>
            <p>La médiathèque canonique est vide.</p>
          </section>
        ) : (
          <section className="support-grid" aria-label="Assets">
            {items.map((asset) => (
              <article className="support-card" key={asset.assetId}>
                <div className="support-card-head">
                  <span className="badge">{asset.kind}</span>
                  <span className="badge subtle">{asset.status}</span>
                </div>
                <h2>{asset.sourceType}</h2>
                <p className="muted">{asset.mimeType ?? 'Type MIME non renseigné'}</p>
                <dl className="detail-list compact">
                  <dt>Taille</dt>
                  <dd>{formatBytes(asset.sizeBytes)}</dd>
                  <dt>Créé</dt>
                  <dd>{formatDateTime(asset.createdAt)}</dd>
                </dl>
                <AppLink
                  href={`/assets/${asset.assetId}`}
                  onNavigate={onNavigate}
                  className="text-link"
                >
                  Inspecter l’asset
                </AppLink>
              </article>
            ))}
          </section>
        )}
      </>
    );
  }

  if (!detail)
    return (
      <section className="panel" aria-busy="true">
        <p>Chargement de l’asset…</p>
      </section>
    );

  const usageTotal = Object.values(detail.usage).reduce((sum, count) => sum + count, 0);
  return (
    <>
      <section className="page-heading">
        <p className="eyebrow">ASSET · {detail.kind}</p>
        <h1>Asset {detail.assetId.slice(0, 8)}</h1>
        <p>
          {detail.status} · {detail.sourceType}
        </p>
      </section>
      <section className="detail-two-column">
        <article className="panel">
          <h2>Métadonnées techniques</h2>
          <dl className="detail-list">
            <dt>MIME</dt>
            <dd>{detail.mimeType ?? 'Non renseigné'}</dd>
            <dt>Taille</dt>
            <dd>{formatBytes(detail.sizeBytes)}</dd>
            <dt>Dimensions</dt>
            <dd>
              {detail.width && detail.height
                ? `${detail.width} × ${detail.height}`
                : 'Non renseignées'}
            </dd>
            <dt>Durée</dt>
            <dd>
              {detail.durationMs === null
                ? 'Non renseignée'
                : `${(detail.durationMs / 1000).toFixed(1)} s`}
            </dd>
            <dt>FPS</dt>
            <dd>{detail.fps ?? 'Non renseigné'}</dd>
            <dt>Audio</dt>
            <dd>
              {detail.audioChannels === null
                ? 'Non renseigné'
                : `${detail.audioChannels} canal(aux) · ${detail.sampleRate ?? '?'} Hz`}
            </dd>
            <dt>Créé</dt>
            <dd>{formatDateTime(detail.createdAt)}</dd>
          </dl>
        </article>
        <article className="panel">
          <h2>Lineage & usages</h2>
          <dl className="detail-list">
            <dt>Source</dt>
            <dd>
              {detail.sourceEntityType
                ? `${detail.sourceEntityType} · ${detail.sourceEntityId?.slice(0, 8) ?? '?'}`
                : detail.sourceType}
            </dd>
            <dt>Références</dt>
            <dd>{usageTotal}</dd>
            <dt>Dérivé de</dt>
            <dd>{detail.derivation.parent?.sourceAssetId.slice(0, 8) ?? 'Aucun'}</dd>
            <dt>Dérivés</dt>
            <dd>{detail.derivation.children.length}</dd>
          </dl>
          <p className="muted">Les bucket/object keys restent volontairement hors du navigateur.</p>
        </article>
      </section>
      <AppLink href="/assets" onNavigate={onNavigate} className="text-link">
        Retour aux assets
      </AppLink>
    </>
  );
}

function PatternsView({ items }: { items: PatternReadItem[] }) {
  return (
    <>
      <section className="page-heading">
        <p className="eyebrow">PATTERN LIBRARY</p>
        <h1>Patterns</h1>
        <p>
          Définitions versionnées disponibles pour la création, sans leaderboard de performance.
        </p>
      </section>
      {!items.length ? (
        <section className="panel empty-state">
          <h2>Aucun pattern importé</h2>
          <p>La bibliothèque persistée est vide.</p>
        </section>
      ) : (
        <section className="support-grid" aria-label="Patterns">
          {items.map((pattern) => (
            <article className="support-card" key={pattern.patternId}>
              <div className="support-card-head">
                <span className="badge">{pattern.status}</span>
                <span>v{pattern.latestVersion?.version ?? '—'}</span>
              </div>
              <h2>{pattern.name}</h2>
              <code className="definition-key">{pattern.key}</code>
              <p>{pattern.latestVersion?.description ?? 'Aucune description persistée.'}</p>
              <dl className="detail-list compact">
                <dt>Versions</dt>
                <dd>{pattern.versionCount}</dd>
                <dt>Usage latest</dt>
                <dd>{pattern.usageCount}</dd>
                <dt>Confiance</dt>
                <dd>{pattern.latestVersion?.confidence ?? 'Non renseignée'}</dd>
              </dl>
            </article>
          ))}
        </section>
      )}
    </>
  );
}

function TemplatesView({ items }: { items: TemplateReadItem[] }) {
  return (
    <>
      <section className="page-heading">
        <p className="eyebrow">VIDEO ENGINE</p>
        <h1>Templates</h1>
        <p>Contrats de rendu versionnés en lecture seule. Aucun éditeur JSON n’est exposé.</p>
      </section>
      {!items.length ? (
        <section className="panel empty-state">
          <h2>Aucun template importé</h2>
          <p>Le registre persisté est vide.</p>
        </section>
      ) : (
        <section className="support-grid" aria-label="Templates">
          {items.map((template) => (
            <article className="support-card" key={template.templateId}>
              <div className="support-card-head">
                <span className="badge">{template.status}</span>
                <span>v{template.latestVersion?.version ?? '—'}</span>
              </div>
              <h2>{template.name}</h2>
              <code className="definition-key">{template.key}</code>
              <dl className="detail-list compact">
                <dt>Renderer</dt>
                <dd>{template.latestVersion?.rendererVersion ?? 'Non renseigné'}</dd>
                <dt>Ratios</dt>
                <dd>
                  {template.latestVersion?.supportedAspectRatios.join(', ') || 'Non renseignés'}
                </dd>
                <dt>Creative plans</dt>
                <dd>{template.latestVersion?.usage.creativePlans ?? 0}</dd>
                <dt>Editing plans</dt>
                <dd>{template.latestVersion?.usage.editingPlans ?? 0}</dd>
              </dl>
            </article>
          ))}
        </section>
      )}
    </>
  );
}

function SettingsView({ summary }: { summary: SettingsSummary | null }) {
  if (!summary)
    return (
      <section className="panel" aria-busy="true">
        <p>Chargement des réglages…</p>
      </section>
    );
  const switches = [
    ['Publication en pause', summary.safety.pauseAllPublishing],
    ['Génération IA en pause', summary.safety.pauseAiGeneration],
    ['Capture en pause', summary.safety.pauseCapture],
    ['Rendering en pause', summary.safety.pauseRendering],
    ['Analytics en pause', summary.safety.pauseAnalyticsCollection],
    ['Providers réels activés', summary.safety.realProvidersEnabled],
  ] as const;
  return (
    <>
      <section className="page-heading">
        <p className="eyebrow">CONFIGURATION MASQUÉE</p>
        <h1>Réglages</h1>
        <p>État opérationnel sans secrets, credentials ni valeurs sensibles.</p>
      </section>
      <section className="detail-two-column">
        <article className="panel">
          <h2>Runtime</h2>
          <dl className="detail-list">
            <dt>Environnement</dt>
            <dd>{summary.environment}</dd>
            <dt>Auth</dt>
            <dd>{summary.authMode}</dd>
            <dt>Stockage</dt>
            <dd>{summary.storageMode}</dd>
            <dt>Origin web</dt>
            <dd>{summary.webOrigin}</dd>
            <dt>Writes publication</dt>
            <dd>Phase 7</dd>
            <dt>Evidence analytics</dt>
            <dd>Phase 8</dd>
          </dl>
        </article>
        <article className="panel">
          <h2>Safety switches</h2>
          <ul className="status-list">
            {switches.map(([name, enabled]) => (
              <li key={name}>
                <span>{name}</span>
                <strong>{enabled ? 'Oui' : 'Non'}</strong>
              </li>
            ))}
          </ul>
        </article>
      </section>
      <section className="panel">
        <div className="section-head">
          <div>
            <p className="eyebrow">PLATEFORMES</p>
            <h2>Comptes configurés</h2>
          </div>
        </div>
        {!summary.platformAccounts.length ? (
          <p className="muted">Aucun compte plateforme configuré.</p>
        ) : (
          <div className="support-grid compact-grid">
            {summary.platformAccounts.map((account) => (
              <article className="support-card" key={account.id}>
                <div className="support-card-head">
                  <span className="badge">{account.platform}</span>
                  <span className="badge subtle">{account.status}</span>
                </div>
                <h3>{account.displayName}</h3>
                <p className="muted">
                  Credentials :{' '}
                  {account.credentialsConfigured ? 'référence configurée' : 'non configurée'} ·
                  capacités : {account.capabilitiesConfigured ? 'configurées' : 'non configurées'}
                </p>
              </article>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

function DistributionView({
  model,
  busy,
  onReconcile,
  onCancel,
  onReschedule,
  onRefreshAccount,
}: {
  model: DistributionOverview | null;
  busy: boolean;
  onReconcile: (publicationId: string) => Promise<void>;
  onCancel: (publicationId: string) => Promise<void>;
  onReschedule: (publicationId: string, scheduledAt: string) => Promise<void>;
  onRefreshAccount: (accountId: string) => Promise<void>;
}) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  return (
    <>
      <section className="page-heading">
        <p className="eyebrow">PHASE 7E</p>
        <h1>Distribution</h1>
        <p>
          Réconciliation des états ambigus, planification sûre et santé des comptes. Aucun bouton ne
          contourne PUBLISHING_UNKNOWN.
        </p>
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">COMPTES</p>
            <h2>Santé des plateformes</h2>
          </div>
          <span className="status-chip">
            Providers réels {model?.safety.realProvidersEnabled ? 'activés' : 'désactivés'}
          </span>
        </div>
        {!model ? (
          <p>Chargement…</p>
        ) : model.accounts.length === 0 ? (
          <p>Aucun compte plateforme configuré.</p>
        ) : (
          <div className="support-grid">
            {model.accounts.map((account) => (
              <article className="support-card" key={account.id}>
                <p className="eyebrow">{account.platform}</p>
                <h3>{account.displayName}</h3>
                <dl className="detail-list compact-list">
                  <div>
                    <dt>État</dt>
                    <dd>{account.status}</dd>
                  </div>
                  <div>
                    <dt>Credentials</dt>
                    <dd>{account.credentialsConfigured ? 'Configurés' : 'Absents'}</dd>
                  </div>
                  <div>
                    <dt>Capabilities</dt>
                    <dd>
                      {account.capabilities
                        ? `Vérifiées ${new Date(account.capabilities.checkedAt).toLocaleString('fr-FR')}`
                        : 'Non vérifiées'}
                    </dd>
                  </div>
                </dl>
                {account.capabilities?.limitations.length ? (
                  <p className="support-note">{account.capabilities.limitations.join(' · ')}</p>
                ) : null}
                <button
                  className="secondary-button"
                  disabled={busy || !account.refreshAllowed}
                  onClick={() => void onRefreshAccount(account.id)}
                >
                  Vérifier le compte
                </button>
                {!account.refreshAllowed && (
                  <p className="support-note">
                    Refresh distant verrouillé tant que le provider live n’est pas activé.
                  </p>
                )}
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">OPÉRATIONS</p>
            <h2>Publications à piloter</h2>
          </div>
        </div>
        {!model ? (
          <p>Chargement…</p>
        ) : model.publications.length === 0 ? (
          <p>Aucune publication ne nécessite de contrôle opérateur.</p>
        ) : (
          <div className="support-grid">
            {model.publications.map((publication) => (
              <article className="support-card" key={publication.publicationId}>
                <p className="eyebrow">{publication.platform}</p>
                <h3>{publication.accountName}</h3>
                <dl className="detail-list compact-list">
                  <div>
                    <dt>Publication</dt>
                    <dd>{publication.status}</dd>
                  </div>
                  <div>
                    <dt>Compte</dt>
                    <dd>{publication.accountStatus}</dd>
                  </div>
                  <div>
                    <dt>Mode</dt>
                    <dd>{publication.deliveryMode}</dd>
                  </div>
                  <div>
                    <dt>Prévue</dt>
                    <dd>
                      {publication.scheduledAt
                        ? new Date(publication.scheduledAt).toLocaleString('fr-FR')
                        : '—'}
                    </dd>
                  </div>
                  <div>
                    <dt>Dernier attempt</dt>
                    <dd>
                      {publication.latestAttempt
                        ? `${publication.latestAttempt.status}${publication.latestAttempt.failureCode ? ` · ${publication.latestAttempt.failureCode}` : ''}`
                        : 'Aucun'}
                    </dd>
                  </div>
                </dl>
                <div className="distribution-actions">
                  {publication.actions.reconcile && (
                    <button
                      className="primary-button"
                      disabled={busy}
                      onClick={() => void onReconcile(publication.publicationId)}
                    >
                      Demander la réconciliation
                    </button>
                  )}
                  {publication.actions.reschedule && (
                    <div className="reschedule-control">
                      <label htmlFor={`reschedule-${publication.publicationId}`}>
                        Nouvelle heure
                      </label>
                      <input
                        id={`reschedule-${publication.publicationId}`}
                        type="datetime-local"
                        value={drafts[publication.publicationId] ?? ''}
                        onChange={(event) =>
                          setDrafts((current) => ({
                            ...current,
                            [publication.publicationId]: event.target.value,
                          }))
                        }
                      />
                      <button
                        className="secondary-button"
                        disabled={busy || !drafts[publication.publicationId]}
                        onClick={() => {
                          const value = drafts[publication.publicationId];
                          if (!value) return;
                          void onReschedule(
                            publication.publicationId,
                            new Date(value).toISOString(),
                          );
                        }}
                      >
                        Replanifier
                      </button>
                    </div>
                  )}
                  {publication.actions.cancel && (
                    <button
                      className="ghost-button"
                      disabled={busy}
                      onClick={() => void onCancel(publication.publicationId)}
                    >
                      Annuler
                    </button>
                  )}
                </div>
                {publication.status === 'PUBLISHING_UNKNOWN' && (
                  <p className="support-note">
                    Aucun retry direct n’est autorisé avant preuve de réconciliation.
                  </p>
                )}
              </article>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

function AnalyticsView({
  model,
  manual,
  busy,
  onSubmit,
}: {
  model: AnalyticsReadModel | null;
  manual: TikTokManualAnalyticsOverview | null;
  busy: boolean;
  onSubmit: (jobAttemptId: string, values: Record<string, number>) => Promise<void>;
}) {
  const [drafts, setDrafts] = useState<Record<string, Record<string, string>>>({});
  const duePrompts =
    manual?.prompts.filter((prompt) => ['DUE', 'OVERDUE'].includes(prompt.state)) ?? [];

  function update(jobAttemptId: string, key: string, value: string) {
    setDrafts((current) => ({
      ...current,
      [jobAttemptId]: { ...current[jobAttemptId], [key]: value },
    }));
  }

  const metricFields = [
    ['views', 'Vues'],
    ['likes', 'Likes'],
    ['comments', 'Commentaires'],
    ['shares', 'Partages'],
    ['saves', 'Favoris'],
    ['avgWatchDurationMs', 'Durée moyenne (ms)'],
    ['completionRate', 'Taux complétion (0–1)'],
    ['profileVisits', 'Visites profil'],
    ['follows', 'Abonnements'],
  ] as const;

  const funnelStages = model
    ? ([
        ['Visites', model.funnel.websiteVisits],
        ['Inscriptions', model.funnel.signups],
        ['Activations', model.funnel.activations],
        ['Clients', model.funnel.customers],
      ] as const)
    : [];

  function metric(value: string | number | null) {
    return value === null ? 'Indisponible' : String(value);
  }

  function age(seconds: number | null) {
    if (seconds === null) return 'Indisponible';
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)} min`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} h`;
    return `${Math.floor(seconds / 86400)} j`;
  }

  function confidence(counts: ConfidenceCounts) {
    return `Direct ${counts.direct} · Inféré ${counts.inferred} · Inconnu ${counts.unknown}`;
  }

  return (
    <>
      <section className="page-heading">
        <p className="eyebrow">PHASE 8 · ÉVIDENCE</p>
        <h1>Analytics</h1>
        <p>
          Lecture canonique des mesures, du funnel et de l’attribution. Une donnée indisponible
          reste indisponible : elle ne devient jamais zéro.
        </p>
      </section>

      <section className="panel analytics-funnel-panel">
        <div className="section-heading analytics-section-heading">
          <div>
            <p className="eyebrow">FUNNEL MÉTIER</p>
            <h2>De la visite au client</h2>
          </div>
          <p className="support-note">Attribution directe, inférée et inconnue restent séparées.</p>
        </div>
        <div className="metric-grid analytics-funnel-grid">
          {funnelStages.map(([label, counts]) => (
            <article className="metric-card analytics-funnel-card" key={label}>
              <span>{label}</span>
              <strong>{counts.total}</strong>
              <small>{confidence(counts)}</small>
            </article>
          ))}
        </div>
        <div className="analytics-revenue-row">
          <div>
            <span className="support-note">Événements revenu</span>
            <strong>{model?.funnel.revenueEvents.total ?? 0}</strong>
          </div>
          <div className="analytics-revenue-values">
            {(model?.funnel.revenueByCurrency.length ?? 0) === 0 ? (
              <span className="support-note">Aucun revenu observé.</span>
            ) : (
              model?.funnel.revenueByCurrency.map((row) => (
                <span className="status-pill" key={row.currency}>
                  {row.currency} {row.amountMinor} unités mineures · {row.eventCount} événement(s)
                </span>
              ))
            )}
          </div>
        </div>
      </section>

      <section className="analytics-two-column">
        <article className="panel">
          <div className="section-heading analytics-section-heading">
            <div>
              <p className="eyebrow">FRAÎCHEUR & QUALITÉ</p>
              <h2>État des preuves</h2>
            </div>
          </div>
          <dl className="detail-list analytics-detail-list">
            <dt>Dernière mesure</dt>
            <dd>
              {model?.freshness.latestEvidenceAt
                ? new Date(model.freshness.latestEvidenceAt).toLocaleString('fr-FR')
                : 'Indisponible'}
            </dd>
            <dt>Âge</dt>
            <dd>{age(model?.freshness.ageSeconds ?? null)}</dd>
            <dt>Publications sans mesure</dt>
            <dd>{model?.freshness.publicationsWithoutMeasurement ?? 0}</dd>
          </dl>
          <div className="analytics-quality-list">
            {(model?.quality.states.length ?? 0) === 0 ? (
              <p className="empty-state">Aucun état qualité matérialisé actuellement.</p>
            ) : (
              model?.quality.states.map((state) => (
                <span className="status-pill" key={state.code}>
                  {state.code} · {state.count}
                </span>
              ))
            )}
          </div>
        </article>

        <article className="panel">
          <div className="section-heading analytics-section-heading">
            <div>
              <p className="eyebrow">ATTRIBUTION GLOBALE</p>
              <h2>Confiance explicite</h2>
            </div>
          </div>
          <div className="analytics-confidence-grid">
            <div>
              <span>Direct</span>
              <strong data-testid="analytics-direct-total">{model?.attribution.direct ?? 0}</strong>
            </div>
            <div>
              <span>Inféré</span>
              <strong data-testid="analytics-inferred-total">
                {model?.attribution.inferred ?? 0}
              </strong>
            </div>
            <div>
              <span>Inconnu</span>
              <strong>{model?.attribution.unknown ?? 0}</strong>
            </div>
          </div>
          <p className="support-note">
            Les événements inférés ne sont jamais fusionnés silencieusement avec les attributions
            directes.
          </p>
        </article>
      </section>

      <section className="panel">
        <div className="section-heading analytics-section-heading">
          <div>
            <p className="eyebrow">PLATEFORMES</p>
            <h2>Couverture de mesure</h2>
          </div>
        </div>
        <div className="analytics-platform-grid">
          {(model?.platforms.length ?? 0) === 0 ? (
            <p className="empty-state">Aucune publication mesurable.</p>
          ) : (
            model?.platforms.map((platform) => (
              <article className="support-card analytics-platform-card" key={platform.platform}>
                <div className="analytics-card-header">
                  <h3>{platform.platform}</h3>
                  <span className="status-pill">
                    {platform.measuredCount}/{platform.publishedCount} mesurée(s)
                  </span>
                </div>
                <p className="support-note">{confidence(platform.attribution)}</p>
                {platform.warnings.map((warning) => (
                  <p className="analytics-warning" key={warning}>
                    {warning}
                  </p>
                ))}
              </article>
            ))
          )}
        </div>
      </section>

      <section className="panel">
        <div className="section-heading analytics-section-heading">
          <div>
            <p className="eyebrow">CONTENU</p>
            <h2>Performance par publication</h2>
          </div>
          <p className="support-note">
            Dernière observation disponible par publication, sans classement ni score.
          </p>
        </div>
        <div className="analytics-publication-list">
          {(model?.publications.length ?? 0) === 0 ? (
            <p className="empty-state">Aucune publication publiée.</p>
          ) : (
            model?.publications.map((publication) => (
              <article
                className="support-card analytics-publication-card"
                key={publication.publicationId}
              >
                <div className="analytics-card-header">
                  <div>
                    <p className="eyebrow">
                      {publication.platform} · {publication.accountName}
                    </p>
                    <h3>{publication.title}</h3>
                    <p className="support-note">{publication.campaignName}</p>
                  </div>
                  <span className="status-pill">
                    {publication.measurement?.windowLabel ?? 'Sans mesure'}
                  </span>
                </div>
                <div className="analytics-publication-metrics">
                  <div>
                    <span>Vues</span>
                    <strong>{metric(publication.measurement?.metrics.views ?? null)}</strong>
                  </div>
                  <div>
                    <span>Likes</span>
                    <strong data-testid="analytics-publication-likes">
                      {metric(publication.measurement?.metrics.likes ?? null)}
                    </strong>
                  </div>
                  <div>
                    <span>Commentaires</span>
                    <strong data-testid="analytics-publication-comments">
                      {metric(publication.measurement?.metrics.comments ?? null)}
                    </strong>
                  </div>
                  <div>
                    <span>Partages</span>
                    <strong>{metric(publication.measurement?.metrics.shares ?? null)}</strong>
                  </div>
                </div>
                <p className="support-note">
                  Attribution : {confidence(publication.attribution)} · mesure{' '}
                  {publication.measurement
                    ? `âgée de ${age(publication.measurement.ageSeconds)}`
                    : 'indisponible'}
                </p>
                {publication.measurement?.availabilityStatus !== 'AVAILABLE' &&
                  publication.measurement && (
                    <p className="analytics-warning">
                      Qualité : {publication.measurement.availabilityStatus}
                    </p>
                  )}
                {publication.measurement?.notes.map((note) => (
                  <p className="support-note" key={note}>
                    {note}
                  </p>
                ))}
                {publication.remoteUrl && (
                  <a href={publication.remoteUrl} target="_blank" rel="noreferrer">
                    Ouvrir la publication
                  </a>
                )}
              </article>
            ))
          )}
        </div>
      </section>

      {(model?.experiments.length ?? 0) > 0 && (
        <section className="panel">
          <div className="section-heading analytics-section-heading">
            <div>
              <p className="eyebrow">EXPÉRIENCES</p>
              <h2>Métadonnées observables</h2>
            </div>
            <p className="support-note">
              Aucun gagnant ni conclusion causale n’est produit en Phase 8.
            </p>
          </div>
          <div className="analytics-experiment-list">
            {model?.experiments.map((experiment) => (
              <article className="support-card" key={experiment.id}>
                <div className="analytics-card-header">
                  <h3>{experiment.name}</h3>
                  <span className="status-pill">{experiment.status}</span>
                </div>
                <p>{experiment.hypothesis}</p>
                <p className="support-note">
                  Métrique primaire : {experiment.primaryMetric ?? 'Non définie'} ·{' '}
                  {experiment.arms.length} bras
                </p>
              </article>
            ))}
          </div>
        </section>
      )}

      <section className="panel">
        <div className="section-heading analytics-section-heading">
          <div>
            <p className="eyebrow">TIKTOK · SAISIE MANUELLE</p>
            <h2>Mesures dues</h2>
          </div>
          <p className="support-note">
            TikTok reste en saisie manuelle. Les champs laissés vides restent indisponibles et ne
            deviennent jamais zéro.
          </p>
        </div>
        <section className="metric-grid analytics-summary">
          <article className="metric-card">
            <span>À saisir</span>
            <strong data-testid="analytics-due-count">{manual?.summary.due ?? 0}</strong>
          </article>
          <article className="metric-card">
            <span>En retard</span>
            <strong data-testid="analytics-overdue-count">{manual?.summary.overdue ?? 0}</strong>
          </article>
          <article className="metric-card">
            <span>À venir</span>
            <strong data-testid="analytics-upcoming-count">{manual?.summary.upcoming ?? 0}</strong>
          </article>
          <article className="metric-card">
            <span>Terminées</span>
            <strong data-testid="analytics-completed-count">
              {manual?.summary.completed ?? 0}
            </strong>
          </article>
        </section>
        {duePrompts.length === 0 ? (
          <p className="empty-state">Aucune mesure TikTok n’est due pour le moment.</p>
        ) : (
          <div className="analytics-manual-list">
            {duePrompts.map((prompt) => {
              const draft = drafts[prompt.jobAttemptId] ?? {};
              return (
                <article className="analytics-manual-card" key={prompt.jobAttemptId}>
                  <div className="analytics-manual-card__header">
                    <div>
                      <p className="eyebrow">{prompt.windowKey.replace('T_PLUS_', 'T+')}</p>
                      <h3>{prompt.accountName}</h3>
                    </div>
                    <span className={`status-pill ${prompt.materiallyOverdue ? 'danger' : ''}`}>
                      {prompt.materiallyOverdue ? 'En retard' : 'À saisir'}
                    </span>
                  </div>
                  <p className="support-note">
                    Due : {new Date(prompt.dueAt).toLocaleString('fr-FR')}
                  </p>
                  {prompt.remoteUrl && (
                    <a href={prompt.remoteUrl} target="_blank" rel="noreferrer">
                      Ouvrir la publication TikTok
                    </a>
                  )}
                  <div className="analytics-manual-fields">
                    {metricFields.map(([key, label]) => (
                      <label key={key}>
                        {label}
                        <input
                          data-testid={`analytics-${prompt.jobAttemptId}-${key}`}
                          inputMode="decimal"
                          type="number"
                          min="0"
                          step={key === 'completionRate' ? '0.01' : '1'}
                          value={draft[key] ?? ''}
                          onChange={(event) => update(prompt.jobAttemptId, key, event.target.value)}
                        />
                      </label>
                    ))}
                  </div>
                  <button
                    className="primary-button"
                    data-testid={`analytics-submit-${prompt.jobAttemptId}`}
                    disabled={busy || !Object.values(draft).some((value) => value !== '')}
                    onClick={() => {
                      const values = Object.fromEntries(
                        Object.entries(draft)
                          .filter(([, value]) => value !== '')
                          .map(([key, value]) => [key, Number(value)]),
                      );
                      void onSubmit(prompt.jobAttemptId, values);
                    }}
                  >
                    Enregistrer la mesure
                  </button>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}

function learningValue(value: number | null) {
  return value === null ? 'Indisponible' : String(value);
}

function learningConfidence(value: string) {
  return value.replaceAll('_', ' ');
}

function countSummary(values: { value: string; count: number }[]) {
  return values.map((row) => `${row.value} (${row.count})`).join(', ') || 'Indisponible';
}

function sourceAuthoritySummary(value: Record<string, string>) {
  const entries = Object.entries(value);
  return entries.length
    ? entries.map(([key, source]) => `${key}: ${source}`).join(' · ')
    : 'Indisponible';
}

function LearningView({
  pathname,
  reports,
  detail,
  busy,
  onNavigate,
  onTransition,
  onCreateProposal,
}: {
  pathname: string;
  reports: LearningReportSummary[];
  detail: LearningWeeklyReport | null;
  busy: boolean;
  onNavigate: (path: string) => void;
  onTransition: (
    recommendationId: string,
    transition: 'accept' | 'reject' | 'execute',
  ) => Promise<void>;
  onCreateProposal: (recommendationId: string) => Promise<void>;
}) {
  if (pathname === '/learning') {
    return (
      <>
        <section className="page-heading">
          <p className="eyebrow">PHASE 9 · LEARNING LOOP</p>
          <h1>Learning</h1>
          <p>
            Rapports hebdomadaires descriptifs. Les limites restent visibles et aucune stratégie
            n’est modifiée automatiquement.
          </p>
        </section>

        {!reports.length ? (
          <section className="panel empty-state">
            <h2>Aucun rapport hebdomadaire</h2>
            <p>Aucun run WEEKLY_ANALYSIS canonique n’est encore disponible.</p>
          </section>
        ) : (
          <section className="learning-report-list" aria-label="Rapports hebdomadaires">
            {reports.map((report) => (
              <article className="panel learning-report-card" key={report.analysisOperationKey}>
                <div className="analytics-card-header">
                  <div>
                    <p className="eyebrow">WEEKLY ANALYSIS</p>
                    <h2>
                      {new Date(report.analysisWindow.from).toLocaleDateString('fr-FR')} →{' '}
                      {new Date(report.analysisWindow.to).toLocaleDateString('fr-FR')}
                    </h2>
                  </div>
                  <span className="status-pill">{report.status}</span>
                </div>
                <dl className="detail-list analytics-detail-list">
                  <dt>Fenêtre</dt>
                  <dd>[from, to) UTC</dd>
                  <dt>Mesure</dt>
                  <dd>{report.measurementWindow}</dd>
                  <dt>Insights</dt>
                  <dd>{report.insightCount}</dd>
                </dl>
                <AppLink
                  href={`/learning/${report.analysisOperationKey}`}
                  onNavigate={onNavigate}
                  className="text-link"
                >
                  Ouvrir le rapport
                </AppLink>
              </article>
            ))}
          </section>
        )}
      </>
    );
  }

  if (!detail) {
    return (
      <section className="panel" aria-busy="true">
        <p>Chargement du rapport Learning…</p>
      </section>
    );
  }

  const outcomeRows = [
    ['Visites site', detail.businessOutcomes.websiteVisits],
    ['Inscriptions', detail.businessOutcomes.signups],
    ['Activations', detail.businessOutcomes.activations],
    ['Clients', detail.businessOutcomes.customers],
  ] as const;

  return (
    <>
      <section className="page-heading">
        <p className="eyebrow">LEARNING · {detail.status}</p>
        <h1>Rapport hebdomadaire</h1>
        <p>
          {new Date(detail.analysisWindow.from).toLocaleString('fr-FR')} →{' '}
          {new Date(detail.analysisWindow.to).toLocaleString('fr-FR')} · fenêtre half-open UTC ·{' '}
          {detail.measurementWindow}
        </p>
      </section>

      <section className="panel learning-section">
        <div className="section-heading analytics-section-heading">
          <div>
            <p className="eyebrow">1 / 8</p>
            <h2>Business outcomes</h2>
          </div>
          <p className="support-note">Snapshot gelé du run 9E · autorités séparées.</p>
        </div>
        <div className="metric-grid analytics-funnel-grid">
          {outcomeRows.map(([label, value]) => (
            <article className="metric-card analytics-funnel-card" key={label}>
              <span>{label}</span>
              <strong>{learningValue(value.total)}</strong>
              <small>{value.sourceSystem}</small>
            </article>
          ))}
        </div>
        <dl className="detail-list analytics-detail-list">
          <dt>Revenue</dt>
          <dd>
            {detail.businessOutcomes.revenueByCurrency.length
              ? detail.businessOutcomes.revenueByCurrency
                  .map((row) => `${row.amountMinor} minor units ${row.currency}`)
                  .join(', ')
              : 'Indisponible'}{' '}
            · {detail.businessOutcomes.revenueEvents.sourceSystem}
          </dd>
          <dt>DIRECT publication links</dt>
          <dd>
            {learningValue(detail.businessOutcomes.attributionSummary.directPublicationLinks)}
          </dd>
          <dt>INFERRED signals</dt>
          <dd>{learningValue(detail.businessOutcomes.attributionSummary.inferredSignals)}</dd>
          <dt>UNKNOWN signals</dt>
          <dd>{learningValue(detail.businessOutcomes.attributionSummary.unknownSignals)}</dd>
        </dl>
        <p className="support-note">
          La décomposition DIRECT / INFERRED / UNKNOWN n’est jamais inventée lorsqu’elle n’existe
          pas dans le snapshot d’attribution gelé.
        </p>
      </section>

      <section className="panel learning-section">
        <div className="section-heading analytics-section-heading">
          <div>
            <p className="eyebrow">2 / 8</p>
            <h2>Funnel</h2>
          </div>
        </div>
        <div className="metric-grid analytics-funnel-grid">
          {detail.funnel.map((stage) => (
            <article className="metric-card analytics-funnel-card" key={stage.stage}>
              <span>{stage.stage}</span>
              <strong>
                {learningValue(stage.value)}
                {stage.value !== null && stage.unit ? ` ${stage.unit}` : ''}
              </strong>
              <small>{stage.availability}</small>
            </article>
          ))}
        </div>
        <p className="support-note">Une étape sans preuve reste Indisponible, jamais zéro.</p>
      </section>

      <section className="panel learning-section">
        <div className="section-heading analytics-section-heading">
          <div>
            <p className="eyebrow">3 / 8</p>
            <h2>Platform performance</h2>
          </div>
          <p className="support-note">
            Métriques gelées par plateforme, sans équivalence implicite.
          </p>
        </div>
        {!detail.platformPerformance.length ? (
          <p className="empty-state">Aucune publication comparable dans ce run.</p>
        ) : (
          <div className="analytics-platform-grid">
            {detail.platformPerformance.map((platform) => (
              <article className="support-card" key={platform.platform}>
                <div className="analytics-card-header">
                  <h3>{platform.platform}</h3>
                  <span className="status-pill">{platform.publicationCount} publication(s)</span>
                </div>
                {platform.metrics.map((metric) => (
                  <div className="learning-metric" key={`${platform.platform}-${metric.metric}`}>
                    <strong>{metric.metric}</strong>
                    <span>
                      Valeurs{' '}
                      {metric.observedValues.length
                        ? metric.observedValues.join(', ')
                        : 'Indisponible'}
                    </span>
                    <small>
                      sample comparable {metric.comparableSampleSize} · indisponibles{' '}
                      {metric.unavailableCount}
                    </small>
                    <small>sémantique {metric.semanticVersions.join(', ') || 'Indisponible'}</small>
                    {metric.limitations.map((limit) => (
                      <small className="analytics-warning" key={limit}>
                        {limit}
                      </small>
                    ))}
                  </div>
                ))}
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="panel learning-section">
        <div className="section-heading analytics-section-heading">
          <div>
            <p className="eyebrow">4 / 8</p>
            <h2>Content / Pattern signals</h2>
          </div>
        </div>
        {detail.contentSignals.length ? (
          <div className="learning-signal-list">
            {detail.contentSignals.map((signal) => (
              <article className="support-card" key={signal.insightId}>
                <span className="status-pill">{learningConfidence(signal.confidence)}</span>
                <p>{signal.statement}</p>
                <p className="support-note">
                  n={signal.sampleSize} · {signal.measurementWindow}
                </p>
                <strong>Limites</strong>
                <ul>
                  {signal.limitations.map((limit) => (
                    <li key={limit}>{limit}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        ) : (
          <p className="empty-state">Aucun signal Content/Pattern explicite.</p>
        )}
        <dl className="detail-list analytics-detail-list">
          <dt>PatternVersion observés</dt>
          <dd>{countSummary(detail.contentContext.patternVersionIds)}</dd>
          <dt>hookType observés</dt>
          <dd>{countSummary(detail.contentContext.hookTypes)}</dd>
          <dt>formats observés</dt>
          <dd>{countSummary(detail.contentContext.primaryFormats)}</dd>
          <dt>CTA observées</dt>
          <dd>{countSummary(detail.contentContext.ctaTypes)}</dd>
        </dl>
      </section>

      <section className="panel learning-section">
        <div className="section-heading analytics-section-heading">
          <div>
            <p className="eyebrow">5 / 8</p>
            <h2>Editing signals</h2>
          </div>
        </div>
        {detail.editingSignals.length ? (
          <div className="learning-signal-list">
            {detail.editingSignals.map((signal) => (
              <article className="support-card" key={signal.insightId}>
                <span className="status-pill">{learningConfidence(signal.confidence)}</span>
                <p>{signal.statement}</p>
                <p className="support-note">
                  profiles {signal.editingProfileVersionIds.join(', ')} · n={signal.sampleSize} ·{' '}
                  {signal.measurementWindow}
                </p>
                <strong>Limites</strong>
                <ul>
                  {signal.limitations.map((limit) => (
                    <li key={limit}>{limit}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        ) : (
          <p className="empty-state">Aucun signal Editing explicite.</p>
        )}
        <dl className="detail-list analytics-detail-list">
          <dt>EditingProfileVersion observés</dt>
          <dd>{countSummary(detail.editingContext.editingProfileVersionIds)}</dd>
          <dt>TemplateVersion observés</dt>
          <dd>{countSummary(detail.editingContext.templateVersionIds)}</dd>
          <dt>durées observées</dt>
          <dd>{countSummary(detail.editingContext.durationsMs)}</dd>
        </dl>
      </section>

      <section className="panel learning-section">
        <div className="section-heading analytics-section-heading">
          <div>
            <p className="eyebrow">6 / 8</p>
            <h2>Experiments</h2>
          </div>
          <p className="support-note">Readiness et observations descriptives seulement.</p>
        </div>
        {!detail.experiments.length ? (
          <p className="empty-state">Aucune expérience dans l’évidence gelée.</p>
        ) : (
          <div className="analytics-experiment-list">
            {detail.experiments.map((experiment) => (
              <article className="support-card" key={experiment.experimentId}>
                <div className="analytics-card-header">
                  <h3>{experiment.name}</h3>
                  <span className="status-pill">{experiment.status}</span>
                </div>
                <p>{experiment.hypothesis}</p>
                <p className="support-note">
                  primaryMetric {experiment.primaryMetric ?? 'Indisponible'} · readiness{' '}
                  {experiment.readiness} · {experiment.measurementWindow}
                </p>
                {experiment.arms.map((arm) => (
                  <div className="learning-metric" key={`${experiment.experimentId}-${arm.label}`}>
                    <strong>Arm {arm.label}</strong>
                    <span>valeur {learningValue(arm.metricValue)}</span>
                    <small>
                      {arm.readiness} · {arm.platform ?? 'plateforme indisponible'} · sémantique{' '}
                      {arm.metricSemanticsVersion ?? 'Indisponible'}
                    </small>
                    {arm.limitations.map((limit) => (
                      <small key={limit}>{limit}</small>
                    ))}
                  </div>
                ))}
                <strong>Limites</strong>
                <ul>
                  {experiment.limitations.map((limit) => (
                    <li key={limit}>{limit}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="panel learning-section">
        <div className="section-heading analytics-section-heading">
          <div>
            <p className="eyebrow">7 / 8</p>
            <h2>Anomalies / data quality</h2>
          </div>
        </div>
        <dl className="detail-list analytics-detail-list">
          <dt>Publications exclues</dt>
          <dd>{detail.dataQuality.excludedPublicationCount}</dd>
          <dt>Métriques NULL / indisponibles</dt>
          <dd>{detail.dataQuality.unavailableMetricCount}</dd>
        </dl>
        {detail.dataQuality.issues.length ? (
          <ul className="analytics-quality-list">
            {detail.dataQuality.issues.map((issue, index) => (
              <li key={`${issue.category}-${index}`}>
                <strong>{issue.category}</strong> · {issue.detail}
              </li>
            ))}
          </ul>
        ) : (
          <p className="empty-state">Aucune limitation supplémentaire matérialisée.</p>
        )}
      </section>

      <section className="panel learning-section">
        <div className="section-heading analytics-section-heading">
          <div>
            <p className="eyebrow">WHY</p>
            <h2>Insights & evidence</h2>
          </div>
        </div>
        {detail.insights.map((insight) => (
          <article className="support-card learning-insight-card" key={insight.id}>
            <span className="status-pill">{learningConfidence(insight.confidence)}</span>
            <p>{insight.statement}</p>
            <p className="support-note">
              n cité={insight.citedSampleSize} · n semaine=
              {insight.weeklySampleSize ?? 'Indisponible'} · {insight.measurementWindow}
            </p>
            <p className="support-note">
              policy {insight.sourceContext.evidencePolicyVersion ?? 'Indisponible'} · plateformes{' '}
              {insight.sourceContext.platforms.join(', ') || 'Indisponible'}
            </p>
            <p className="support-note">
              source context {sourceAuthoritySummary(insight.sourceContext.sourceAuthority)}
            </p>
            <strong>Limites</strong>
            <ul>
              {insight.limitations.map((limit) => (
                <li key={limit}>{limit}</li>
              ))}
            </ul>
          </article>
        ))}
      </section>

      <section className="panel learning-section">
        <div className="section-heading analytics-section-heading">
          <div>
            <p className="eyebrow">8 / 8</p>
            <h2>Recommendations for next week</h2>
          </div>
        </div>
        {!detail.recommendations.length ? (
          <p className="empty-state">Aucune Recommendation durable.</p>
        ) : (
          <div className="learning-recommendation-list">
            {detail.recommendations.map((recommendation) => (
              <article className="support-card" key={recommendation.id}>
                <div className="analytics-card-header">
                  <h3>{recommendation.title}</h3>
                  <span className="status-pill">{recommendation.status}</span>
                </div>
                {recommendation.description && <p>{recommendation.description}</p>}
                {recommendation.recommendedTest && (
                  <dl className="detail-list analytics-detail-list">
                    <dt>Hypothèse</dt>
                    <dd>{recommendation.recommendedTest.hypothesis}</dd>
                    <dt>Changement</dt>
                    <dd>{recommendation.recommendedTest.change}</dd>
                    <dt>Constantes</dt>
                    <dd>{recommendation.recommendedTest.keepConstant.join(', ') || 'Aucune'}</dd>
                    <dt>Métrique</dt>
                    <dd>{recommendation.recommendedTest.primaryMetric}</dd>
                    <dt>Fenêtre</dt>
                    <dd>{recommendation.recommendedTest.measurementWindow}</dd>
                  </dl>
                )}
                <div className="learning-actions">
                  {recommendation.status === 'PROPOSED' && (
                    <>
                      <button
                        className="primary-button"
                        disabled={busy}
                        onClick={() => void onTransition(recommendation.id, 'accept')}
                      >
                        Accepter
                      </button>
                      <button
                        className="ghost-button"
                        disabled={busy}
                        onClick={() => void onTransition(recommendation.id, 'reject')}
                      >
                        Rejeter
                      </button>
                    </>
                  )}
                  {recommendation.status === 'ACCEPTED' && !recommendation.experimentProposal && (
                    <button
                      className="primary-button"
                      disabled={busy}
                      onClick={() => void onCreateProposal(recommendation.id)}
                    >
                      Create experiment proposal
                    </button>
                  )}
                  {recommendation.status === 'ACCEPTED' && (
                    <button
                      className="ghost-button"
                      disabled={busy}
                      onClick={() => void onTransition(recommendation.id, 'execute')}
                    >
                      Marquer exécutée
                    </button>
                  )}
                </div>
                {recommendation.experimentProposal && (
                  <p className="support-note">
                    Experiment DRAFT {recommendation.experimentProposal.experimentId.slice(0, 8)} ·
                    aucune génération automatique déclenchée.
                  </p>
                )}
              </article>
            ))}
          </div>
        )}
        <p className="support-note">
          Accepter ne modifie aucune stratégie. La proposition d’expérience reste une action humaine
          séparée.
        </p>
      </section>

      <AppLink href="/learning" onNavigate={onNavigate} className="text-link">
        Retour aux rapports Learning
      </AppLink>
    </>
  );
}

function DeferredView({ pathname }: { pathname: string }) {
  const base = `/${pathname.split('/').filter(Boolean)[0] ?? ''}`;
  const content = deferredTitles[base] ?? {
    title: 'Page introuvable',
    note: 'Cette route n’est pas disponible dans la tranche actuelle.',
  };

  return (
    <section className="panel empty-state">
      <p className="eyebrow">PHASE 6</p>
      <h1>{content.title}</h1>
      <p>{content.note}</p>
    </section>
  );
}

function App() {
  const [pathname, setPathname] = usePathname();
  const [csrf, setCsrf] = useState('');
  const [accessKey, setAccessKey] = useState('');
  const [dashboard, setDashboard] = useState<DashboardSummary | null>(null);
  const [attention, setAttention] = useState<AttentionItem[] | null>(null);
  const [concepts, setConcepts] = useState<ConceptReviewItem[]>([]);
  const [conceptDetail, setConceptDetail] = useState<ConceptReviewDetail | null>(null);
  const [productions, setProductions] = useState<ProductionItem[]>([]);
  const [productionDetail, setProductionDetail] = useState<ProductionDetail | null>(null);
  const [reviews, setReviews] = useState<RenderReviewItem[]>([]);
  const [reviewDetail, setReviewDetail] = useState<RenderReviewDetail | null>(null);
  const [calendar, setCalendar] = useState<CalendarReadModel | null>(null);
  const [published, setPublished] = useState<PublishedReadModel | null>(null);
  const [manualHandoffs, setManualHandoffs] = useState<ManualHandoffItem[]>([]);
  const [manualHandoffDetail, setManualHandoffDetail] = useState<ManualHandoffDetail | null>(null);
  const [assets, setAssets] = useState<AssetReadItem[]>([]);
  const [assetDetail, setAssetDetail] = useState<AssetReadDetail | null>(null);
  const [patterns, setPatterns] = useState<PatternReadItem[]>([]);
  const [templates, setTemplates] = useState<TemplateReadItem[]>([]);
  const [settings, setSettings] = useState<SettingsSummary | null>(null);
  const [distribution, setDistribution] = useState<DistributionOverview | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsReadModel | null>(null);
  const [analyticsManual, setAnalyticsManual] = useState<TikTokManualAnalyticsOverview | null>(
    null,
  );
  const [learningReports, setLearningReports] = useState<LearningReportSummary[]>([]);
  const [learningDetail, setLearningDetail] = useState<LearningWeeklyReport | null>(null);
  const [packs, setPacks] = useState<Pack[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const section = useMemo(
    () =>
      navigation.find(([path]) =>
        path === '/' ? pathname === '/' : pathname === path || pathname.startsWith(`${path}/`),
      )?.[1] ?? 'Vision',
    [pathname],
  );

  function navigate(path: string) {
    if (path === window.location.pathname) return;
    window.history.pushState({}, '', path);
    setPathname(path);
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  async function refresh() {
    const productionVersionId = pathname.match(/^\/production\/([0-9a-f-]+)$/)?.[1];
    const reviewRenderId = pathname.match(/^\/review\/([0-9a-f-]+)$/)?.[1];
    const manualPublicationId = pathname.match(/^\/manual-publish\/([0-9a-f-]+)$/)?.[1];
    const assetId = pathname.match(/^\/assets\/([0-9a-f-]+)$/)?.[1];
    const [
      summary,
      items,
      conceptQueue,
      productionQueue,
      reviewQueue,
      manualQueue,
      calendarRead,
      publishedRead,
      assetList,
      patternList,
      templateList,
      settingsRead,
      distributionRead,
      analyticsRead,
      analyticsManualRead,
      learningRead,
      recordingPacks,
      currentProduction,
      currentReview,
      currentManualHandoff,
      currentAsset,
    ] = await Promise.all([
      call('dashboard', csrf),
      call('attention', csrf),
      call('concepts/review', csrf),
      call('production', csrf),
      call('review', csrf),
      call('manual-publish', csrf),
      call('calendar', csrf),
      call('published', csrf),
      call('assets', csrf),
      call('patterns', csrf),
      call('templates', csrf),
      call('settings/summary', csrf),
      call('distribution', csrf),
      call('analytics', csrf),
      call('analytics/manual', csrf),
      call('learning', csrf),
      call('recording-packs', csrf),
      productionVersionId ? call(`production/${productionVersionId}`, csrf) : Promise.resolve(null),
      reviewRenderId ? call(`review/${reviewRenderId}`, csrf) : Promise.resolve(null),
      manualPublicationId
        ? call(`manual-publish/${manualPublicationId}`, csrf)
        : Promise.resolve(null),
      assetId ? call(`assets/${assetId}`, csrf) : Promise.resolve(null),
    ]);

    setDashboard(summary as DashboardSummary);
    setAttention(items as AttentionItem[]);
    setConcepts(conceptQueue as ConceptReviewItem[]);
    setProductions(productionQueue as ProductionItem[]);
    setReviews(reviewQueue as RenderReviewItem[]);
    setManualHandoffs(manualQueue as ManualHandoffItem[]);
    setCalendar(calendarRead as CalendarReadModel);
    setPublished(publishedRead as PublishedReadModel);
    setAssets(assetList as AssetReadItem[]);
    setPatterns(patternList as PatternReadItem[]);
    setTemplates(templateList as TemplateReadItem[]);
    setSettings(settingsRead as SettingsSummary);
    setDistribution(distributionRead as DistributionOverview);
    setAnalytics(analyticsRead as AnalyticsReadModel);
    setAnalyticsManual(analyticsManualRead as TikTokManualAnalyticsOverview);
    setLearningReports(learningRead as LearningReportSummary[]);
    setPacks(recordingPacks as Pack[]);
    if (productionVersionId) setProductionDetail(currentProduction as ProductionDetail);
    if (reviewRenderId) setReviewDetail(currentReview as RenderReviewDetail);
    if (manualPublicationId) setManualHandoffDetail(currentManualHandoff as ManualHandoffDetail);
    if (assetId) setAssetDetail(currentAsset as AssetReadDetail);
  }

  useEffect(() => {
    void call('session', '')
      .then((value) => setCsrf((value as { csrf: string }).csrf))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (csrf) void refresh().catch((caught) => setError(String(caught.message)));
  }, [csrf]);

  useEffect(() => {
    const learningKey = pathname.match(/^\/learning\/([a-f0-9]{64})$/)?.[1];
    if (!csrf || !learningKey) {
      setLearningDetail(null);
      return;
    }

    setLearningDetail(null);
    void call(`learning/${learningKey}`, csrf)
      .then((value) => setLearningDetail(value as LearningWeeklyReport))
      .catch((caught) => setError(caught instanceof Error ? caught.message : 'Action impossible.'));
  }, [csrf, pathname]);

  useEffect(() => {
    const conceptVersionId = pathname.match(/^\/concepts\/([0-9a-f-]+)$/)?.[1];
    if (!csrf || !conceptVersionId) {
      setConceptDetail(null);
      return;
    }

    setConceptDetail(null);
    void call(`concepts/${conceptVersionId}`, csrf)
      .then((value) => setConceptDetail(value as ConceptReviewDetail))
      .catch((caught) => setError(caught instanceof Error ? caught.message : 'Action impossible.'));
  }, [csrf, pathname]);

  useEffect(() => {
    const creativePlanVersionId = pathname.match(/^\/production\/([0-9a-f-]+)$/)?.[1];
    if (!csrf || !creativePlanVersionId) {
      setProductionDetail(null);
      return;
    }

    setProductionDetail(null);
    void call(`production/${creativePlanVersionId}`, csrf)
      .then((value) => setProductionDetail(value as ProductionDetail))
      .catch((caught) => setError(caught instanceof Error ? caught.message : 'Action impossible.'));
  }, [csrf, pathname]);

  useEffect(() => {
    const renderId = pathname.match(/^\/review\/([0-9a-f-]+)$/)?.[1];
    if (!csrf || !renderId) {
      setReviewDetail(null);
      return;
    }

    setReviewDetail(null);
    void call(`review/${renderId}`, csrf)
      .then((value) => setReviewDetail(value as RenderReviewDetail))
      .catch((caught) => setError(caught instanceof Error ? caught.message : 'Action impossible.'));
  }, [csrf, pathname]);

  useEffect(() => {
    const publicationId = pathname.match(/^\/manual-publish\/([0-9a-f-]+)$/)?.[1];
    if (!csrf || !publicationId) {
      setManualHandoffDetail(null);
      return;
    }

    setManualHandoffDetail(null);
    void call(`manual-publish/${publicationId}`, csrf)
      .then((value) => setManualHandoffDetail(value as ManualHandoffDetail))
      .catch((caught) => setError(caught instanceof Error ? caught.message : 'Action impossible.'));
  }, [csrf, pathname]);

  useEffect(() => {
    const assetId = pathname.match(/^\/assets\/([0-9a-f-]+)$/)?.[1];
    if (!csrf || !assetId) {
      setAssetDetail(null);
      return;
    }

    setAssetDetail(null);
    void call(`assets/${assetId}`, csrf)
      .then((value) => setAssetDetail(value as AssetReadDetail))
      .catch((caught) => setError(caught instanceof Error ? caught.message : 'Action impossible.'));
  }, [csrf, pathname]);

  async function action(work: () => Promise<void>) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await work();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Action impossible.');
    } finally {
      setBusy(false);
    }
  }

  async function login(event: FormEvent) {
    event.preventDefault();
    await action(async () => {
      try {
        const result = (await call('session', '', { accessKey })) as { csrf: string };
        setCsrf(result.csrf);
      } finally {
        setAccessKey('');
      }
    });
  }

  async function upload(request: RecordingRequest, files: FileList | null) {
    if (!files?.length || busy) return;

    await action(async () => {
      try {
        for (const file of Array.from(files)) {
          if (file.size > 512 * 1024 * 1024) throw new Error(errors.UPLOAD_TOO_LARGE);

          const response = await fetch(`/api/recording-requests/${request.id}/upload`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/octet-stream',
              'X-CSRF-Token': csrf,
            },
            credentials: 'same-origin',
            body: file,
          });

          if (!response.ok) {
            const body = (await response.json()) as { message?: string };
            throw new Error(errors[body.message ?? ''] ?? errors.UPLOAD_FAILED);
          }
        }

        setNotice('Prises reçues. Prévisualisez-les puis choisissez celles à conserver.');
      } finally {
        await refresh();
      }
    });
  }

  function drop(event: DragEvent, request: RecordingRequest) {
    event.preventDefault();
    void upload(request, event.dataTransfer.files);
  }

  if (loading)
    return (
      <main className="loading-screen" aria-busy="true">
        <p>Chargement…</p>
      </main>
    );

  if (!csrf)
    return (
      <>
        {error && (
          <div className="global-message error" role="alert">
            {error}
          </div>
        )}
        <Login
          accessKey={accessKey}
          setAccessKey={setAccessKey}
          busy={busy}
          onSubmit={(event) => void login(event)}
        />
      </>
    );

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            V
          </span>
          <div>
            <strong>Vision</strong>
            <span>Content Engine</span>
          </div>
        </div>

        <nav aria-label="Navigation principale">
          {navigation.map(([path, label]) => (
            <AppLink
              key={path}
              href={path}
              current={pathname === path || (path !== '/' && pathname.startsWith(`${path}/`))}
              onNavigate={navigate}
            >
              <span>{label}</span>
              {path === '/attention' && dashboard && dashboard.counts.needsAttention > 0 && (
                <span className="nav-count">{dashboard.counts.needsAttention}</span>
              )}
            </AppLink>
          ))}
        </nav>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <div>
            <span className="topbar-label">CONTROL ROOM</span>
            <strong>{section}</strong>
          </div>
          <div className="topbar-actions">
            <button
              className="secondary-button"
              disabled={busy}
              onClick={() => void action(refresh)}
            >
              Actualiser
            </button>
            <button
              className="ghost-button"
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  await call('logout', csrf, {});
                  setCsrf('');
                  setDashboard(null);
                  setAttention(null);
                  setConcepts([]);
                  setConceptDetail(null);
                  setProductions([]);
                  setProductionDetail(null);
                  setReviews([]);
                  setReviewDetail(null);
                  setManualHandoffs([]);
                  setManualHandoffDetail(null);
                  setCalendar(null);
                  setPublished(null);
                  setAssets([]);
                  setAssetDetail(null);
                  setPatterns([]);
                  setTemplates([]);
                  setSettings(null);
                  setDistribution(null);
                  setAnalytics(null);
                  setAnalyticsManual(null);
                  setLearningReports([]);
                  setLearningDetail(null);
                  setPacks([]);
                })
              }
            >
              Se déconnecter
            </button>
          </div>
        </header>

        <main className="content">
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <p className="live-status" role="status" aria-live="polite">
            {busy ? 'Traitement en cours…' : notice}
          </p>

          {pathname === '/' ? (
            <DashboardView summary={dashboard} onNavigate={navigate} />
          ) : pathname === '/attention' ? (
            <AttentionView items={attention} onNavigate={navigate} />
          ) : pathname === '/concepts' || pathname.startsWith('/concepts/') ? (
            <ConceptReviewView
              pathname={pathname}
              concepts={concepts}
              detail={conceptDetail}
              busy={busy}
              onNavigate={navigate}
              onDecision={async (decision, reasonCode, comment) => {
                const conceptVersionId = pathname.match(/^\/concepts\/([0-9a-f-]+)$/)?.[1];
                if (!conceptVersionId) return;

                await action(async () => {
                  await call(`concepts/${conceptVersionId}/decision`, csrf, {
                    decision,
                    ...(reasonCode ? { reasonCode } : {}),
                    ...(comment?.trim() ? { comment: comment.trim() } : {}),
                  });
                  await refresh();
                  setConceptDetail(null);
                  navigate('/concepts');
                  setNotice(
                    decision === 'APPROVED'
                      ? 'Concept approuvé.'
                      : 'Concept rejeté et feedback enregistré.',
                  );
                });
              }}
            />
          ) : pathname === '/production' || pathname.startsWith('/production/') ? (
            <ProductionView
              pathname={pathname}
              items={productions}
              detail={productionDetail}
              packs={packs}
              busy={busy}
              csrf={csrf}
              action={action}
              refresh={refresh}
              upload={upload}
              drop={drop}
              setNotice={setNotice}
              onNavigate={navigate}
            />
          ) : pathname === '/review' || pathname.startsWith('/review/') ? (
            <RenderReviewView
              pathname={pathname}
              items={reviews}
              detail={reviewDetail}
              busy={busy}
              onNavigate={navigate}
              onDecision={async (decision, reasonCode, comment) => {
                const renderId = pathname.match(/^\/review\/([0-9a-f-]+)$/)?.[1];
                if (!renderId) return;

                await action(async () => {
                  await call(`review/${renderId}/decision`, csrf, {
                    decision,
                    ...(reasonCode ? { reasonCode } : {}),
                    ...(comment?.trim() ? { comment: comment.trim() } : {}),
                  });
                  await refresh();
                  setReviewDetail(null);
                  navigate('/review');
                  setNotice(
                    decision === 'APPROVED'
                      ? 'Rendu final approuvé.'
                      : 'Rendu rejeté et feedback enregistré.',
                  );
                });
              }}
            />
          ) : pathname === '/manual-publish' || pathname.startsWith('/manual-publish/') ? (
            <ManualHandoffView
              pathname={pathname}
              items={manualHandoffs}
              detail={manualHandoffDetail}
              busy={busy}
              onNavigate={navigate}
              onComplete={async (remoteUrl) => {
                const publicationId = pathname.match(/^\/manual-publish\/([0-9a-f-]+)$/)?.[1];
                if (!publicationId) return;
                await action(async () => {
                  await call(`manual-publish/${publicationId}/complete`, csrf, {
                    ...(remoteUrl ? { remoteUrl } : {}),
                  });
                  await refresh();
                  setManualHandoffDetail(null);
                  navigate('/published');
                  setNotice('Publication TikTok confirmée dans l’état canonique.');
                });
              }}
            />
          ) : pathname === '/distribution' ? (
            <DistributionView
              model={distribution}
              busy={busy}
              onReconcile={async (publicationId) => {
                await action(async () => {
                  await call(`distribution/${publicationId}/reconcile`, csrf, {});
                  await refresh();
                  setNotice('Réconciliation demandée sans retry aveugle.');
                });
              }}
              onCancel={async (publicationId) => {
                await action(async () => {
                  await call(`distribution/${publicationId}/cancel`, csrf, {});
                  await refresh();
                  setNotice('Publication annulée dans l’état canonique.');
                });
              }}
              onReschedule={async (publicationId, scheduledAt) => {
                await action(async () => {
                  await call(`distribution/${publicationId}/reschedule`, csrf, { scheduledAt });
                  await refresh();
                  setNotice('Publication replanifiée.');
                });
              }}
              onRefreshAccount={async (accountId) => {
                await action(async () => {
                  await call(`distribution/accounts/${accountId}/refresh`, csrf, {});
                  await refresh();
                  setNotice('Santé du compte vérifiée.');
                });
              }}
            />
          ) : pathname === '/calendar' ? (
            <CalendarView model={calendar} />
          ) : pathname === '/published' ? (
            <PublishedView model={published} />
          ) : pathname === '/assets' || pathname.startsWith('/assets/') ? (
            <AssetsView
              pathname={pathname}
              items={assets}
              detail={assetDetail}
              onNavigate={navigate}
            />
          ) : pathname === '/patterns' ? (
            <PatternsView items={patterns} />
          ) : pathname === '/templates' ? (
            <TemplatesView items={templates} />
          ) : pathname === '/settings' ? (
            <SettingsView summary={settings} />
          ) : pathname === '/learning' || pathname.startsWith('/learning/') ? (
            <LearningView
              pathname={pathname}
              reports={learningReports}
              detail={learningDetail}
              busy={busy}
              onNavigate={navigate}
              onTransition={async (recommendationId, transition) => {
                await action(async () => {
                  await call(
                    `learning/recommendations/${recommendationId}/${transition}`,
                    csrf,
                    {},
                  );
                  const learningKey = pathname.match(/^\/learning\/([a-f0-9]{64})$/)?.[1];
                  if (learningKey) {
                    setLearningDetail(
                      (await call(`learning/${learningKey}`, csrf)) as LearningWeeklyReport,
                    );
                  }
                  setLearningReports((await call('learning', csrf)) as LearningReportSummary[]);
                  setNotice('Décision Learning enregistrée.');
                });
              }}
              onCreateProposal={async (recommendationId) => {
                await action(async () => {
                  await call(
                    `learning/recommendations/${recommendationId}/create-experiment-proposal`,
                    csrf,
                    {},
                  );
                  const learningKey = pathname.match(/^\/learning\/([a-f0-9]{64})$/)?.[1];
                  if (learningKey) {
                    setLearningDetail(
                      (await call(`learning/${learningKey}`, csrf)) as LearningWeeklyReport,
                    );
                  }
                  setLearningReports((await call('learning', csrf)) as LearningReportSummary[]);
                  setNotice('Experiment DRAFT créé sans génération automatique.');
                });
              }}
            />
          ) : pathname === '/analytics' ? (
            <AnalyticsView
              model={analytics}
              manual={analyticsManual}
              busy={busy}
              onSubmit={async (jobAttemptId, values) => {
                setBusy(true);
                setError('');
                try {
                  await call(`analytics/manual/${jobAttemptId}/submit`, csrf, values);
                  setNotice('Mesure TikTok enregistrée.');
                  await refresh();
                } catch (caught) {
                  setError(caught instanceof Error ? caught.message : 'Action impossible.');
                } finally {
                  setBusy(false);
                }
              }}
            />
          ) : (
            <DeferredView pathname={pathname} />
          )}
        </main>
      </div>
    </div>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Missing application root');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
