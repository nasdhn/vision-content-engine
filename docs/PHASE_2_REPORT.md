# Phase 2 — Rapport de livraison

## Baseline et périmètre

- Baseline : `main` / `origin/main` / HEAD initial `c41583a13eea8da149e4183981b2664e3db511b6` ; arbre initial propre.
- Branche : `codex/phase-2-knowledge-ai`.
- Un seul commit local : `feat(ai): implement Phase 2 knowledge and generation`.
- Le SHA du commit contenant ce rapport et l’état Git final sont fournis dans la réponse de livraison.
- Spécification : `spec-v1.0.2`, toujours sur `be3fab2480c1889efe78c09460af9808088cc9dd`.
- Aucun changement de spécification canonique, schéma, migration, tag ou push.

## Fonctionnalités livrées

- SourceReference curatées et snapshots Knowledge immuables, vérification des sources/hashes,
  allocation concurrente des versions et activation atomique.
- Huit seeds Pattern fidèles aux artefacts, import idempotent, correspondance explicite des UUID,
  sélection déterministe expliquée, contraintes de production, exploration et fatigue contextuelle.
- Contrats Zod fidèles aux artefacts et Prompt Registry versionné/hashé dans le repository.
- Gateway avec pause, limites de tokens/coût/tentatives/timeout, réparations structurelles,
  fallback sous contrat identique, provenance par tentative et comptabilisation des coûts observés.
- Réservations budgétaires durables utilisant les champs JSON existants et des verrous PostgreSQL ;
  les tentatives partagent le plafond de l’appel logique.
- Creator : contexte DB, candidats validés, diversité/déduplication, conservation des claims,
  versions immuables et soumission à la revue humaine sans approbation automatique.
- Creative Director : approbation du ConceptVersion exact, y compris historique ; ScriptVersion
  et CreativePlanVersion avec template/profil exacts ; exigences de recording/capture persistées.
- Consommation atomique et non rejouable des résultats validés ; audit/outbox et fencing via
  les APIs Phase 1 existantes pour les appels exécutés comme jobs.
- Mémoire des publications reconstruite en lecture depuis le lineage canonique ; aucune collecte analytique.

## Dépendances et environnement

Aucune nouvelle version de dépendance externe. Réutilisation de `zod@4.6.5` dans les packages
concernés et ajout de liens `workspace:*` ; lockfile mis à jour. Prisma reste `7.10.0`.
Les commandes ont utilisé Node `24.21.0` et pnpm `10.34.5` du projet. Le Node global reste
`22.23.2` ; il n’a pas été modifié et n’a pas servi aux gates.

## Tests et quality gates

**124 tests réussis** : 59 tests unitaires/contrats/intégration et 65 tests PostgreSQL réels.
Les 64 tests existants sont conservés ; 60 nouveaux tests couvrent la Phase 2.

Commandes réussies :

- `pnpm install --frozen-lockfile` ; `pnpm local:init` a conservé `.env`.
- `pnpm prisma:format`, `pnpm prisma:validate`, `pnpm prisma:generate`.
- `pnpm check:phase2` : format, lint, TypeScript strict, scan secrets, Prisma validate,
  tests déterministes, tests PostgreSQL et `pnpm build:web`.
- Démarrage/healthcheck PostgreSQL via le Docker Compose existant.
- `pnpm db:migrate:local` : aucune migration en attente ; `prisma migrate status` à jour.
- `pnpm db:preview` et diff des schémas/preview : aucun changement.
- `git diff --check`.

Les étapes de la CI hébergée existante ont été reproduites localement. Aucun nouveau run de CI
hébergée n’est revendiqué, puisqu’aucun push n’a été effectué. Les premiers contrôles ont relevé
un blocage sandbox du socket HTTP de test et deux imports à typer ; ils ont été corrigés/résolus
avant la passe finale. Aucun test flaky ni relance aveugle.

## Effets et persistance

Aucun appel à un fournisseur IA/social réel, aucun coût externe et aucune publication.
Installation des dépendances épinglées depuis le registre npm et usage du PostgreSQL local uniquement.
Les tests créent et suppriment leurs bases jetables. Vérification finale : **0 ligne métier**
dans la DB applicative, **0 base de test restante**.

Une seule migration historique reste appliquée : `20260919000000_initial_canonical`, checksum
`3cbcdacecbd7c96b3030d2a92d9506adc427afa2636ba3f01b9504eb40892a1c`.
Aucune migration nouvelle ni import de seeds dans la base applicative.

## Limites conservées

Les providers sont exclusivement des fakes injectés ; les SDK réels, consommateurs de queues,
UI, ingest média, capture et rendu ne sont pas activés. Les exigences média restent dans le
CreativePlan. La connaissance de production doit être curatée par un USER de confiance.
Les guards de similarité et d’interdiction sont lexicaux et conservateurs ; les deux gates humains
restent obligatoires. Les coûts inconnus utilisent une borne prudente pour le budget, sans être
présentés comme des coûts observés. Une invocation interrompue conserve sa réservation en attente
d’une réconciliation explicite. Les limites et usages sont documentés dans
`packages/application/README.md`.

Aucune contradiction supplémentaire constatée.

## Rollback

Revert du seul commit Phase 2 ; aucun rollback de migration. Préserver les éventuelles données
historiques créées ultérieurement par des appels intentionnels aux services.

## Inventaire exact des fichiers

12 fichiers modifiés et 35 fichiers créés.

### Modifiés

- `package.json`
- `packages/ai/package.json`
- `packages/ai/src/index.ts`
- `packages/application/package.json`
- `packages/application/src/index.ts`
- `packages/contracts/package.json`
- `packages/contracts/src/index.ts`
- `packages/database/README.md`
- `packages/database/package.json`
- `packages/database/src/index.ts`
- `packages/database/src/persistence.ts`
- `pnpm-lock.yaml`

### Créés

- `docs/PHASE_2_REPORT.md`
- `packages/ai/prompts/creative-director.v1.json`
- `packages/ai/prompts/creator.v1.json`
- `packages/ai/src/gateway.ts`
- `packages/ai/src/prompts.ts`
- `packages/ai/src/validation.ts`
- `packages/application/README.md`
- `packages/application/pattern-seeds/CONTRARIAN_EXPLANATION.json`
- `packages/application/pattern-seeds/FOUNDER_OBSERVATION_LESSON.json`
- `packages/application/pattern-seeds/LIVE_PRODUCT_PROOF.json`
- `packages/application/pattern-seeds/MANUAL_TO_AUTOMATION.json`
- `packages/application/pattern-seeds/MISTAKE_CONSEQUENCE_FIX.json`
- `packages/application/pattern-seeds/OBJECTION_TO_PROOF.json`
- `packages/application/pattern-seeds/PROBLEM_TO_SOLUTION.json`
- `packages/application/pattern-seeds/RESULT_FIRST_HOW.json`
- `packages/application/src/content.ts`
- `packages/application/src/pattern-selector.ts`
- `packages/contracts/src/canonical.ts`
- `packages/contracts/src/creative-director.ts`
- `packages/contracts/src/creator.ts`
- `packages/contracts/src/gateway-and-prompts.ts`
- `packages/contracts/src/pattern.ts`
- `packages/contracts/src/shared.ts`
- `packages/database/src/invocations.ts`
- `packages/database/src/knowledge.ts`
- `packages/database/src/patterns.ts`
- `tests/contracts/phase2-fidelity.test.ts`
- `tests/fixtures/phase2/creator-input.json`
- `tests/fixtures/phase2/creator-output.json`
- `tests/fixtures/phase2/director-input.json`
- `tests/fixtures/phase2/director-output.json`
- `tests/fixtures/phase2/knowledge.json`
- `tests/postgres/ai.test.ts`
- `tests/support/ai-provider.ts`
- `tests/unit/ai-validation.test.ts`

Phase 3 has NOT been started.
