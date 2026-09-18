# Decisions Log

Ce fichier contient les décisions produit/architecture validées.
Toute modification significative doit ajouter une entrée datée.

## D-001 — Produit interne d'abord
**Décision :** la V1 sert Vision uniquement.

## D-002 — Qualité > volume
**Décision :** le système vise un rendu de niveau monteur short-form compétent.

## D-003 — Vraie voix
**Décision :** vraie voix naturelle par défaut.

## D-004 — Présence humaine
**Décision :** format principal = incrustation fond vert avec moitié du visage et geste de pointage.

## D-005 — Deux validations humaines
**Décision :** validation des concepts + validation de la vidéo finale.

## D-006 — Publication
**Décision :** publication automatique après review au départ ; autonomie complète possible plus tard par règles.

## D-007 — Pattern Library dès V1
**Décision :** les concepts doivent dériver de patterns connus/analysés.

## D-008 — Researcher externe plus tard
**Décision :** recherche automatique de références/tendances = phase ultérieure.

## D-009 — Editing Intelligence
**Décision :** le montage est un domaine produit central.

## D-010 — Playwright capture
**Décision :** démos Vision via scénarios navigateur contrôlés et reproductibles.

## D-011 — IA vs déterminisme
**Décision :** IA pour ambiguïté/créativité/analyse ; code déterministe pour exécution.

## D-012 — Architecture initiale
**Décision :** modular monolith + workers.

## D-013 — PostgreSQL comme source de vérité
**Décision :** PostgreSQL porte l'état métier canonique.

## D-014 — Transactional Outbox en V1
**Décision :** outbox transactionnel entre état métier et exécution async.

## D-015 — Processus control séparé
**Décision :** scheduler/outbox/reconciliation/périodique vivent hors API.

## D-016 — Stockage objet
**Décision :** médias en stockage S3-compatible.

## D-017 — Idempotence/reconciliation
**Décision :** retries et side effects ambigus sont explicitement gérés.

## D-018 — Déploiement V1 séparé
**Décision :** host Content Engine dédié, distinct de Vision.

## D-019 — Baseline runtime
**Décision :** Node 24 LTS, TS strict, React/Vite, NestJS, Prisma/Postgres, BullMQ/Redis, Zod, Playwright, Remotion, FFmpeg, S3-compatible, pnpm, Docker Compose.

## D-020 — Versions immuables
**Décision :** identité stable + versions immuables.

## D-021 — Idea first-class
**Décision :** `Idea` distinct de Brief/Concept.

## D-022 — Multiple takes
**Décision :** RecordingRequest accepte plusieurs takes.

## D-023 — Scheduling sur Publication
**Décision :** pas d'agrégat Schedule en V1.

## D-024 — Insights/Recommendations persistants
**Décision :** mémoire d'apprentissage durable.

## D-025 — Attribution prudente
**Décision :** DIRECT / INFERRED / UNKNOWN.

## D-026 — Raw vs normalized metrics
**Décision :** séparation stricte.

## D-027 — Coûts/audit persistants
**Décision :** CostEntry/ModelInvocation/AuditEvent sont métier.

## D-028 — Prisma 7
**Décision :** Prisma ORM 7 pour V1.

## D-029 — UUID v7
**Décision :** UUID v7 canoniques.

## D-030 — Lineage média explicite
**Décision :** CaptureRunAsset / RenderInputAsset / TemplateVersionAsset.

## D-031 — Approval explicite
**Décision :** table Approval unique + FKs + CHECK DB.

## D-032 — Brief snapshot
**Décision :** Brief éditable + BriefVersion immuable.

## D-033 — Prisma Migrate
**Décision :** Prisma Migrate autoritaire.

## D-034 — Workflow owns lifecycle enums
**Décision :** lifecycle enums définis par Workflow spec.

## D-035 — Deux gates humaines
**Décision :** ConceptVersion + Render final.

## D-036 — Recording conditionnel
**Décision :** intervention humaine uniquement quand CreativePlan l'exige.

## D-037 — Retry vs regeneration
**Décision :** retry = mêmes inputs + nouvel Attempt ; changement créatif = nouvelle version/nouveau Render.

## D-038 — PUBLISHING_UNKNOWN
**Décision :** reconciliation avant retry ambigu.

## D-039 — WAITING sans worker
**Décision :** workflow en attente ne consomme pas de worker.

## D-040 — Creative QA non-autonome
**Décision :** QA peut bloquer/warn mais ne remplace pas la review finale V1.

## D-041 — Analytics append-only
**Décision :** snapshots non écrasés.

## D-042 — Needs Attention dérivé
**Décision :** pas d'état universel dédié.

## D-043 — WAITING_FOR_INPUTS
**Décision :** blocker générique, dépendances dérivées.

## D-044 — Prisma concret comme spec artifact
**Décision :** schéma canonique sous docs/spec-artifacts avant implémentation.

## D-045 — Config Prisma documentée
**Décision :** config future stockée comme artefact, non active.

## D-046 — Capacités IA comme contrats, pas agents autonomes
**Décision :** Creator, CreativeDirector, EditingIntelligence, CreativeQA et Analyst sont des capacités structurées derrière un gateway.

## D-047 — Knowledge Snapshot versionné
**Décision :** chaque appel IA reçoit un snapshot de connaissance Vision versionné/hashé et récupérable historiquement.

## D-048 — Validation multi-étapes des sorties IA
**Décision :** schema → references → business rules → claims → checks déterministes avant acceptation.

## D-049 — Références IA whitelistées
**Décision :** tout ID généré doit appartenir aux candidats/ressources fournis à l'appel.

## D-050 — Creative QA evidence-bound
**Décision :** la QA ne peut évaluer que les dimensions pour lesquelles elle a reçu une preuve exploitable.

## D-051 — Prompt Registry immuable/versionné
**Décision :** prompt key/version/hash sont figés dans chaque ModelInvocation.

## D-052 — Déduplication déterministe
**Décision :** l'IA reçoit la mémoire, mais le moteur effectue les contrôles exacts/semantiques.

## D-053 — Claims contrôlés
**Décision :** faits produit/prix/stats externes exigent une preuve/version connue ; opinion et expérience sont distinguées.

## D-054 — Analyst prudent
**Décision :** fenêtres de mesure, comparabilité, NULL et niveau de confiance sont obligatoires.

## D-055 — Coûts IA bornés
**Décision :** chaque capability a timeout, retries, token/cost ceilings et fallback sous même contrat.
