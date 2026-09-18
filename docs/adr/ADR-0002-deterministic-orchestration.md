# ADR-0002 — Deterministic orchestration around AI

## Status
Accepted

## Decision
Les LLM ne pilotent pas directement l'état du système, les queues, la publication ou les secrets.

## Rationale
Créativité et interprétation bénéficient de l'IA.
L'exécution fiable exige des états, contrats, retries et règles déterministes.

## Consequence
Les sorties IA sont structurées, validées puis consommées par le workflow engine.
