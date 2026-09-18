# AI Contract Spec Artifacts

Status: specification artifacts only.

These files express the accepted V1 AI contracts as strict Zod-shaped reference artifacts.

They are NOT active application code until implementation is explicitly authorized.

During implementation:
- copy/reconcile them into the real contracts package;
- pin the Zod version;
- add refinements for cross-field timing/reference constraints;
- run contract tests;
- preserve schema version identifiers.
