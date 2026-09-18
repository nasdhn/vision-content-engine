# 15 — Repository Conventions

## Repository recommandé
Projet séparé : `vision-content-engine`

## Structure cible indicative
apps/
  web/
  api/

packages/
  domain/
  ai/
  video/
  publishing/
  analytics/
  shared/

workers/
  ai-worker/
  render-worker/
  capture-worker/
  publish-worker/
  analytics-worker/

docs/
infra/
scripts/
tests/

## Règles
- TypeScript strict ;
- schemas partagés ;
- migrations versionnées ;
- pas de logique métier cachée dans les controllers ;
- pas d'appels LLM directs dispersés dans le code ;
- pas de publication directe depuis l'UI ;
- pas de secrets commités ;
- toute décision importante documentée.
