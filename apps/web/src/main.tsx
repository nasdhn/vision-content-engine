import { StrictMode, useEffect, useMemo, useState } from 'react';
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
  ASSET_NOT_AVAILABLE: 'Fichier indisponible. Envoyez une nouvelle prise.',
  DASHBOARD_OPERATION_FAILED: 'Le tableau de bord est momentanément indisponible.',
  CONCEPT_OPERATION_FAILED: 'La review du concept est momentanément indisponible.',
  CONCEPT_VERSION_NOT_FOUND: 'Cette version de concept est introuvable.',
  STALE_VERSION: 'Une version plus récente existe. Rechargez la review avant de décider.',
  INVALID_TRANSITION: 'Ce concept ne peut plus être validé depuis cet état.',
  EXPLICIT_SELECTION_REQUIRED: 'Une sélection explicite de version est déjà en cours.',
  INVALID_CONCEPT_REASON: 'La raison de rejet n’est pas valide.',
};

const navigation = [
  ['/', 'Vue d’ensemble'],
  ['/attention', 'À traiter'],
  ['/concepts', 'Concepts'],
  ['/production', 'Production'],
  ['/review', 'Review finale'],
  ['/calendar', 'Calendrier'],
  ['/published', 'Publiées'],
  ['/assets', 'Assets'],
  ['/patterns', 'Patterns'],
  ['/templates', 'Templates'],
  ['/settings', 'Réglages'],
  ['/analytics', 'Analytics'],
] as const;

const deferredTitles: Record<string, { title: string; note: string }> = {
  '/review': {
    title: 'Review finale',
    note: 'La review vidéo finale arrive dans la tranche 6D.',
  },
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

function RecordingPackView({
  packs,
  busy,
  csrf,
  action,
  refresh,
  upload,
  drop,
  setNotice,
}: {
  packs: Pack[];
  busy: boolean;
  csrf: string;
  action: (work: () => Promise<void>) => Promise<void>;
  refresh: () => Promise<void>;
  upload: (request: RecordingRequest, files: FileList | null) => Promise<void>;
  drop: (event: DragEvent, request: RecordingRequest) => void;
  setNotice: (value: string) => void;
}) {
  return (
    <>
      <section className="page-heading">
        <p className="eyebrow">PRODUCTION · INPUT HUMAIN</p>
        <h1>Recording Pack</h1>
        <p>Vos enregistrements bruts, prêts pour la prochaine étape.</p>
      </section>

      <button className="secondary-button" disabled={busy} onClick={() => void action(refresh)}>
        Actualiser
      </button>

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
  const [packs, setPacks] = useState<Pack[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const section = useMemo(
    () => navigation.find(([path]) => path === pathname)?.[1] ?? 'Vision',
    [pathname],
  );

  function navigate(path: string) {
    if (path === window.location.pathname) return;
    window.history.pushState({}, '', path);
    setPathname(path);
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  async function refresh() {
    const [summary, items, conceptQueue, recordingPacks] = await Promise.all([
      call('dashboard', csrf),
      call('attention', csrf),
      call('concepts/review', csrf),
      call('recording-packs', csrf),
    ]);

    setDashboard(summary as DashboardSummary);
    setAttention(items as AttentionItem[]);
    setConcepts(conceptQueue as ConceptReviewItem[]);
    setPacks(recordingPacks as Pack[]);
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
          ) : pathname === '/production' ? (
            <RecordingPackView
              packs={packs}
              busy={busy}
              csrf={csrf}
              action={action}
              refresh={refresh}
              upload={upload}
              drop={drop}
              setNotice={setNotice}
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
