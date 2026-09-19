# Revue de l'aperçu SQL initial — Phase 0

Généré avec Prisma **7.10.0**, sous Node **24.21.0**, depuis
`prisma/schema.prisma` via `pnpm db:preview`. Revue effectuée le 19 septembre 2026.

**Aperçu seulement : ce fichier ne constitue pas une migration exécutable approuvée.**
Il n'a pas été appliqué. Le dossier `prisma/migrations` n'a pas été créé.

## Contenu vérifié

- 49 enums PostgreSQL, 50 tables, 50 clés primaires.
- 104 index secondaires : 35 uniques et 69 non uniques.
- 72 clés étrangères : 48 `ON DELETE RESTRICT`, 24 `ON DELETE SET NULL`, aucune suppression en cascade.
- Aucun `DROP`, `TRUNCATE`, `DELETE FROM`, insertion de données, secret ou appel externe.
- Relations exactes conservées de Publication à Render, EditingPlanVersion, CreativePlanVersion,
  ScriptVersion, ConceptVersion et BriefVersion ; versions de template et de profil obligatoires.
- `Publication.deliveryMode` obligatoire sans valeur par défaut ; `trackingCode` unique.
- `Publication.mediaAssetId` nullable conformément au schéma canonique, pour permettre DRAFT.
  Son obligation avant publication et sa cohérence avec le Render devront être validées par l'application.
- `ModelInvocation.knowledgeSnapshotId` obligatoire, provenance du prompt et table des tentatives préservées.
- `MetricSnapshotNormalized.rawSnapshotId` obligatoire ; métriques optionnelles sans zéro implicite.
- Idempotence d'attribution par index unique `(sourceSystem, externalEventId)`.
- Tables OutboxEvent, WorkflowRun, JobAttempt présentes uniquement dans l'aperçu, sans moteur implémenté.
- UUID v7 générés par Prisma (`@default(uuid(7))`) : pas de valeur SQL par défaut pour ces identifiants.
  Les écritures SQL directes devront fournir les identifiants et les champs `@updatedAt`.

## Conditions avant une future migration Phase 1

Le Master Prompt §20 impose trois contraintes que l'aperçu Prisma seul ne contient pas :

1. CHECK du sujet Approval : CONCEPT exige `conceptVersionId` seul ; RENDER exige `renderId` seul.
2. Index unique partiel de KnowledgeSnapshot sur `key` lorsque `status = 'ACTIVE'`.
3. CHECK de complétude du revenu : REVENUE exige `valueAmountMinor` et `valueCurrency`.

Ces contraintes et leurs tests PostgreSQL, ainsi que les validations inter-tables,
doivent être ajoutés lors de la Phase 1 autorisée. Ils ne sont pas implémentés ici.

Les `DateTime` canoniques sans annotation native produisent `TIMESTAMP(3)` sans fuseau.
`docs/11_DISTRIBUTION.md:263` demande des timestamps avec fuseau pour la planification.
Le schéma canonique, prioritaire, est conservé. Avant toute persistance de planification,
résoudre explicitement ce point dans la spécification : conservation et convention UTC stricte,
ou amendement accepté avec `@db.Timestamptz(3)` sur les champs concernés. Aucun changement
de type n'a été anticipé en Phase 0.

La revue confirme la fidélité de la génération au schéma figé ; elle ne valide pas
l'intégrité métier d'une base migrée. Aucune table métier n'a été créée ou migrée.
