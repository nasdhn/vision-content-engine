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

## D-056 — Pattern distinct de Angle / Template / EditingProfile
**Décision :** Pattern = mécanisme marketing/narratif ; Angle = idée spécifique ; Template = rendu visuel ; EditingProfile = comportement de montage.

## D-057 — Catégorie primaire stable
**Décision :** la catégorie primaire appartient au Pattern root et reste stable. Un changement de catégorie/mécanisme majeur crée un nouveau Pattern.

## D-058 — PatternVersion sans performance mutable
**Décision :** aucune performance contextuelle n'est stockée comme vérité dans PatternVersion. Les preuves/performance sont dérivées séparément dans le temps.

## D-059 — Pas de score global de Pattern
**Décision :** aucune note universelle type 92/100. L'évidence reste contextualisée par audience, plateforme, format, fenêtre et échantillon.

## D-060 — Pattern Selector déterministe
**Décision :** le Creator ne voit qu'un ensemble borné de PatternVersion éligibles préparé avant l'appel IA.

## D-061 — Exploration/exploitation configurable
**Décision :** mode BALANCED par défaut ; répartition exploration/exploitation configurable, non codée comme vérité métier permanente.

## D-062 — Fatigue par combinaison, pas par Pattern seul
**Décision :** répétition évaluée via Pattern + audience + topic + angle + hook + proof + format + plateforme.

## D-063 — Seed V1 limité à 8 Patterns
**Décision :** démarrage avec huit mécanismes distincts ; variantes proches restent des angles jusqu'à preuve d'un mécanisme réellement différent.

## D-064 — Editing Intelligence est un planificateur éditorial
**Décision :** Editing Intelligence décide le montage ; le renderer exécute sans décision créative.

## D-065 — Montage en deux passes conceptuelles
**Décision :** sélection éditoriale des assets avant construction du timing/composition.

## D-066 — Voix naturelle comme colonne vertébrale
**Décision :** sur contenu narré, les visuels s'adaptent normalement à la vraie voix, pas l'inverse.

## D-067 — Silences classifiés
**Décision :** DEAD_AIR est coupé ; respirations/pauses intentionnelles sont préservées selon profil.

## D-068 — Cut grammar sémantique
**Décision :** cuts guidés par changement d'idée/preuve/état visuel, pas par timer arbitraire.

## D-069 — Proof first
**Décision :** preuve produit prioritaire sur décoration, présentateur ou motion.

## D-070 — Coordonnées visuelles normalisées
**Décision :** x/y/width/height utilisent 0..1 comme convention canonique.

## D-071 — Captions sémantiques
**Décision :** sous-titres en chunks/phrases, emphase rare, timing aligné à la vraie parole quand possible.

## D-072 — Motion intentionnelle
**Décision :** motion uniquement via presets whitelistés et avec but éditorial explicite.

## D-073 — Musique/SFX optionnels
**Décision :** priorité audio à la voix ; musique/SFX ne sont jamais obligatoires.

## D-074 — Timeline multi-layer explicite
**Décision :** EditingPlan encode layers/zIndex/composition et non une simple liste plate de plans.

## D-075 — Hard validation déterministe
**Décision :** timing, références, collisions, presets, slots template et contraintes techniques sont validés par code.

## D-076 — Réparation minimale
**Décision :** un problème local de montage crée une nouvelle EditingPlanVersion/Render sans régénérer inutilement tout le pipeline.

## D-077 — Diagnostics descriptifs, pas score qualité
**Décision :** stocker densité/cuts/presenter/product time/etc. comme signaux descriptifs, sans note universelle.

## D-078 — 7 EditingProfiles V1
**Décision :** FAST_PRODUCT_DEMO, FOUNDER_STORY, GREEN_SCREEN_EXPLAINER, PROBLEM_SOLUTION, MANUAL_VS_VISION, HIGH_ENERGY_SHORT, CALM_EXPERT_SHORT.

## D-079 — VideoRenderer abstraction
**Décision :** Remotion est derrière une interface `VideoRenderer`; le domaine ne dépend pas directement de son API.

## D-080 — Render déterministe sans IA mid-frame
**Décision :** aucun appel LLM pendant le rendu. Le worker consomme un EditingPlanVersion validé.

## D-081 — Preflight/probe obligatoire
**Décision :** inputs et output sont probés; un exit code de renderer ne suffit pas comme validation.

## D-082 — SDR BT.709 master V1
**Décision :** le master social V1 est SDR BT.709; HDR/HLG/Dolby Vision sont tone-mappés ou rejetés explicitement.

## D-083 — Renderer sans fetch internet arbitraire
**Décision :** les dépendances média de rendu doivent être des Assets connus/versionnés, pas des URLs libres.

## D-084 — Profils média versionnés
**Décision :** ColorProfile, AudioProfile et CodecProfile sont des configurations déterministes versionnées.

## D-085 — Fonts/brand assets pinés
**Décision :** aucune dépendance critique à des fonts/assets mutablement installés sur l'host.

## D-086 — Exact Publication media asset
**Décision :** `Publication.mediaAssetId` référence l'Asset exact envoyé à la plateforme.

## D-087 — Dérivé plateforme avec provenance
**Décision :** tout dérivé futur conserve une provenance explicite depuis le master; le shape final sera fermé avec Distribution.

## D-088 — Rendu isolé par attempt
**Décision :** workspace temporaire unique par RenderAttempt, jamais canonique.

## D-089 — ms→frame conversion centralisée
**Décision :** utilitaire unique, start=floor/end=ceil sous contraintes de durée.

## D-090 — Technical QA déterministe
**Décision :** codec, dimensions, durée, color metadata, audio, black/silence catastrophiques sont contrôlés par code.

## D-091 — Remotion licensing gate
**Décision :** licence Remotion re-vérifiée avant production; l'abstraction doit permettre remplacement.
