# Phase 11A — Generation Progressive Activation

**Status:** 11A-1 implementation candidate.

Phase 11 activates capabilities progressively. Generation is the first
capability in the frozen Phase 11 order.

## 11A-1 scope

11A-1 introduces the reviewed real-provider activation path without selecting,
connecting or calling a real external AI provider.

It does not:

- add an external AI SDK;
- add a provider credential;
- make an external AI request;
- incur provider cost;
- unpause AI generation;
- activate capture, rendering, publishing, analytics or learning.

## Configuration boundary

`VCE_REAL_PROVIDERS_ENABLED=false` remains the default.

The parser may represent an explicit `true` value for Phase 11, but the
canonical activation decision is stricter:

- `LOCAL` is always fake-provider only;
- a non-LOCAL environment must explicitly set
  `VCE_REAL_PROVIDERS_ENABLED=true`;
- absence of that condition fails closed.

`assertLocalBootstrap()` continues to reject a LOCAL bootstrap with real
providers enabled.

## Gateway boundary

`StructuredProvider.kind` supports:

- `FAKE`;
- `REAL`.

Registering a `REAL` provider does not authorize execution.

`AIProviderGateway` defaults its real-provider activation predicate to false.
When disabled:

- fake providers remain available for deterministic tests;
- a policy that can only resolve to a real provider fails with
  `REAL_PROVIDERS_DISABLED`;
- no provider call is made;
- no durable `ModelInvocation` is started for that rejected selection.

The activation predicate is checked again immediately before each real
provider attempt. A provider therefore cannot continue into another real call
after the activation gate closes between attempts.

All existing budget reservation, attempt limits, timeout, schema validation,
cost accounting, pause semantics and durable invocation behavior remain in the
same gateway.

## Testing

11A-1 uses a `SimulatedRealAIProvider` in the test suite.

It has `kind=REAL` but performs no network call. It proves both sides of the
gate:

1. disabled real-provider activation fails before provider execution;
2. explicit activation traverses the same validation, persistence and budget
   path as deterministic fake providers.

This test helper is not a production adapter.

## Release smoke

Operational release smoke remains deliberately fail-closed and requires:

- `VCE_REAL_PROVIDERS_ENABLED=false`;
- all five emergency work classes paused.

Phase 11 provider canaries are separate explicit commands and must never be
folded into normal CI or the ordinary release smoke.

## Next tranche

11A-2 may select and implement the first concrete AI provider adapter.

That tranche must separately define:

- provider/model choice;
- secret reference and resolver boundary;
- request/response adapter mapping;
- estimator and currency semantics;
- provider-specific timeout/error mapping;
- current provider capability/policy verification.

Only after that review may 11A-3 execute the frozen
`LOW_COST_EXPLICIT_CANARY`.

11A-1 itself performs zero external provider calls.
