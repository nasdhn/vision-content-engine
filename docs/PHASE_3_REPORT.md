# Phase 3 — Assets & Recording Pack

Baseline : `main` / `origin/main` / HEAD de départ
`0ec1be60b96b7aea3c7a97b6c623aa2b427d195c`, arbre propre.
Branche : `codex/phase-3-assets-recording-pack`.
Tranche : un commit local `feat(media): implement Phase 3 assets and recording pack`.
L'identifiant exact est celui du commit contenant ce rapport (`git log -1`).

## Livré

- Stockage S3 privé, clés immuables, originaux conservés, upload borné, SHA-256 calculé
  puis vérifié par relecture du stockage avant finalisation atomique Asset/Recording.
- Probe ffprobe avec arguments fixes et formats/protocoles autorisés : codec, durée,
  dimensions orientées, fps, audio et couleur. Refus explicite HDR/HLG/Dolby Vision et
  signaux BT.2020 ; aucune conversion silencieuse. Feedback durée/orientation/fond vert.
- Recording Pack relié aux versions exactes issues du Creative Director ; préparation
  atomique via les APIs Phase 1/2 et rattrapage idempotent des plans existants au démarrage.
- UI avec texte exact, instructions, cadrage, position, geste, fond, repère visuel,
  sélection de fichiers/drag-drop, prises multiples, prévisualisation et sélection/rejet.
- Clarification approuvée D-186 : dernière prise valide désélectionnée/rejetée → UPLOADED ;
  resélection → ACCEPTED ; autre prise valide sélectionnée → ACCEPTED inchangé.
  Verrouillage PostgreSQL du plan, mutation/état/readiness/audit/outbox atomiques.
  Aucune réécriture des versions, renders ou références historiques.
- Session locale, cookie Secure/HttpOnly/SameSite=Strict, contrôle Origin + CSRF, limitation
  des tentatives de connexion, erreurs sans données sensibles et médias authentifiés.
- Uploads interrompus identifiables, finalisation tardive refusée, nettoyage des fichiers
  temporaires abandonnés, quarantaine sur média indisponible/corrompu et readiness recalculée.

## Schéma et documentation canonique

Aucun changement Prisma, aucune nouvelle migration, aucun manifeste ou tag modifié.
`db:migrate:local` : aucune migration en attente.
La clarification demandée est ajoutée à `04_WORKFLOWS.md`, `10_DASHBOARD_UX.md` et D-186
sans réécrire leurs octets historiques. Les tests conservent les manifestes gelés.
Aucune autre contradiction produit/spec découverte.

Preview SQL initial inchangé, SHA-256 :
`c4aa995cc0e1849ee03c13213994282f6c916e57a58075f778e3540eabdfaf57`.

## Dépendances et environnement

- Ajout dev : `@playwright/test` **1.63.0** ; transitifs `playwright` et `playwright-core`
  **1.63.0** ; Chromium **153.0.8010.12**, build Playwright **1243**.
- Réemploi piné : `@aws-sdk/client-s3` **3.1136.0**, Zod **4.6.5**, plus liens workspace.
  Aucun upgrade des dépendances runtime existantes.
- Gates exécutés avec Node **24.21.0**, pnpm **10.34.5**, Prisma **7.10.0**.
  Node global de la machine reste **22.23.2** ; les commandes utilisent explicitement
  le toolchain projet. FFmpeg/ffprobe local **8.1.2**.
- Compatibilité Playwright vérifiée avant pinning :
  [registre officiel](https://registry.npmjs.org/@playwright/test/1.63.0),
  [prérequis officiels](https://playwright.dev/docs/intro#system-requirements).

## Validation

**171 tests passent, zéro skip/retry :** 77 unitaires/contrats/API, 89 PostgreSQL réels,
3 stockage S3 réel local, 2 parcours Chromium. Les 124 tests précédents sont conservés ;
l'assertion Phase 2 « aucune RecordingRequest » évolue vers la matérialisation Phase 3,
avec contrôle du CreativePlanVersion exact. Les gates hébergés sont enrichis, mais aucune
nouvelle exécution GitHub CI n'est revendiquée : aucun push n'a été effectué.

Commandes vertes :

- `pnpm install --frozen-lockfile`.
- `pnpm check:phase3` : format, lint, TypeScript strict, scan de secrets, Prisma validate,
  tests, PostgreSQL, S3, build Vite et tests navigateur.
- `pnpm prisma:format`, `pnpm prisma:validate`, `pnpm prisma:generate`.
- `pnpm db:preview` et vérification du diff nul du schéma/preview SQL.
- `pnpm test:infra` : PostgreSQL, Redis, écriture/relecture S3 signée et refus anonyme.
- `pnpm db:migrate:local` : migration existante déjà appliquée, aucune nouvelle application.
- `git diff --check`.

Les tests couvrent notamment : deux prises sélectionnées puis rejet d'une seule ; rejet et
désélection de la dernière ; resélection ; readiness invalidée ; lignée historique intacte ;
sélection/rejet et sélection/quarantaine concurrents via connexions distinctes ; rollback
de toutes les mutations ; ancienne version ne rendant pas prête la nouvelle ; fichiers
illisibles, checksum erroné, stockage en échec, upload interrompu et refus d'écrasement S3.
Les captures desktop/mobile ont été inspectées visuellement dans `test-results/` (ignoré).

## Effets et limites

Aucun fournisseur AI/social/capture externe, aucune publication, aucun push ni changement
de tag. Téléchargements d'outillage npm/Chromium uniquement. Les tests créent et suppriment
leurs bases/buckets locaux isolés. Vérification finale : zéro base de test restante ; zéro
Campaign/Asset/RecordingRequest/Recording dans la base applicative locale. `local:init`
ajoute seulement une clé d'accès locale manquante à `.env` ignoré, sans l'afficher.

Runtime local mono-utilisateur uniquement. Aperçus audio/vidéo selon les codecs pris en charge
par le navigateur, sans transcodage ; sources HDR explicitement refusées. Prévisualisation
entièrement vérifiée en mémoire, limite 512 Mio, une lecture à la fois ; uploads limités à
deux par processus. Les originaux déjà écrits lors d'un échec restent privés et rattachés à
l'Asset FAILED. Les besoins de capture restent non satisfaits : aucun worker de Phase 4.
Les futurs consommateurs doivent vérifier la disponibilité de la version exacte avant
production. Aucun moteur de montage/render/distribution n'est démarré.

Mode d'emploi : `apps/api/RECORDING_PACK.md` ; contrats et limites média :
`packages/media/README.md`.

## Rollback et Git

Après commit, arbre propre sur la branche locale, `main` et `origin/main` inchangés.
Rollback : `git revert <commit Phase 3>` ; aucune migration inverse nécessaire.
Arrêter les processus locaux avant de revenir au code Phase 2. Conserver les éventuels
originaux et données métier ; ne pas supprimer les volumes Docker. La clé locale ajoutée
reste ignorée et n'a aucun effet dans le code Phase 2.

Phase 4 has NOT been started.

## Fichiers modifiés/créés

27 fichiers modifiés, 21 créés (48 au total).

### Modifiés

- `.env.example`
- `.github/workflows/phase0.yml`
- `apps/api/package.json`
- `apps/api/src/app.ts`
- `apps/api/src/local-dependencies.ts`
- `apps/api/src/main.ts`
- `apps/web/package.json`
- `apps/web/src/main.tsx`
- `docs/04_WORKFLOWS.md`
- `docs/10_DASHBOARD_UX.md`
- `docs/DECISIONS.md`
- `package.json`
- `packages/application/package.json`
- `packages/application/src/content.ts`
- `packages/application/src/index.ts`
- `packages/database/src/persistence.ts`
- `packages/database/src/transaction.ts`
- `packages/domain/src/index.ts`
- `packages/media/package.json`
- `packages/media/src/index.ts`
- `packages/shared/src/config.ts`
- `pnpm-lock.yaml`
- `scripts/init-local.mjs`
- `tests/contracts/frozen-spec.test.ts`
- `tests/postgres/ai.test.ts`
- `tsconfig.json`
- `vitest.config.ts`

### Créés

- `apps/api/RECORDING_PACK.md`
- `apps/api/src/recordings.ts`
- `apps/web/src/style.css`
- `apps/web/vite.config.ts`
- `docs/PHASE_3_REPORT.md`
- `packages/application/src/recording-pack.ts`
- `packages/database/src/recordings.ts`
- `packages/media/README.md`
- `packages/media/src/probe.ts`
- `packages/media/src/storage.ts`
- `packages/media/src/temp.ts`
- `packages/media/test/s3-fixture.ts`
- `playwright.config.ts`
- `tests/browser/recording-pack.spec.ts`
- `tests/browser/server.ts`
- `tests/fixtures/recordings/support.ts`
- `tests/integration/recording-api.test.ts`
- `tests/postgres/recordings.test.ts`
- `tests/storage/private-storage.test.ts`
- `tests/unit/media.test.ts`
- `vitest.storage.config.ts`
