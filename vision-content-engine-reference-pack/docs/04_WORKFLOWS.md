# 04 — Workflows

## États macro

DRAFT_BRIEF
→ CONCEPT_GENERATION
→ AWAITING_CONCEPT_REVIEW
→ CONCEPT_APPROVED
→ CREATIVE_PREPARATION
→ AWAITING_RECORDING (optionnel)
→ READY_TO_EDIT
→ EDITING
→ CREATIVE_QA
→ READY_TO_RENDER
→ RENDERING
→ AWAITING_FINAL_REVIEW
→ APPROVED
→ SCHEDULED
→ PUBLISHING
→ PUBLISHED
→ MEASURING
→ ANALYZED

États transverses :
- REJECTED
- FAILED
- RETRYING
- CANCELLED
- NEEDS_ATTENTION

## Garde-fous
- chaque transition importante est validée par règles ;
- aucune étape IA ne modifie directement l'état final sans validation du workflow engine ;
- toutes les erreurs conservent la cause et l'historique de retry ;
- publication et rendering doivent être idempotents autant que possible.
