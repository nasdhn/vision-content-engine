import { StrictMode, useEffect, useState } from 'react';
import type { FormEvent, DragEvent } from 'react';
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
type Request = {
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
type Pack = { versionId: string; version: number; status: string; requests: Request[] };
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
};
async function call(path: string, csrf: string, data?: unknown) {
  const response = await fetch(`/api/${path}`, {
    ...(data !== undefined
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
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
function App() {
  const [csrf, setCsrf] = useState('');
  const [key, setKey] = useState('');
  const [packs, setPacks] = useState<Pack[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  async function refresh() {
    setPacks((await call('recording-packs', csrf)) as Pack[]);
  }
  useEffect(() => {
    void call('session', '')
      .then((value) => setCsrf((value as { csrf: string }).csrf))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    if (csrf) void refresh().catch((e) => setError(String(e.message)));
  }, [csrf]);
  async function action(work: () => Promise<void>) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action impossible.');
    } finally {
      setBusy(false);
    }
  }
  async function login(event: FormEvent) {
    event.preventDefault();
    await action(async () => {
      const result = (await call('session', '', { accessKey: key })) as { csrf: string };
      setCsrf(result.csrf);
      setKey('');
    });
  }
  async function upload(request: Request, files: FileList | null) {
    if (!files?.length || busy) return;
    await action(async () => {
      try {
        for (const file of Array.from(files)) {
          if (file.size > 512 * 1024 * 1024) throw new Error(errors.UPLOAD_TOO_LARGE);
          const response = await fetch(`/api/recording-requests/${request.id}/upload`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/octet-stream', 'X-CSRF-Token': csrf },
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
  function drop(event: DragEvent, request: Request) {
    event.preventDefault();
    void upload(request, event.dataTransfer.files);
  }
  if (loading)
    return (
      <main aria-busy="true">
        <p>Chargement…</p>
      </main>
    );
  return (
    <main>
      <header>
        <div>
          <p className="eyebrow">VISION · PRODUCTION</p>
          <h1>Recording Pack</h1>
          <p>Vos enregistrements bruts, prêts pour la prochaine étape.</p>
        </div>
        {csrf && (
          <button
            disabled={busy}
            onClick={() =>
              void action(async () => {
                await call('logout', csrf, {});
                setCsrf('');
                setPacks([]);
              })
            }
          >
            Se déconnecter
          </button>
        )}
      </header>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <p role="status" aria-live="polite">
        {busy ? 'Traitement en cours…' : notice}
      </p>
      {!csrf ? (
        <form onSubmit={(event) => void login(event)}>
          <h2>Accès privé</h2>
          <label htmlFor="access">Clé d’accès locale</label>
          <input
            id="access"
            type="password"
            value={key}
            required
            autoComplete="current-password"
            onChange={(e) => setKey(e.target.value)}
          />
          <button disabled={busy}>Se connecter</button>
        </form>
      ) : (
        <>
          <button disabled={busy} onClick={() => void action(refresh)}>
            Actualiser
          </button>
          {!packs.length && (
            <section>
              <h2>Aucun enregistrement à préparer</h2>
              <p>
                Les demandes apparaîtront lorsque le plan créatif nécessitera votre voix ou une
                vidéo.
              </p>
            </section>
          )}
          {packs.map((pack) => (
            <section key={pack.versionId} aria-label={`Plan créatif version ${pack.version}`}>
              <h2>Plan créatif · version {pack.version}</h2>
              <p>{labels[pack.status] ?? pack.status}</p>
              {pack.requests.map((request) => (
                <article key={request.id}>
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
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => drop(e, request)}
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
                      onChange={(e) => {
                        void upload(request, e.target.files);
                        e.target.value = '';
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
                        {take.warnings.map((w) => (
                          <p key={w} className="warning">
                            {labels[w] ?? w}
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
      )}
    </main>
  );
}
const root = document.getElementById('root');
if (!root) throw new Error('Missing application root');
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
