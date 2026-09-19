# Rapport Phase 0 — Vision Content Engine

Date : 19 septembre 2026. Périmètre : Master Prompt §21–28, **Phase 0 uniquement**.
Résultat : critères d'acceptation Phase 0 satisfaits localement. Aucun workflow métier implémenté.

## 1. HEAD et tag de départ

- Branche : `main`, propre et alignée avec `origin/main` avant modification.
- HEAD : `954f2fa1509f960282b84fb32630b25c4c61d5e3` (`954f2fa`).
- Aucun tag exactement sur HEAD.
- Tag annoté `spec-v1.0` : commit `f2450f34d7f55a4ce4cf950b5c7557d03c7e3549`.
- Les deux commits suivants ne modifiaient que `.gitignore`.

Inspection préalable : arbre complet, tous les documents canoniques 00–19, DECISIONS,
SPEC_STATUS, SPEC_FREEZE_CHECKLIST, archives historiques 03A/03B, 23 ADRs, artefacts et
contrats. Les 146 entrées du manifeste figé sont vérifiées par taille et SHA-256.
Le dépôt initial ne contenait ni application, ni configuration d'exécution, ni tests,
ni migrations ; seulement la documentation, README, `.gitignore` et `bootstrap_repo.sh`.
Aucun travail applicatif existant n'a été remplacé.

Écarts documentaires traités selon la priorité canonique, sans modifier la spec :

- `docs/04_WORKFLOWS.md` conserve des états BLOCKED_ON_RECORDING/CAPTURE historiques ;
  le schéma et ADR-0011 imposent WAITING_FOR_INPUTS, conservé.
- Le contrat de référence analytics rend `rawSnapshotId` optionnel ; la réconciliation
  finale et Prisma l'exigent. Le schéma runtime conserve la relation obligatoire.
  Ne pas promouvoir ce contrat de référence tel quel lors d'une future implémentation.
- Les seeds templates incluent une enveloppe d'export ; les scénarios de capture référencent
  des profils nommés. Les tests d'inspection résolvent ces enveloppes et références sans
  modifier les artefacts ni exécuter de capture.
- L'écart de type temporel découvert pendant la revue SQL est détaillé aux §7 et §10.

## 2. Statut Git final

La livraison forme un seul commit local `chore: bootstrap Phase 0 repository foundation`,
sur `main`, comprenant le lockfile et ce rapport. Aucun push ni changement d'historique.
Statut attendu et contrôlé après ce commit : `## main...origin/main [ahead 1]`, arbre propre.
L'identifiant exact du commit est donné dans la réponse de livraison.

Les fichiers locaux `.env`, `node_modules`, le client Prisma généré et le build web sont ignorés.
Les documents canoniques et les 146 entrées du manifeste sont inchangés.

## 3. Fichiers créés / modifiés

75 fichiers créés ; 2 fichiers existants modifiés (`.gitignore`, `README.md`).
La liste exhaustive des créations figure en annexe.

- Topologie : huit apps et dix packages privés, noms canoniques ; 19 projets pnpm avec la racine.
- Configuration : TypeScript strict, ESLint, Prettier, Vitest, métadonnées Node/pnpm et CI.
- `packages/shared/src/config.ts` : parser Zod, cinq kill switches à true par défaut,
  fournisseurs réels désactivés, diagnostics sans valeurs de configuration.
- `apps/api/src` et `packages/observability/src` : health/readiness minimaux et bornés,
  connexions locales seulement, sans routes métier.
- `apps/web` : page statique minimale React/Vite ; aucune fonctionnalité de dashboard.
- `prisma/schema.prisma` : copie canonique formatée, client généré localement et ignoré.
- `infra/compose.yaml` : dépendances locales ; `infra/migration-preview` : aperçu SQL et revue.
- `tests` : fixtures synthétiques, fournisseur scripté, horloge manuelle et 17 tests.
- `scripts` : initialisation locale privée, contrôle des dépendances, détection de motifs de secrets.
- `README.md` : instructions reproductibles ; `.gitignore` : exclusion du client généré.

## 4. Versions exactes figées

Node **24.21.0**, pnpm **10.34.5**. Toutes les dépendances directes externes sont exactes ;
les dépendances internes utilisent `workspace:*`. Les transitives et leurs intégrités
sont verrouillées dans `pnpm-lock.yaml`, validé par `pnpm install --frozen-lockfile`.

| Dépendance directe         | Version    |
| -------------------------- | ---------- |
| `@aws-sdk/client-s3`       | `3.1136.0` |
| `@eslint/js`               | `10.0.1`   |
| `@nestjs/common`           | `11.2.5`   |
| `@nestjs/core`             | `11.2.5`   |
| `@nestjs/platform-express` | `11.2.5`   |
| `@prisma/client`           | `7.10.0`   |
| `@types/node`              | `24.13.6`  |
| `@types/pg`                | `8.23.1`   |
| `@types/react`             | `19.3.0`   |
| `@types/react-dom`         | `19.3.0`   |
| `dotenv`                   | `17.4.2`   |
| `eslint`                   | `10.11.0`  |
| `ioredis`                  | `5.11.1`   |
| `pg`                       | `8.23.0`   |
| `prettier`                 | `3.9.8`    |
| `prisma`                   | `7.10.0`   |
| `react`                    | `19.3.0`   |
| `react-dom`                | `19.3.0`   |
| `reflect-metadata`         | `0.2.2`    |
| `rxjs`                     | `7.8.2`    |
| `tsx`                      | `4.23.13`  |
| `typescript`               | `5.9.3`    |
| `typescript-eslint`        | `8.70.0`   |
| `vite`                     | `7.3.6`    |
| `vitest`                   | `4.1.11`   |
| `zod`                      | `4.6.5`    |

Actions CI figées par commit :

- `actions/checkout` v5 : `fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09`.
- `actions/setup-node` v5.0.0 : `a0853c24544627f65ddf259abe73b1d18a591444`.

Les versions et compatibilités ont été vérifiées avec les métadonnées des registres officiels,
les exigences [Prisma](https://docs.prisma.io/docs/orm/reference/system-requirements),
[Node.js](https://nodejs.org/en/about/previous-releases), [pnpm](https://pnpm.io/installation),
[NestJS](https://docs.nestjs.com/first-steps) et [Vite](https://vite.dev/guide/).
La branche Prisma 7 stable a été choisie ; aucune version `latest` n'est stockée.

BullMQ, Playwright, Remotion et les SDK de réseaux sociaux ne sont pas installés à ce stade :
aucune capacité correspondante n'est autorisée en Phase 0. Ils devront être figés lors de
leur phase autorisée. La topologie et les décisions produit restent intactes.

## 5. Services Docker

Projet Compose : `vision-content-engine-local`. Les trois services sont démarrés et healthy,
avec volumes persistants propres au projet ; aucun autre projet Docker n'a été modifié.

| Service    | Image figée                | Port hôte         |
| ---------- | -------------------------- | ----------------- |
| PostgreSQL | `postgres:18.6-alpine3.23` | `127.0.0.1:55432` |
| Redis      | `redis:8.6.6-alpine3.23`   | `127.0.0.1:56379` |
| S3 local   | `chrislusf/seaweedfs:4.47` | `127.0.0.1:58333` |

Digests :

- PostgreSQL : `sha256:8c80c49c67052d82f9aaf4ee1f1881c8926b445a1cc916892934845eb8c24204`.
- Redis : `sha256:af0d872c3773bb5e8fd3cdf8b721e1c6883f7bb27d8273916d86afba702ba5a9`.
- SeaweedFS : `sha256:ce9e796f1fe6f06968f4c04bdaf8f678dad9c8acdfef3d244133d71bfa6bf882`.

MinIO est un exemple facultatif de la spec. Son [dépôt officiel](https://github.com/minio/minio)
est désormais archivé. [SeaweedFS](https://github.com/seaweedfs/seaweedfs) a donc été retenu
pour satisfaire la même exigence S3 locale, sans modifier la décision produit.
Ses interfaces administratives ne sont pas exposées sur l'hôte ; l'accès S3 exige les
identifiants aléatoires locaux. Le refus de lecture anonyme a été vérifié (HTTP 403).

## 6. Résultat Prisma

Avec le CLI projet **7.10.0**, sous Node **24.21.0** :

- `pnpm prisma:format` : succès.
- `pnpm prisma:validate` : succès, schéma valide.
- `pnpm prisma:generate` : succès, client 7.10.0 généré.

Aucune erreur de représentation du modèle n'a été signalée par Prisma.
Le formatteur a uniquement changé les espaces et placé `@unique` avant `@default(uuid(7))`
sur quatre champs ; le test de fidélité autorise exactement ces changements de présentation.
Aucune entité, enum, relation ou valeur par défaut métier n'a été modifiée.
Le client n'est pas instancié pour la persistance applicative en Phase 0.

## 7. Résumé SQL

`pnpm db:preview` génère `infra/migration-preview/initial.generated.sql` depuis un schéma vide,
sans connexion à la base. La génération répétée produit le même SHA-256 :
`60eb2d9c6e8f00424f8f2ab6934cbbab6f961a06da192b456b9e8e754a324500`.

Revue de l'ensemble du SQL : **50 tables, 49 enums, 50 clés primaires, 104 index secondaires
(35 uniques), 72 clés étrangères**. Aucun DDL destructif ni suppression en cascade.
Relations exactes de contenu, versions de template/profil, source analytics, provenance IA,
tracking et index d'idempotence préservés.

**SQL non appliqué**. Aucun répertoire de migrations exécutables. La base PostgreSQL locale
contient zéro table dans le schéma public, confirmé par requête en lecture seule.

La [revue détaillée](../infra/migration-preview/README.md) documente les trois contraintes
manuelles réservées à la Phase 1 (sujet Approval, unicité ACTIVE de KnowledgeSnapshot,
complétude REVENUE), les validations inter-tables et le point sur les timestamps.
Les `DateTime` canoniques produisent `TIMESTAMP(3)` sans fuseau, alors que la spec de distribution
§ Scheduling demande des timestamps avec fuseau. Aucun changement silencieux n'a été effectué.

## 8. Commandes et résultats

| Commande / contrôle                                                | Résultat                                                                   |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| `git status`, `git rev-parse --short HEAD`, recherche du tag exact | Départ propre ; HEAD 954f2fa ; aucun tag exact                             |
| Inspection arbre/spec/ADRs/artefacts et manifeste                  | 146 fichiers du manifeste préservés                                        |
| Installation avec Node 24.21.0 / pnpm 10.34.5                      | 19 projets résolus, dépendances figées                                     |
| `pnpm install --frozen-lockfile`                                   | Succès, lockfile à jour                                                    |
| `pnpm local:init`                                                  | `.env` local généré, mode 0600, exclu de Git                               |
| `pnpm prisma:format`, `prisma:validate`, `prisma:generate`         | Tous réussis                                                               |
| `pnpm db:preview`                                                  | Succès, aperçu reproductible, non appliqué                                 |
| `pnpm infra:up`, `pnpm infra:status`                               | Trois services healthy                                                     |
| `pnpm test:infra`                                                  | SELECT 1, PING, S3 signé écriture/lecture/suppression, lecture anonyme 403 |
| `pnpm check`                                                       | Format, lint, types, scan de motifs de secrets, Prisma et tests réussis    |
| `pnpm test`                                                        | 6 fichiers, 17 tests réussis, aucun retry                                  |
| `pnpm build:web`                                                   | Succès Vite, 27 modules, build local ignoré                                |
| `pnpm dev:api` puis GET `/healthz` et `/readyz`                    | Réponses 200, trois dépendances up ; processus ensuite arrêté              |
| Requête de comptage des tables publiques                           | 0, aucune migration appliquée                                              |
| `git diff --check` et revue des fichiers livrés                    | Aucune erreur d'espacement ; diff limité à Phase 0                         |

Les tests couvrent le parser et les valeurs par défaut sûres, les refus de configuration,
les erreurs sans secrets, les délais de readiness, les endpoints health/readiness, les
utilitaires simulés, la structure canonique, les 146 hashes, la fidélité Prisma et les seeds
référentiels (8 patterns, 7 profils, 5 templates, 5 scénarios lus sans exécution).

Deux échecs initiaux ont conduit à des corrections ciblées : une URL invalide pouvait lever
avant le diagnostic Zod assaini ; un test comparait trop strictement l'ordre d'attributs
réorganisé par Prisma. Après correction, la suite entière passe. Aucun test flaky masqué par retry.

La CI GitHub est définie avec les mêmes commandes déterministes et un contrôle de
reproduction SQL ; **elle n'a pas été exécutée sur GitHub** puisqu'aucun push n'a été effectué.
Les tests n'utilisent pas de fournisseur externe ; l'installation initiale requiert le registre npm.

## 9. Note sur Node local

Le shell de la machine reste sous **Node 22.23.2** et **pnpm 11.19.0**, incompatibles avec
les métadonnées du projet. Ces installations globales n'ont pas été modifiées.
Les vérifications ont utilisé Node officiel **24.21.0** (archive SHA-256 vérifiée) et pnpm
**10.34.5** isolés dans `/private/tmp/vce-phase0-toolchain`.

Une tentative de commande composée a correctement échoué parce qu'un sous-processus
reprenait le pnpm préinstallé (avec son Node embarqué 24.19.0). Le PATH a été corrigé pour
utiliser la chaîne isolée dans tous les sous-processus, puis les commandes ont réussi.
Pour le développement courant, suivre les instructions nvm/pnpm du README ; le chemin
temporaire de validation ne constitue pas une dépendance du dépôt.

## 10. Limites connues

- Aucun métier, workflow, outbox exécutée, queue BullMQ, gate humain, capture, montage,
  rendu, publication, import analytique ou fonctionnalité de dashboard n'a été implémenté.
- Les contraintes manuelles SQL et tests de persistance métier ne sont pas couverts par ce socle.
  L'aperçu n'est donc pas une migration prête à appliquer.
- Avant la future persistance de planification, arbitrer explicitement l'écart timezone entre
  `docs/11_DISTRIBUTION.md:263` et les DateTime du schéma canonique. Recommandation :
  décider une représentation cohérente dans la spec avant de créer la migration Phase 1 ;
  options minimales documentées dans la revue SQL. Aucun changement contesté effectué.
- Pas d'authentification de production ni de déploiement ; API et services limités à la boucle locale.
  Les exports des packages restent en TypeScript source pour `tsx`, sans builds de services de production.
- Le scan de secrets reconnaît des motifs et noms de fichiers courants ; il ne constitue pas
  une preuve exhaustive d'absence de tout secret possible. Les identifiants locaux générés
  sont ignorés, ne sont pas inclus dans les logs de test et ne font pas partie du commit.
- Compose et le canary ont été vérifiés sur la machine macOS ARM64 actuelle ; la CI Linux
  distante reste à exécuter. Les services locaux sont laissés démarrés pour utilisation.
- La génération Prisma réussie et le SQL inspecté ne remplacent pas les futurs tests
  d'intégration PostgreSQL des migrations et invariants métier.

## 11. Retour arrière

Le commit local de livraison peut être annulé par `git revert <commit-phase-0>` après
vérification d'éventuels nouveaux travaux. Aucun historique n'a été réécrit et aucun push effectué.
`pnpm infra:down` arrête uniquement ce projet Compose et conserve ses volumes.
Aucun rollback de migration n'est nécessaire : aucune n'a été appliquée.
Le `.env`, les volumes et dépendances locales ne sont pas supprimés par un revert Git ;
ils peuvent être conservés pour éviter toute suppression involontaire.

## 12. Arrêt explicite

**Phase 1 has NOT been started.**

La livraison s'arrête ici. Toute Phase 1 nécessite une nouvelle autorisation explicite.

## Annexe — Fichiers créés

- `.env.example`
- `.github/workflows/phase0.yml`
- `.node-version`
- `.npmrc`
- `.nvmrc`
- `.prettierignore`
- `.prettierrc.json`
- `apps/api/package.json`
- `apps/api/src/app.ts`
- `apps/api/src/local-canary.ts`
- `apps/api/src/local-dependencies.ts`
- `apps/api/src/main.ts`
- `apps/control/package.json`
- `apps/control/src/index.ts`
- `apps/web/index.html`
- `apps/web/package.json`
- `apps/web/src/main.tsx`
- `apps/worker-ai/package.json`
- `apps/worker-ai/src/index.ts`
- `apps/worker-analytics/package.json`
- `apps/worker-analytics/src/index.ts`
- `apps/worker-capture/package.json`
- `apps/worker-capture/src/index.ts`
- `apps/worker-publish/package.json`
- `apps/worker-publish/src/index.ts`
- `apps/worker-render/package.json`
- `apps/worker-render/src/index.ts`
- `docs/PHASE_0_REPORT.md`
- `eslint.config.mjs`
- `infra/compose.yaml`
- `infra/migration-preview/README.md`
- `infra/migration-preview/initial.generated.sql`
- `package.json`
- `packages/ai/package.json`
- `packages/ai/src/index.ts`
- `packages/analytics/package.json`
- `packages/analytics/src/index.ts`
- `packages/application/package.json`
- `packages/application/src/index.ts`
- `packages/contracts/package.json`
- `packages/contracts/src/index.ts`
- `packages/database/package.json`
- `packages/database/src/index.ts`
- `packages/domain/package.json`
- `packages/domain/src/index.ts`
- `packages/media/package.json`
- `packages/media/src/index.ts`
- `packages/observability/package.json`
- `packages/observability/src/index.ts`
- `packages/observability/src/readiness.ts`
- `packages/publishing/package.json`
- `packages/publishing/src/index.ts`
- `packages/shared/package.json`
- `packages/shared/src/config.ts`
- `packages/shared/src/index.ts`
- `pnpm-lock.yaml`
- `pnpm-workspace.yaml`
- `prisma.config.ts`
- `prisma/schema.prisma`
- `scripts/check-local-infra.ts`
- `scripts/check-secrets.mjs`
- `scripts/init-local.mjs`
- `tests/README.md`
- `tests/contracts/frozen-spec.test.ts`
- `tests/contracts/spec-seeds.test.ts`
- `tests/integration/api.test.ts`
- `tests/support/config.ts`
- `tests/support/manual-clock.ts`
- `tests/support/scripted-provider.ts`
- `tests/unit/config.test.ts`
- `tests/unit/readiness.test.ts`
- `tests/unit/test-harness.test.ts`
- `tsconfig.base.json`
- `tsconfig.json`
- `vitest.config.ts`
