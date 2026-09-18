# 11 — Distribution

## Adapters
- TikTokPublisher
- InstagramPublisher
- YouTubePublisher

## Scheduler
Le calendrier est géré par le Content Engine.

## États
- DRAFT
- SCHEDULED
- PUBLISHING
- PUBLISHED
- FAILED
- RETRYING
- UNKNOWN

## Exigences
- OAuth/tokens gérés proprement ;
- rate limits ;
- retries avec backoff ;
- idempotence / anti-doublon ;
- reconciliation ;
- remote platform id stocké ;
- metadata spécifique par plateforme ;
- master sans watermark.

## Autonomie
V1 : publication automatique uniquement après approval.
Plus tard : règles de confiance par type de contenu.
