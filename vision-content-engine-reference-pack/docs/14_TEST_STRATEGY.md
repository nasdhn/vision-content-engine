# 14 — Test Strategy

## Niveaux
- unit tests
- schema/contract tests
- integration tests
- worker tests
- render snapshot/fixture tests
- Playwright scenario tests
- publisher adapter tests avec mocks
- end-to-end workflow tests

## Gates
Aucune phase d'implémentation n'est considérée terminée sans :
- tests verts ;
- build vert ;
- migrations vérifiées ;
- rollback identifié ;
- critères d'acceptation vérifiés.

## Important
Les tests de rendu doivent vérifier à la fois la validité technique et des invariants créatifs mesurables lorsque possible.
