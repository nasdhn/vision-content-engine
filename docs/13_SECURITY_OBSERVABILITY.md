# 13 — Security & Observability

## Secrets
- jamais dans git ;
- variables d'environnement / secret store ;
- tokens sociaux chiffrés ;
- rotation possible.

## Logs
Chaque événement important doit transporter :
- workflowRunId
- conceptId
- renderId
- publicationId
- jobAttemptId si applicable

## Observabilité
Suivre notamment :
- queue lag
- render success rate
- render duration
- publish success rate
- retry rate
- analytics sync lag
- AI cost
- cost per rendered video
- rejection rate
- manual edit rate

## Audit
Les approbations, rejets, publications et modifications importantes doivent être auditables.
