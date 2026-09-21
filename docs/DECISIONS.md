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

## D-092 — Playwright scenarios déterministes
**Décision :** l'IA choisit un CaptureScenarioVersion connu; elle ne pilote pas librement le navigateur.

## D-093 — Environnement de capture contrôlé
**Décision :** captures sur environnement/compte Vision dédié, sans données clients normales.

## D-094 — BrowserContext neuf par CaptureRun
**Décision :** cookies/local state ne fuient pas entre runs.

## D-095 — Auth storageState secret-backed
**Décision :** état d'auth traité comme credential, hors Git et hors Assets publics.

## D-096 — Locator contract stable
**Décision :** role/label/test-id/text stable avant CSS fragile.

## D-097 — Readiness sémantique
**Décision :** pas de long sleeps/networkidle comme preuve métier; attente sur état UI connu.

## D-098 — Step DSL borné
**Décision :** Navigate/Click/Fill/Press/Wait/Assert/Screenshot/MarkMoment/VisualSettle seulement en V1.

## D-099 — Fixture-first
**Décision :** démos produit privilégient seeded/prepared state; live providers seulement si nécessaire à la preuve.

## D-100 — Capture diagnostics protégés
**Décision :** traces/screens de panne sont diagnostics sensibles, pas médias éditoriaux publics.

## D-101 — Browser/build pinning
**Décision :** Playwright/Chromium/worker versions sont pinés et enregistrés.

## D-102 — Cinq scénarios initiaux
**Décision :** AGENT_QUERY_TO_RESULTS, AGENT_RESULT_DETAIL, MISSION_RUNNING_TO_DONE, PRICING_PAGE, LANDING_PRODUCT_PROOF.

## D-103 — Dashboard centré sur décisions humaines
**Décision :** UX optimisée autour des deux gates Concept/Render et des exceptions, pas autour des entités/queues internes.

## D-104 — Needs Attention dérivé comme surface principale
**Décision :** incidents/re-auth/unknown/blockers sont agrégés dans une vue opérateur dédiée.

## D-105 — Review vidéo prioritaire
**Décision :** la vidéo finale est dominante visuellement; QA/script/CTA restent contextuels.

## D-106 — Pas de gate script
**Décision :** script éditable mais pas de validation obligatoire séparée.

## D-107 — Production simplifiée
**Décision :** l'UI montre étapes métier et prochaine action; les jobs/queues détaillés restent diagnostics.

## D-108 — Recording Pack orienté raw material
**Décision :** l'utilisateur fournit prises/voix, jamais un TikTok fini.

## D-109 — Analytics prudentes
**Décision :** NULL ≠ 0, attribution inferred distincte, confiance visible, pas de faux leaderboard.

## D-110 — Dashboard desktop-first avec review/upload mobile
**Décision :** opérations complexes desktop; approbation/upload/attention accessibles sur mobile.

## D-111 — Publication unknown sans retry naïf
**Décision :** `PUBLISHING_UNKNOWN` propose reconciliation, jamais retry direct.

## D-112 — UX async persistante
**Décision :** quitter/recharger une vue n'annule pas les workflows longs; les états sont canoniques côté backend.

## D-113 — Distribution mixte par plateforme
**Décision :** Instagram/YouTube utilisent API_AUTOMATED; TikTok utilise MANUAL_HANDOFF en V1 interne.

## D-114 — TikTok Direct Post exclu de la V1 interne
**Décision :** ne pas contourner les règles TikTok par browser automation ni présenter l'API comme conforme à un outil privé interne.

## D-115 — PublicationDeliveryMode explicite
**Décision :** chaque Publication stocke API_AUTOMATED ou MANUAL_HANDOFF.

## D-116 — READY_FOR_MANUAL_PUBLISH
**Décision :** état explicite pour handoff TikTok prêt à publier.

## D-117 — AssetDerivation relationnelle
**Décision :** dérivés plateforme conservent source, Asset dérivé, profil/version et plateforme.

## D-118 — Instagram Login V1
**Décision :** compte professionnel + permissions instagram_business_basic / instagram_business_content_publish.

## D-119 — Instagram remote-fetch sécurisé
**Décision :** URL temporaire read-only vers l'exact mediaAssetId; bucket non public.

## D-120 — YouTube resumable upload
**Décision :** videos.insert avec protocole resumable et reconciliation par remote video/session.

## D-121 — YouTube public capability gate
**Décision :** l'auto-publication publique n'est déclarée prête qu'après satisfaction des exigences d'audit/capability de l'API project.

## D-122 — Scheduler local canonique
**Décision :** Publication.scheduledAt est canonique; native scheduling peut être utilisé sans devenir source de vérité.

## D-123 — PUBLISHING_UNKNOWN interdit le retry naïf
**Décision :** reconcile avant toute nouvelle création distante lorsque le side effect est ambigu.

## D-124 — Manual publication honest
**Décision :** TikTok peut être PUBLISHED sur confirmation humaine avec remotePostId null; aucune confirmation plateforme n'est inventée.

## D-125 — Raw / normalized / attribution séparés
**Décision :** les données provider brutes, les métriques normalisées et les événements business restent des couches distinctes.

## D-126 — NULL ≠ 0
**Décision :** métrique indisponible/non observée = NULL; zéro uniquement si zéro est réellement observé.

## D-127 — Measurement age canonique
**Décision :** comparer des contenus à âge/fenêtre comparable, jamais des cumuls 6h vs 30j sans avertissement.

## D-128 — TikTok analytics manuel V1
**Décision :** pas de scraping; saisie légère T+24h/T+72h/T+7d tant que Display API n'est pas approuvé.

## D-129 — Umami adapter, pas DB direct
**Décision :** pageviews/referrers/events via API Umami supportée.

## D-130 — Publication.trackingCode
**Décision :** identifiant opaque stable pour UTM/attribution quand un lien spécifique est utilisable.

## D-131 — Vision attribution ingest
**Décision :** signup/activation/customer/revenue arrivent par événements HTTP signés, sans couplage DB Vision.

## D-132 — Attribution business typée
**Décision :** sourceSystem/externalEventId dédupliquent; revenue utilise amount minor + currency.

## D-133 — Identité minimisée
**Décision :** utiliser IDs opaques/session IDs; éviter email/nom dans Content Engine.

## D-134 — Métriques plateforme non universelles
**Décision :** metricSemanticsVersion + comparability; aucun score global d'engagement.

## D-135 — EvidencePolicy versionnée
**Décision :** confidence guardrails explicites; seuils configurables, pas vérité universelle.

## D-136 — Analyst non causal/autonome
**Décision :** Insights/Recommendations n'impliquent ni causalité automatique ni mutation de stratégie.

## D-137 — Weekly learning report
**Décision :** rapport hebdo business-first avec funnel, plateformes, patterns, editing, expériences, limites et next tests.

## D-138 — Dedicated Docker Compose production host
**Décision :** V1 déployé sur host dédié avec containers séparés par runtime; pas de Kubernetes.

## D-139 — Secret-reference architecture
**Décision :** secrets résolus à l'exécution; jamais dans Git, DB JSON métier, jobs, logs ou prompts.

## D-140 — Postgres authoritative / Redis recoverable
**Décision :** Redis/BullMQ ne contient jamais l'unique vérité business/schedule/workflow.

## D-141 — Structured logs + redaction
**Décision :** logs JSON corrélés; tokens/cookies/signed URLs/auth headers redacted centralement.

## D-142 — Worker heartbeats et queue-age
**Décision :** santé workers/queues observée indépendamment des états métier.

## D-143 — Resource-bounded heavy workers
**Décision :** render/capture ont limites CPU/mémoire/disk/concurrency/timeouts.

## D-144 — Automated backups + restore drills
**Décision :** backups Postgres off-host surveillés et périodiquement restaurés en environnement isolé.

## D-145 — Initial RPO/RTO targets
**Décision :** cible initiale RPO <=24h et RTO <=4h, considérée atteinte seulement après drill.

## D-146 — Pinned deployment
**Décision :** images/builds/runtime versions pinés; pas de production `git pull && latest install`.

## D-147 — Global kill switches
**Décision :** publication/AI/capture/render/analytics peuvent être pausés sans réécrire l'historique.

## D-148 — Retention by data category
**Décision :** lineage/audit/final media long-terme; diagnostics/temp/trace limités; raw provider policy-bounded.

## D-149 — Local safety default
**Décision :** dev local n'a pas de vrais credentials de publication actifs par défaut.

## D-150 — Terms/licensing recheck discipline
**Décision :** contraintes TikTok/YouTube/Instagram/AI/Remotion re-vérifiées avant activation après longue pause.

## D-151 — Layered deterministic test strategy
**Décision :** tests statiques/unit/domain/contract/DB/integration/workflow/provider/ops, avec vrais providers hors CI normal.

## D-152 — Injectable Clock / seeded randomness
**Décision :** scheduling/windows/exploration testables sans horloge/randomness réelle.

## D-153 — Real PostgreSQL persistence tests
**Décision :** contraintes/migrations/outbox testés sur Postgres réel, pas SQLite substitut.

## D-154 — Media functional reproducibility
**Décision :** validation par métadonnées/scènes/layout/perceptual frames/audio, pas bytes vidéo identiques.

## D-155 — Publishing ambiguity is release-blocking
**Décision :** lost-response after remote accept doit produire PUBLISHING_UNKNOWN sans duplicate publish.

## D-156 — Redis loss must be recoverable
**Décision :** workflow canonical récupérable depuis Postgres/control après perte Redis.

## D-157 — Backup restore is an acceptance test
**Décision :** backup non restauré en drill n'est pas considéré comme récupération prouvée.

## D-158 — Real-provider smoke tests explicit
**Décision :** credentials/flag/budget dédiés; jamais de publication réelle dans CI standard.

## D-159 — Progressive production enablement
**Décision :** shadow mode puis TikTok manuel, uploads privés/test, Instagram auto, YouTube public gated, analytics ensuite.

## D-160 — Release-blocking invariant matrix
**Décision :** gates universels sécurité/lineage/idempotence non contournables par simple green build partiel.

## D-161 — Flaky tests are defects
**Décision :** quarantaine temporaire uniquement avec owner/raison/expiration; pas de rerun-until-green comme norme.

## D-162 — V1 acceptance report
**Décision :** premier go-live conserve commit/build, migrations, test matrix, provider capabilities, backup/restore, flags et limitations connues.

## D-163 — ScriptVersion pins exact ConceptVersion
**Décision :** `ScriptVersion.conceptVersionId` est un FK obligatoire; le Script root reste le groupement stable.

## D-164 — CreativePlanVersion pins exact Template/Profile versions
**Décision :** `templateVersionId` et `editingProfileVersionId` sont relationnels et obligatoires; les anciens string hints ne sont plus source de vérité.

## D-165 — KnowledgeSnapshot DB-backed
**Décision :** connaissance Vision runtime stockée en snapshots DB immuables; ModelInvocation a un FK obligatoire vers le snapshot exact.

## D-166 — SourceReference V1 sans Researcher autonome
**Décision :** provenance claims/ideas first-class; crawler/research automatique reste différé.

## D-167 — Prompt Registry repository-backed
**Décision :** prompts immuables versionnés dans le repo; runtime editing hors scope V1.

## D-168 — ModelInvocation logique + ModelInvocationAttempt
**Décision :** retries/repairs/fallbacks sont des attempts distincts avec provider/model/usage exacts.

## D-169 — Raw AI payload retention bornée
**Décision :** refs opaques temporaires possibles; hashes/version lineage long terme, pas de raw bodies permanents requis.

## D-170 — Creative QA invocation relationnelle
**Décision :** RenderAttempt référence le ModelInvocation exact de Creative QA.

## D-171 — CredentialsRef nullable
**Décision :** PlatformAccount sans API credentials est valide pour un adapter MANUAL_HANDOFF.

## D-172 — Normalized metrics require raw evidence
**Décision :** `MetricSnapshotNormalized.rawSnapshotId` obligatoire.

## D-173 — Attribution source/idempotence typés
**Décision :** AttributionSourceSystem enum + externalEventId obligatoire; revenue amount/currency typés.

## D-174 — Publication delivery mode explicit
**Décision :** aucun default DB pour deliveryMode; trackingCode UUIDv7 auto-généré.

## D-175 — AssetKind FONT
**Décision :** font asset first-class pour Template/renderer.

## D-176 — Repository conventions reconciled
**Décision :** structure `apps/* workers` + packages de `02_SYSTEM_ARCHITECTURE` est canonique.

## D-177 — Historical Prisma docs are non-authoritative
**Décision :** 03A/03B restent historique; schema.prisma + final reconciliation priment.

## D-178 — Legacy security spec removed
**Décision :** `13_SECURITY_OBSERVABILITY.md` supprimé au profit de `13_SECURITY_OBSERVABILITY_OPERATIONS.md`.

## D-179 — spec-v1.0 is the implementation baseline
**Décision :** le tag `spec-v1.0` sur le commit final de spécification devient la baseline normative du V1.

## D-180 — Codex Master Prompt authorizes Phase 0 only
**Décision :** le handoff final n'autorise que Bootstrap & repository; chaque phase suivante exige une autorisation explicite.

## D-181 — Final validation is structural, Prisma CLI validation happens in Phase 0
**Décision :** JSON/TS/static Prisma/cross-artifact sanity checks sont verts; `prisma format/validate/generate` avec dépendance pinée reste un gate Phase 0.

## D-182 — Historical sequencing text is non-operative
**Décision :** les anciens paragraphes After acceptance / Next des specs acceptées décrivent le processus de freeze historique et ne rouvrent aucune décision.

## D-183 — External policy/licence gates remain activation-time checks
**Décision :** TikTok/Instagram/YouTube/provider terms et licence Remotion sont re-vérifiés avant activation réelle sans changer silencieusement la spec.

## D-184 — UTC instants persisted as timestamptz(3)
**Date :** 2026-09-19.

**Décision :** amendement explicite `spec-v1.0.1` : tous les 97 champs `DateTime` / `DateTime?`
V1 représentent des instants UTC et portent `@db.Timestamptz(3)`. `Europe/Paris` reste limité
à la présentation et à l'interprétation des saisies UI avant conversion en instant.
Aucune autre propriété métier ne change. Voir `20_TIME_SEMANTICS_AMENDMENT.md` et ADR-0024.
Après validation de l'amendement, `spec-v1.0.1` remplace la baseline courante de D-179 ;
`spec-v1.0`, son tag et son manifeste restent historiques et immuables. Aucun nouveau tag,
aucune migration appliquée, aucun push et aucune autorisation de Phase 1.

## D-185 — Durable PostgreSQL leases and fencing tokens
**Date :** 2026-09-19.

**Décision :** `spec-v1.0.2` ajoute les leases JobAttempt et les claims OutboxEvent durables,
avec nouveaux tokens UUID à chaque prise/reprise, heartbeats persistants, expirations et
écritures conditionnelles selon `21_DURABLE_LEASES_FENCING_AMENDMENT.md` et ADR-0025.
L'horloge PostgreSQL est autoritaire ; durées et intervalles restent de la configuration typée.
Les quatre CHECK SQL canoniques protègent présence et ordre temporel ; le fencing reste
assuré par les prédicats d'écriture. OutboxEvent.id reste la clé de déduplication transport.
L'expiration d'une lease n'autorise jamais un retry aveugle d'un effet externe ambigu :
Publication reste soumise à PUBLISHING_UNKNOWN et à la réconciliation.
Après validation, spec-v1.0.2 devient la baseline courante ; les tags/manifests précédents
restent historiques et inchangés. Cette tranche n'autorise ni Phase 1, ni migration appliquée,
ni commit, création/déplacement/suppression de tag ou push.


## D-186 — RecordingRequest reopening on loss of the last valid selected take
**Date :** 2026-09-20.

**Décision explicitement approuvée :** `ACCEPTED` équivaut à au moins un Recording valide
`SELECTED`. Rejeter/désélectionner la dernière prise sélectionnée rouvre la demande en
`UPLOADED`; sélectionner une prise valide la ramène à `ACCEPTED`. Mutation, état et
recalcul de disponibilité des inputs sont atomiques, y compris en concurrence. Aucun
remplacement simultané obligatoire. Les lignées immuables historiques restent intactes.
Clarification isolée des sections recording de `04_WORKFLOWS.md` et `10_DASHBOARD_UX.md`,
sans nouvelle version de spec, modification de schéma ou de tag.

## D-187 — EditingPlanVersion preserves the complete validated EditingPlanSpec
**Date :** 2026-09-21.

**Décision :** l'amendement `spec-v1.0.3` ajoute `EditingPlanVersion.planSpecJson`
comme snapshot JSONB lossless de l'`EditingPlanSpec` validé. Les colonnes
timeline/captions/audio/focus/transitions/green-screen/render-settings restent des projections
déterministes. Le champ est nullable uniquement pour préserver les lignes historiques ; tout
nouveau EditingPlanVersion produit par Editing Intelligence doit le renseigner et prouver
l'exact `ModelInvocation` appliqué avant passage à READY. Les manifests spec-v1.0.x
historiques restent immuables.

## D-188 — Structured Editing Intelligence blocker is a successful first-class result
**Date :** 2026-09-21.

**Décision :** `spec-v1.0.4` conserve le contrat/prompt Editing Intelligence 1.0.0 comme
historique et introduit 1.1.0 avec une union stricte `PLAN | BLOCKED`. Un `BLOCKED` valide est
un ModelInvocation `SUCCEEDED`, evidence-bound, non retrié comme erreur provider et persisté
dans `EditingBlocker`; il ne crée jamais d'EditingPlanVersion partiel. Un blocker plus récent
supersède l'OPEN précédent pour la même CreativePlanVersion; un plan valide ultérieur le
résout. Un EditingPlan root précédemment READY repasse DRAFT tant que l'évaluation courante
est bloquée, sans mutation des versions/renders historiques.
