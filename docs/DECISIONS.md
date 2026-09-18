# Decisions Log

Ce fichier contient les décisions produit/architecture validées.
Toute modification significative doit ajouter une entrée datée.

## D-001 — Produit interne d'abord
**Décision :** la V1 sert Vision uniquement.  
**Raison :** éviter de construire un SaaS de marketing générique avant d'avoir prouvé le système.

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
**Décision :** le montage est un domaine produit central : pacing, cuts, captions, crops, zooms, sound design, rythme, hook, CTA, QA créative.

## D-010 — Playwright capture
**Décision :** prévoir l'automatisation de démos Vision via scénarios de navigateur contrôlés et reproductibles.

## D-011 — IA vs déterminisme
**Décision :** IA pour ambiguïté, créativité et analyse ; code déterministe pour exécution, état, rendering, scheduling, publication, retries, sécurité.

## D-012 — Architecture initiale
**Décision :** modular monolith + workers ; pas de microservices prématurés.

## D-013 — PostgreSQL comme source de vérité
**Décision :** PostgreSQL porte l'état métier canonique. Redis/BullMQ sert uniquement à l'exécution asynchrone.

## D-014 — Transactional Outbox en V1
**Décision :** les demandes de jobs asynchrones importantes passent par un outbox transactionnel afin d'éviter les incohérences PostgreSQL ↔ Redis.

## D-015 — Processus control séparé
**Décision :** scheduler, outbox dispatcher, reconciliation et tâches périodiques vivent dans un processus `control` séparé de l'API.

## D-016 — Stockage objet pour les médias
**Décision :** les fichiers audio/vidéo/images utilisent une abstraction S3-compatible ; PostgreSQL ne stocke que métadonnées et clés d'objet.

## D-017 — Idempotence et reconciliation
**Décision :** rendering, capture, analytics et surtout publication doivent être conçus pour tolérer retries et résultats distants ambigus sans créer de doublons.

## D-018 — Déploiement V1 simple mais séparé
**Décision :** le Content Engine peut démarrer sur un seul host dédié avec plusieurs conteneurs/processus, distinct de Vision. Les workers lourds doivent pouvoir être déplacés plus tard sans réécriture métier.

## D-019 — Baseline runtime
**Décision :** V1 cible Node.js 24 LTS, TypeScript strict, React/Vite, NestJS, Prisma/PostgreSQL, Redis/BullMQ, Zod, Playwright, Remotion, FFmpeg/ffprobe, stockage S3-compatible, pnpm workspaces et Docker Compose initialement.
