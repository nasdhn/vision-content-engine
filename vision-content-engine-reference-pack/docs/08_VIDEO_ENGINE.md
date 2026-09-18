# 08 — Video Engine

## Cible
Master vertical propre, sans watermark.

## Pipeline
Assets
→ Editing Plan
→ Remotion composition
→ Render
→ FFmpeg normalization
→ ffprobe validation
→ Creative QA
→ Final master

## Template contract
Chaque template doit avoir :
- id
- version
- category
- input schema
- supported aspect ratios
- supported duration range
- required slots
- optional slots
- capabilities
- renderer version

## Règles
- templates versionnés ;
- aucune mutation rétroactive d'une version publiée ;
- rendu reproductible à partir des données conservées ;
- pas de dépendance à un état implicite du LLM.
