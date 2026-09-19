# Vision Content Engine

Infrastructure interne de création et de distribution organique pour **Vision**.

## Statut

**Phase 0 — bootstrap uniquement**, basée sur la spécification figée `spec-v1.0`.
Les fonctionnalités métier et la Phase 1 nécessitent une autorisation explicite.
Le rapport de livraison est dans [docs/PHASE_0_REPORT.md](docs/PHASE_0_REPORT.md).

## Source de vérité

Ordre de priorité : `docs/19_SPEC_V1_FINAL_VALIDATION.md`, `docs/18_FINAL_RECONCILIATION.md`,
`docs/spec-artifacts/schema.prisma`, spécifications spécialisées acceptées, décisions/ADRs,
puis archives 03A/03B. Le [Master Prompt](docs/17_CODEX_MASTER_PROMPT.md) fixe le périmètre.
Les documents et artefacts figés restent inchangés.

## Prérequis locaux

- Node.js **24.21.0** (`.nvmrc` et `.node-version`) ; le projet refuse une autre version majeure.
- pnpm **10.34.5**, version exacte définie dans `packageManager`.
- Docker avec Compose.

Avec nvm, lancer `nvm install` puis `nvm use`. Installer pnpm avec
`npm install --global pnpm@10.34.5` dans cet environnement Node.
Vérifier `node --version` et `pnpm --version` avant de continuer.

## Démarrage Phase 0

```sh
pnpm install --frozen-lockfile
pnpm local:init
pnpm prisma:format
pnpm prisma:validate
pnpm prisma:generate
pnpm infra:up
pnpm infra:status
pnpm test:infra
pnpm check
pnpm build:web
```

`local:init` crée des identifiants locaux aléatoires dans `.env` (ignoré par Git, mode 0600).
Il préserve un fichier existant. Ne jamais publier ce fichier ni la sortie interpolée de
`docker compose config`. Aucun compte social ou fournisseur d'IA n'est configuré.

Les services sont exposés uniquement sur la boucle locale : PostgreSQL `55432`, Redis `56379`,
S3 SeaweedFS `58333`. Les images sont figées par version et digest. Le bucket est privé ;
`test:infra` vérifie les accès authentifiés et le refus anonyme avec un objet synthétique
supprimé ensuite. Les volumes persistent après `pnpm infra:down` ; conserver le `.env`
correspondant, car de nouveaux mots de passe ne réinitialisent pas les volumes existants.

Dans deux terminaux :

```sh
pnpm dev:api
pnpm dev:web
```

L'API écoute sur `http://127.0.0.1:3100` : `/healthz` indique que le processus répond,
`/readyz` vérifie les trois dépendances (200 ou 503). L'interface sur
`http://127.0.0.1:5174` est une page statique de bootstrap. L'API refuse les environnements
autres que LOCAL et les dépendances hors boucle locale ; elle n'implémente aucune route métier.
Les cinq kill switches sont activés par défaut. Les workers sont des emplacements réservés.

## Schéma et aperçu SQL

`prisma/schema.prisma` est la copie formatée du schéma canonique. Le client généré
dans `packages/database/src/generated/prisma` est ignoré par Git et doit être régénéré après installation.

```sh
pnpm db:preview
```

Cette commande génère uniquement `infra/migration-preview/initial.generated.sql` depuis
un schéma vide, sans connexion ni modification de la base. Lire la
[revue SQL](infra/migration-preview/README.md). **Ne pas appliquer cet aperçu** : les migrations
exécutables et les contraintes SQL manuelles obligatoires appartiennent à la Phase 1.

## Vérification

`pnpm check` exécute formatage, lint, TypeScript strict, recherche de motifs de secrets,
validation Prisma et 17 tests déterministes. Les fixtures et fournisseurs simulés n'appellent
aucune API externe. Les tests API ouvrent uniquement une socket locale éphémère.
`pnpm test:infra` est un contrôle local explicite, séparé de cette suite.

La CI reproduit ces contrôles, la génération Prisma, le build de la page statique et
la reproduction de l'aperçu SQL. Aucun test contre des fournisseurs réels n'est activé.

## Structure

Les huit applications et dix packages suivent exactement la topologie du Master Prompt.
Les exports TypeScript sont destinés au développement via `tsx` en Phase 0 ; aucun build
de production des services, workflow, capture, rendu, publication ou import analytique
n'est encore implémenté.
