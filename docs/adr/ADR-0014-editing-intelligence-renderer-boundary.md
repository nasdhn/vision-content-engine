# ADR-0014 — Editing Intelligence plans; renderer executes

## Status
Accepted

## Decision
Editing Intelligence owns editorial planning, not rendering.

The plan:
- selects exact assets;
- defines millisecond timing;
- uses normalized 0..1 layout coordinates;
- defines captions, product focus, presenter placement, audio intent and whitelisted motion.

The renderer performs deterministic composition, chroma keying, normalization, encoding and technical QA.

Natural human rhythm and product proof take precedence over excessive motion/cutting.

## Consequences
- creative logic is testable separately from renderer implementation;
- render output is reproducible from pinned plan/assets/template/renderer version;
- AI cannot emit arbitrary FFmpeg/Remotion code;
- local editing problems can be repaired without regenerating the whole content pipeline.
