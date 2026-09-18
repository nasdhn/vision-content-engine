# Decisions Log

Ce fichier contient les décisions produit/architecture validées.
Toute modification significative doit ajouter une entrée datée.

## D-001 — Produit interne d'abord
**Décision :** la V1 sert Vision uniquement.

## D-002 — Qualité > volume
**Décision :** le système vise un rendu de niveau monteur short-form compétent, pas un simple assemblage automatisé.

## D-003 — Vraie voix
**Décision :** vraie voix naturelle par défaut.

## D-004 — Présence humaine
**Décision :** format principal = incrustation fond vert avec moitié du visage et geste de pointage ; pas de facecam classique exigée.

## D-005 — Deux validations humaines
**Décision :** validation des concepts + validation de la vidéo finale.

## D-006 — Publication
**Décision :** publication automatique après review au départ ; autonomie complète possible plus tard par règles.

## D-007 — Pattern Library dès V1
**Décision :** les concepts doivent dériver de patterns connus/analysés, pas de génération arbitraire.

## D-008 — Researcher externe plus tard
**Décision :** recherche automatique de références / tendances = phase ultérieure ; architecture compatible dès V1.

## D-009 — Editing Intelligence
**Décision :** le montage est un domaine produit central.

## D-010 — Playwright capture
**Décision :** prévoir l'automatisation de démos Vision via scénarios de navigateur contrôlés et reproductibles.

## D-011 — IA vs déterminisme
**Décision :** IA pour ambiguïté, créativité et analyse ; code déterministe pour exécution, état, rendering, scheduling, publication, retries, sécurité.

## D-012 — Architecture initiale
**Décision :** modular monolith + workers ; pas de microservices prématurés.

## D-013 — PostgreSQL comme source de vérité
**Décision :** PostgreSQL porte l'état métier canonique. Redis/BullMQ sert uniquement à l'exécution asynchrone.

## D-014 — Transactional Outbox en V1
**Décision :** les demandes de jobs asynchrones importantes passent par un outbox transactionnel.

## D-015 — Processus control séparé
**Décision :** scheduler, outbox dispatcher, reconciliation et tâches périodiques vivent dans un processus `control` séparé de l'API.

## D-016 — Stockage objet pour les médias
**Décision :** les fichiers audio/vidéo/images utilisent une abstraction S3-compatible.

## D-017 — Idempotence et reconciliation
**Décision :** rendering, capture, analytics et publication doivent tolérer retries et résultats distants ambigus sans créer de doublons.

## D-018 — Déploiement V1 simple mais séparé
**Décision :** le Content Engine peut démarrer sur un seul host dédié distinct de Vision.

## D-019 — Baseline runtime
**Décision :** Node.js 24 LTS, TypeScript strict, React/Vite, NestJS, Prisma/PostgreSQL, Redis/BullMQ, Zod, Playwright, Remotion, FFmpeg/ffprobe, stockage S3-compatible, pnpm workspaces, Docker Compose.

## D-020 — Entités racines + versions immuables
**Décision :** les objets métier évolutifs utilisent une identité stable et des versions immuables.

## D-021 — Idea est une entité de première classe
**Décision :** `Idea` reste distinct de `Brief` et `Concept`.

## D-022 — Plusieurs prises par RecordingRequest
**Décision :** un `RecordingRequest` peut recevoir plusieurs `Recording`/takes.

## D-023 — Scheduling porté par Publication
**Décision :** pas d'agrégat `Schedule` séparé en V1 ; `Publication.scheduledAt` est canonique.

## D-024 — Insights et Recommendations persistants
**Décision :** `Insight` et `Recommendation` sont des entités persistantes.

## D-025 — Attribution prudente en V1
**Décision :** `AttributionEvent` existe dès la V1 avec une confiance explicite `DIRECT / INFERRED / UNKNOWN`.

## D-026 — Raw metrics séparées des normalized metrics
**Décision :** les snapshots bruts des plateformes sont immuables et séparés des métriques normalisées.

## D-027 — Coûts et audit comme données métier
**Décision :** `CostEntry`, `ModelInvocation` et `AuditEvent` sont persistés.

## D-028 — Prisma 7 pour la V1
**Décision :** Prisma ORM 7 est explicitement retenu pour la V1.

## D-029 — UUID v7 comme ID canonique
**Décision :** les entités canoniques utilisent des UUID v7 cohérents.

## D-030 — Lineage média explicite
**Décision :** `CaptureRunAsset`, `RenderInputAsset` et `TemplateVersionAsset` sont explicites.

## D-031 — Approval relationnel explicite
**Décision :** une table `Approval` unique avec FKs explicites vers les sujets V1 et contrainte DB.

## D-032 — Snapshot Brief conservé
**Décision :** conserver `Brief` éditable + `BriefVersion` immuable.

## D-033 — Prisma Migrate autoritaire
**Décision :** Prisma Migrate est le workflow de schéma ; `db push` n'est pas la source de vérité de production.

## D-034 — Enums de workflow propriétaires du workflow
**Décision :** les lifecycle enums sont définis par `04_WORKFLOWS.md`.

## D-035 — Deux gates humaines par défaut
**Décision :** validation obligatoire du ConceptVersion puis du Render final. Pas de validation obligatoire indépendante du script.

## D-036 — Recording humain conditionnel
**Décision :** l'intervention humaine d'enregistrement n'existe que lorsque le CreativePlan l'exige.

## D-037 — Retry technique vs regeneration créative
**Décision :** un retry technique conserve les mêmes inputs et crée un nouvel Attempt ; une modification d'inputs/creative plan crée une nouvelle version ou un nouveau Render.

## D-038 — PUBLISHING_UNKNOWN
**Décision :** tout effet distant ambigu passe par `PUBLISHING_UNKNOWN` et reconciliation avant nouveau publish.

## D-039 — WAITING ne consomme pas de worker
**Décision :** un WorkflowRun peut rester `WAITING` pour validation, recording, scheduled time ou measurement window sans job actif.

## D-040 — QA créative non autonome en V1
**Décision :** la QA créative peut bloquer ou émettre des warnings, mais l'approbation finale humaine reste obligatoire.

## D-041 — Analytics append-only
**Décision :** les snapshots analytics sont ajoutés dans le temps, jamais écrasés.

## D-042 — Needs Attention dérivé
**Décision :** pas d'enum universel `NEEDS_ATTENTION`; la vue opérationnelle est dérivée.

## D-043 — CreativePlan WAITING_FOR_INPUTS
**Décision :** `WAITING_FOR_INPUTS` remplace les blockers séparés recording/capture. Les dépendances manquantes sont dérivées des relations réelles.

## D-044 — Schéma Prisma concret figé comme artefact de spec
**Décision :** le schéma Prisma complet est stocké sous `docs/spec-artifacts/schema.prisma` tant que l'implémentation n'est pas autorisée.

## D-045 — Config Prisma documentée mais non exécutée
**Décision :** `docs/spec-artifacts/prisma.config.ts` documente la future config Prisma 7 ; elle n'est pas encore une config d'application active.
