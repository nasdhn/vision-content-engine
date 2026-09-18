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
