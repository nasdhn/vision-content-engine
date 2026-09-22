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

type SettingsSummary = {
  environment: string;
  webOrigin: string;
  authMode: 'LOCAL_SINGLE_USER';
  storageMode: 'PRIVATE_S3_COMPATIBLE';
  publicationMutationAvailable: false;
  analyticsEvidenceAvailable: false;
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
};

const navigation = [
  ['/', 'Vue d’ensemble'],
  ['/attention', 'À traiter'],
  ['/concepts', 'Concepts'],
  ['/production', 'Production'],
  ['/review', 'Review finale'],
  ['/manual-publish', 'TikTok manuel'],
  ['/calendar', 'Calendrier'],
  ['/published', 'Publiées'],
  ['/assets', 'Assets'],
  ['/patterns', 'Patterns'],
  ['/templates', 'Templates'],
  ['/settings', 'Réglages'],
  ['/analytics', 'Analytics'],
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

function AnalyticsDeferredView() {
  return (
    <>
      <section className="page-heading">
        <p className="eyebrow">PHASE 8</p>
        <h1>Analytics</h1>
        <p>
          Cette destination est stable, mais aucune donnée de performance n’est inventée en Phase 6.
        </p>
      </section>
      <section className="panel deferred-boundary">
        <h2>Analytics non activées</h2>
        <p>
          La Phase 8 possédera l’ingestion brute, la normalisation, l’attribution et les
          comparaisons fondées sur des preuves réelles.
        </p>
      </section>
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
      const result = (await call('session', '', { accessKey })) as { csrf: string };
      setCsrf(result.csrf);
      setAccessKey('');
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
          ) : pathname === '/analytics' ? (
            <AnalyticsDeferredView />
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
