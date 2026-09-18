# ADR-0001 — Separate repository from Vision

## Status
Accepted

## Decision
Le Vision Content Engine sera développé dans un repository séparé du repository principal de Vision.

## Rationale
- réduire le risque sur la production Vision ;
- isoler dépendances lourdes vidéo/browser ;
- permettre workers et déploiements séparés ;
- garder des cycles de développement indépendants.

## Consequence
Toute interaction avec Vision doit passer par interfaces explicites, environnements contrôlés ou données dédiées.
