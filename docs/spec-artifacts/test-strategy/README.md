# Test Strategy Spec Artifacts

Status: specification artifacts only.

Core rules:
- CI is deterministic by default;
- real providers are explicit/off by default;
- release-blocking safety invariants cannot be waived casually;
- media is tested by functional/perceptual contracts, not byte-identical encodes;
- ambiguous external side effects must reconcile before retry;
- restore/recovery is part of acceptance, not merely operations documentation.
