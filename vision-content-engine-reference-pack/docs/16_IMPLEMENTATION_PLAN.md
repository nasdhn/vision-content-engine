# 16 — Implementation Plan

## Phase 0 — Repository & architecture
- créer repo
- conventions
- CI locale
- env examples
- base Docker
- docs
- aucune feature métier complexe

## Phase 1 — Core domain
- DB
- entities
- versioning
- workflows
- approvals
- audit
- tests

## Phase 2 — Pattern Library & AI contracts
- patterns
- Brand/Product Knowledge
- Creator
- Creative Director
- schemas
- model invocation logging
- tests

## Phase 3 — Media & Recording Pack
- assets
- upload
- recording requests
- storage
- UI minimale

## Phase 4 — Editing Intelligence & Video Engine
- editing plan
- editing profiles
- first templates
- Remotion
- FFmpeg
- QA
- render worker

## Phase 5 — Product Capture
- Playwright scenarios
- staging/demo integration
- capture worker
- failure handling

## Phase 6 — Review UX
- player
- batch approval
- structured rejection feedback
- regenerate flow

## Phase 7 — Distribution
- scheduler
- platform adapters
- auth
- retry/reconciliation
- automatic publishing after approval

## Phase 8 — Analytics
- raw ingestion
- normalized metrics
- dashboard
- experiment dimensions

## Phase 9 — Learning loop
- weekly analyst
- confidence model
- recommendations
- next experiments

## Phase 10 — Hardening
- observability
- security
- backups
- cost controls
- load testing
- autonomous-mode prerequisites

## Règle Codex
Chaque phase :
1. inspecter ;
2. proposer plan ;
3. implémenter uniquement le scope ;
4. tester ;
5. produire diff/résumé ;
6. STOP avant la phase suivante.
