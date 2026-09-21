# Phase 4 — Product Capture

Baseline : `main` / `origin/main` / HEAD de départ
`462499dbb38b8e1f397e3e6a54d8aa7c793774e5`.
Branche : `phase/4-product-capture`.

La Phase 4 implémente le Product Capture déterministe de Vision Content Engine conformément
à la spécification gelée `spec-v1.0.2`. Aucun travail de Phase 5 n'est inclus.

## Livré

- Registry canonique des cinq scénarios V1 :
  - `AGENT_QUERY_TO_RESULTS`;
  - `AGENT_RESULT_DETAIL`;
  - `MISSION_RUNNING_TO_DONE`;
  - `PRICING_PAGE`;
  - `LANDING_PRODUCT_PROOF`.
- Profils navigateur et politiques de sécurité versionnés.
- Contrat Zod strict pour CaptureScenarioVersion, DSL, browser profile, fixtures, outputs,
  assertions, sécurité et timeouts.
- Import idempotent des scénarios en PostgreSQL avec identité canonique distincte de l'ID
  PostgreSQL de `CaptureScenarioVersion`.
- Liaison explicite :
  `CreativePlanVersion.requiredCapturesJson.captureScenarioVersionId`
  → `browserConfigJson.specVersionId`
  → `CaptureScenarioVersion.id`.
- Mise en file idempotente des captures requises avec :
  - `clientKey` exact ;
  - `scenarioInput` exact ;
  - `operationId` partagé entre CaptureRun et JobAttempt ;
  - binding audité `CaptureRun.requestBound`.
- Support de plusieurs requêtes utilisant le même scénario avec des `clientKey` et inputs
  différents sans ambiguïté.
- Readiness Capture intégrée à la readiness Production ; `succeedRun()` rafraîchit le
  CreativePlan atomiquement.
- Exécuteur Playwright déterministe avec BrowserContext frais par run.
- Authentification derrière un provider de storage-state secret-backed ; aucune donnée
  d'authentification dans les seeds/scénarios/assets/logs.
- DSL borné :
  `NAVIGATE`, `CLICK`, `FILL`, `PRESS`, `WAIT_FOR`, `ASSERT`, `SCREENSHOT`,
  `MARK_MOMENT`, `VISUAL_SETTLE`.
- Vérification de sécurité de l'URL effective après navigation/action afin de détecter
  redirections et navigations hors origine autorisée.
- Blocage des chemins interdits, popups et downloads selon la politique V1.
- Pas de `networkidle`, pas de JavaScript arbitraire provenant des scénarios, pas de
  navigation libre par LLM.
- Capture screenshots, vidéos, frames et traces.
- Finalisation vidéo seulement après fermeture du BrowserContext.
- Validation PNG et probe vidéo avec ffprobe.
- Diagnostics d'échec : screenshot sûr + trace + compteurs structurés.
- Staging privé des outputs avec :
  - clés serveur immuables ;
  - taille bornée ;
  - SHA-256 local ;
  - upload stockage privé ;
  - relecture complète ;
  - vérification taille/checksum ;
  - metadata technique ;
  - finalisation Asset séparée.
- Finalisation canonique protégée par leases/fencing PostgreSQL :
  un worker stale ne peut finaliser ni Asset ni CaptureRun.
- Orchestrateur Capture complet :
  résolution `JobAttempt → operationId → CaptureRun → clientKey → CaptureRequest`;
  exécution ; heartbeat ; staging ; finalisation fenced ; succès/échec stable.
- Heartbeats pendant les opérations externes longues.
- Politique `CAPTURE = RECONCILE` : aucune reprise aveugle après lease expiré.
- Diagnostics privés d'un échec Playwright finalisés avant le passage du run/job à FAILED.
- Recovery conservatrice des jobs Capture expirés :
  - Asset `UPLOADING` → `FAILED`;
  - CaptureRun → `FAILED`;
  - JobAttempt → `FAILED`;
  - code stable `CAPTURE_RECONCILIATION_REQUIRED`;
  - audit `CaptureRun.reconciliationRequired`;
  - aucun nouveau CaptureRun / JobAttempt créé automatiquement.
- `queueRequired()` rejouée après réconciliation retrouve l'essai terminal existant au lieu
  de provoquer un duplicate.
- Gate `check:phase4` ajouté au package racine.

## Sécurité et comportement réseau

Les tests navigateur Phase 4 utilisent uniquement la fixture Vision locale déterministe.

Aucun test local de cette phase n'a contacté l'environnement canonique
`https://capture-demo.urvision.fr`.

Aucune mission Vision distante, aucun fournisseur AI, aucun réseau social et aucune
publication n'ont été déclenchés pendant la validation.

Le scan de secrets du dépôt passe. Une vérification ciblée des seeds Capture, tests browser
et worker Capture ne retourne aucun storage-state, mot de passe, secret ou token versionné.

Les traces restent des médias privés de diagnostic et ne sont jamais des médias publics.

## Retry et réconciliation

Le type de job `CAPTURE` utilise explicitement la politique `RECONCILE`.

Une expiration de lease ne prouve jamais qu'un éventuel effet distant n'a pas eu lieu.
Un worker stale n'est donc pas autorisé à finaliser le résultat ni à relancer naïvement la
capture.

Un essai interrompu est fermé avec :

`CAPTURE_RECONCILIATION_REQUIRED`

avant toute décision ultérieure.

Si un scénario lance réellement une mission Vision, son état applicatif/distant devra être
réconcilié avant qu'une nouvelle tentative puisse être autorisée. La Phase 4 ne crée jamais
automatiquement une mission de remplacement après un état ambigu.

## Schéma et migrations

Aucun changement de `prisma/schema.prisma`.

Aucune nouvelle migration.

`pnpm db:migrate:local` confirme :

`No pending migrations to apply.`

Le preview SQL initial reste inchangé après `pnpm db:preview` et
`git diff --exit-code -- infra/migration-preview/initial.generated.sql`.

## Dépendances et environnement validés

- Node `24.21.0`
- pnpm `10.34.5`
- Prisma / Prisma Client `7.10.0`
- TypeScript `5.9.3`
- Playwright `1.63.0`
- FFmpeg `8.1.2`
- ffprobe `8.1.2`

`pnpm install --frozen-lockfile` confirme un lockfile à jour.

La CI existante installe déjà ffmpeg/ffprobe et le Chromium correspondant à la version
Playwright pinée avant les tests navigateur ; aucun changement de workflow CI n'est requis
pour Phase 4.

## Validation finale locale

Toutes les validations suivantes sont vertes :

- `pnpm format:check`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm check:secrets`
- `pnpm prisma:validate`
- `pnpm test`
- `pnpm test:postgres`
- `pnpm test:storage`
- `pnpm build:web`
- `pnpm test:browser`
- `pnpm test:infra`
- `pnpm db:migrate:local`
- `pnpm db:preview`
- `git diff --check`

Total : **202 tests passent**.

Répartition :

- 81 tests unitaires / contrats / API — 14 fichiers ;
- 109 tests PostgreSQL réels — 7 fichiers ;
- 3 tests de stockage privé ;
- 9 tests Chromium.

Les 109 tests PostgreSQL comprennent notamment :

- 25 Recording ;
- 6 lifecycle Capture ;
- 5 Asset staging/fencing ;
- 5 orchestrateur Capture ;
- 3 recovery/reconciliation Capture ;
- 29 AI ;
- 36 persistence/domain PostgreSQL.

Les 9 tests navigateur comprennent :

- isolation BrowserContext ;
- auth state via provider secret-backed ;
- blocage des chemins interdits ;
- blocage des redirections hors origine ;
- blocage popup ;
- blocage download ;
- exécution déterministe `AGENT_QUERY_TO_RESULTS` ;
- deux parcours Recording Pack existants.

L'infrastructure locale valide PostgreSQL, Redis et stockage S3-compatible privé avec refus
d'accès anonyme.

## Tests spécifiques Phase 4

Les tests prouvent notamment :

- les cinq scénarios canoniques sont importés idempotemment ;
- un `operationId` ne peut pas être rejoué avec une autre identité ;
- un CaptureRun ne peut pas réussir si un output requis manque ;
- l'ID canonique du scénario reste distinct de l'ID PostgreSQL ;
- deux captures du même scénario avec deux `clientKey` différents restent distinctes ;
- le `scenarioInput` exact du bon `clientKey` arrive au worker ;
- CaptureRun et JobAttempt partagent le même `operationId` ;
- les outputs privés ne deviennent READY qu'après validation technique ;
- checksum read-back incorrect → fail closed ;
- échec d'un output → aucun Asset `UPLOADING` abandonné par le staging normal ;
- lease stale → aucune écriture de finalisation ;
- succès orchestrateur → Assets + CaptureRun + JobAttempt finalisés atomiquement ;
- échec Playwright → diagnostics privés READY puis run/job FAILED ;
- lease perdu pendant Playwright → état laissé à réconcilier ;
- recovery d'un job expiré → aucune nouvelle tentative automatique ;
- un job avec lease valide n'est jamais touché par recovery ;
- la readiness Production passe automatiquement après la dernière capture requise réussie.

## Fichiers Phase 4

Principales zones modifiées/créées :

- `apps/worker-capture/`
- `packages/application/capture-seeds/`
- `packages/application/src/capture-registry.ts`
- `packages/contracts/src/capture.ts`
- `packages/database/src/captures.ts`
- `packages/database/src/recordings.ts`
- `tests/browser/product-capture*.spec.ts`
- `tests/postgres/capture*.test.ts`
- `tests/contracts/phase4-fidelity.test.ts`
- `tests/unit/capture-registry.test.ts`
- `playwright.config.ts`
- `package.json`
- `pnpm-lock.yaml`

Aucune modification de schéma Prisma.

## Limites connues

- L'environnement dédié `VISION_CAPTURE_DEMO` n'est pas activé par les tests locaux.
- La Phase 4 fournit le moteur de capture, pas l'environnement distant ni ses credentials.
- Une capture nécessitant une vraie mission Vision conserve la règle stricte :
  reconciliation avant toute nouvelle mission après état ambigu.
- `CAPTURE_RECONCILIATION_REQUIRED` signifie qu'une décision/reconciliation ultérieure est
  nécessaire ; le système ne suppose pas que l'effet distant est absent.
- Les outputs Capture sont des médias source. Leur sélection éditoriale et leur montage
  appartiennent à la Phase 5.
- Aucun renderer vidéo, Remotion, montage, captions, sound design ou Creative QA n'est
  implémenté dans cette phase.

## Provider / coûts / side effects

Aucun appel payant AI, capture distant ou social.

Aucune publication.

Aucune donnée client réelle.

Les seuls effets externes de validation sont les outils et dépendances locales déjà prévus :
Docker local, PostgreSQL, Redis, stockage S3-compatible local, Chromium Playwright,
FFmpeg/ffprobe.

## Rollback

Aucune migration inverse nécessaire.

Le rollback de Phase 4 pourra être effectué par :

`git revert <commit Phase 4>`

Conserver les éventuels médias privés Capture déjà produits ; ne pas supprimer les volumes
ou données métier lors d'un rollback applicatif.

## Git

Baseline Phase 4 :
`462499dbb38b8e1f397e3e6a54d8aa7c793774e5`

Branche :
`phase/4-product-capture`

Le commit final attendu est :

`feat(capture): implement Phase 4 product capture`

Aucun tag de spécification supplémentaire n'est créé pour cette phase.

Phase 5 has NOT been started.
