# 02 — System Architecture

## Cible V1
Architecture modulaire, interne, observable et extensible.

### Composants
- Web app / dashboard
- Backend API
- PostgreSQL comme source de vérité
- Redis + queue
- AI orchestration layer
- Rendering workers
- Capture workers
- Publishing workers
- Analytics workers
- Object storage
- Observability

## Stack candidate
- Frontend : React + TypeScript
- Backend : NestJS + TypeScript
- ORM : Prisma
- DB : PostgreSQL
- Queue : BullMQ + Redis
- Rendering : Remotion + FFmpeg / ffprobe
- Product capture : Playwright
- Validation JSON : Zod
- Object storage : S3-compatible
- Observability : structured logs + tracing + error tracking

## Principe d'autorité
- PostgreSQL = état canonique.
- Queue = exécution asynchrone.
- LLM = proposition structurée, jamais source de vérité.
- Worker = exécuteur, pas propriétaire de l'état métier.

## Séparation avec Vision
Le Content Engine doit vivre dans un projet/repository séparé de la production Vision.
Il peut consommer des scénarios ou interfaces Vision, mais ne doit pas mettre en danger le SaaS principal.

## Évolution
Une migration vers une orchestration plus sophistiquée n'est envisagée que si la complexité réelle le justifie.
