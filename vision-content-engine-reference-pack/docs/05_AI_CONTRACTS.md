# 05 — AI Contracts

## Principe
Les LLM doivent produire des objets structurés validés par schéma.
Aucun résultat critique du pipeline ne dépend d'un texte libre non validé.

## Capacités V1

### Creator
Entrée :
- brief
- Brand/Product Knowledge
- Pattern Library
- Content Memory
- contraintes de campagne

Sortie :
- concept
- angle
- hook
- audience
- objective
- hypothesis
- selectedPattern
- rationale

### Creative Director
Entrée :
- concept approuvé
- assets disponibles
- contraintes plateforme
- styles autorisés

Sortie :
- script structuré
- scenes
- required recordings
- product captures
- template
- editing profile
- CTA
- target duration

### Editing Intelligence
Entrée :
- script
- recordings
- captures
- template
- editing profile

Sortie :
- editing plan structuré
- cuts
- timing
- crops
- overlays
- captions
- emphasis
- sound cues
- transitions

### Analyst
Entrée :
- métriques comparables
- historique
- hypothèses
- metadata du contenu

Sortie :
- observations
- confidence
- hypotheses
- recommended tests

## À définir précisément
Les JSON Schemas/Zod schemas seront figés avant implémentation.
