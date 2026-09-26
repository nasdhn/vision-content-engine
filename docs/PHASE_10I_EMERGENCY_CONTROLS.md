# Phase 10I — Kill Switches / Emergency Controls

## Status

Implementation tranche for the frozen V1 operator kill-switch contract.

The canonical switch names remain:

- `PAUSE_ALL_PUBLISHING`
- `PAUSE_AI_GENERATION`
- `PAUSE_CAPTURE`
- `PAUSE_RENDERING`
- `PAUSE_ANALYTICS_COLLECTION`

No additional switch, database control plane, admin endpoint, or migration is introduced.

## Contract

A pause switch blocks **new work** of its affected class.

A pause must not:

- rewrite a queued JobAttempt as FAILED;
- consume an outbox claim merely to discover the pause;
- fabricate a workflow failure;
- delete or mutate scheduled Publication intent;
- cancel an already-running external side effect and guess whether it happened.

This is intentionally different from process termination.

## Enforcement points

### Publishing

`PAUSE_ALL_PUBLISHING` is enforced before:

- due Publication dispatch;
- distribution outbox claim;
- publish-worker attempt start;
- manual handoff readiness transition through due dispatch.

Scheduled Publications remain canonical and can be resumed safely.

### AI generation

`PAUSE_AI_GENERATION` is enforced before:

- weekly-analysis outbox claim;
- weekly-analysis JobAttempt claim.

`AIProviderGateway` retains its existing inner pause check as a second barrier before ModelInvocation/provider execution.

### Capture

`PAUSE_CAPTURE` is represented at the capture worker boundary by the injected pause probe.

The worker returns `PAUSED` before claiming a capture JobAttempt. Existing RUNNING capture work is not force-aborted because browser/external side effects may already be ambiguous.

### Rendering

`PAUSE_RENDERING` is represented at the render worker boundary by the injected pause probe.

The worker returns `PAUSED` before Render identity reads or durable JobAttempt claim. Existing RUNNING renders drain under their lease and immutable-output reconciliation rules.

### Analytics collection

`PAUSE_ANALYTICS_COLLECTION` is enforced before:

- analytics outbox claim;
- analytics JobAttempt claim;
- collector execution.

Existing canonical analytics intents remain available for later dispatch.

## Resume semantics

Re-enabling a class does not synthesize or rewrite state.

Normal control/worker loops re-evaluate existing durable intent:

- scheduled Publications remain scheduled;
- pending outbox events remain pending;
- queued JobAttempts remain queued.

Existing idempotency, lease fencing, retry and reconciliation policies remain authoritative.

## In-flight work

V1 kill switches are **new-work barriers**, not hard cancellation signals.

This is deliberate:

- an AI request may already be billable;
- capture may already have caused a browser/remote side effect;
- publish may already be remotely ambiguous;
- render may already be uploading an immutable object;
- analytics may already be reading a provider.

Stopping these mid-flight without their normal reconciliation rules can make recovery less safe.

## Provider hard gate

`VCE_REAL_PROVIDERS_ENABLED=false` remains independent from pause switches and stays fail-closed.

A pause switch is an operational containment control. It does not enable a provider.

## Operator application

The frozen runtime configuration defaults every pause switch to `true`.

In the current V1 deployment model, environment-backed switch changes take effect when the affected process/control composition reloads configuration. There is no database-backed or public HTTP hot-toggle endpoint in Phase 10I.

A future hot control plane may supply the existing pause probes, but must preserve this contract and require explicit security review.

## Verification

Phase 10I tests prove that a paused class:

- does not call the external/fake executor;
- does not acquire the relevant durable JobAttempt lease;
- leaves queued canonical state queued;
- does not create ModelInvocation/analytics evidence;
- leaves pending outbox state available for resume.

Publishing retains its existing Phase 7 kill-switch tests and is included in the Phase 10I regression gate.
