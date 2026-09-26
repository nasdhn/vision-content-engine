# Phase 11 — Distribution Activation Checklist

**Status:** future activation checklist only. Phase 7 closure does not authorize or perform any live provider activation.

Use this checklist immediately before progressively enabling Distribution in production. Re-verify
current provider policies, scopes, account capabilities and operational constraints at activation
time rather than relying on Phase 7 implementation-time assumptions.

## Global gates — required before any automated provider call

- [ ] Phase 7 is closed on a known commit with `pnpm check:phase7` green.
- [ ] Phase 10 security/operations hardening required by the implementation plan is complete for the target environment.
- [ ] Current provider terms, API capabilities, quotas and required app review/audit status have been re-checked.
- [ ] No credential is stored in Git, BullMQ payloads, browser state, logs or canonical publication metadata.
- [ ] The production secret resolver can resolve the exact account credential reference without exposing its value.
- [ ] The target `PlatformAccount` is `ACTIVE` and its capability snapshot is current.
- [ ] Exact approved media lineage and provider technical preflight are proven for a canary publication.
- [ ] Reconciliation has been exercised for an intentionally ambiguous simulated side effect.
- [ ] Operator access to `/distribution` and Needs Attention is available before automated posting is enabled.
- [ ] Backout procedure is explicit and starts by setting `PAUSE_ALL_PUBLISHING=true`.

## Runtime configuration transition

Phase 7 intentionally keeps:

```text
PAUSE_ALL_PUBLISHING=true by default
VCE_REAL_PROVIDERS_ENABLED=false by default
```

Phase 11A-1 introduces the reviewed shared configuration path that can represent explicit
real-provider activation in a non-LOCAL environment. The default remains disabled and LOCAL remains
fake-provider only. This configuration path alone does not authorize Distribution activation.
Do not bypass the canonical activation helper or patch runtime objects in memory.

Before the first live call:

- [ ] confirm the target non-LOCAL runtime explicitly enables the reviewed real-provider configuration path;
- [ ] keep `PAUSE_ALL_PUBLISHING=true` while credentials/accounts are connected and checked;
- [ ] verify the specific provider/account capability gate;
- [ ] run a no-side-effect readiness check;
- [ ] only then set `PAUSE_ALL_PUBLISHING=false` for the narrow canary window.

Missing any gate fails closed.

## TikTok

- [ ] TikTok remains MANUAL_HANDOFF for V1.
- [ ] No Direct Post API is enabled for this internal/private workflow.
- [ ] Private media handoff, caption/hashtags/CTA and commercial-content reminder are reviewed by the operator.
- [ ] `PUBLISHED` is recorded only after the operator confirms the native TikTok publication actually happened.

## YouTube progressive enablement

Follow the implementation-plan order: private/test upload before public automation.

- [ ] OAuth credential has the minimum required upload scope and belongs to the intended channel.
- [ ] Account health check resolves the expected channel identity.
- [ ] Private/test resumable upload is completed first.
- [ ] Resume/status behavior is verified using the existing resumable session rather than duplicate upload.
- [ ] Public/unlisted capability remains fail-closed until the required audit/capability is proven.
- [ ] Native scheduling capability is proven before using `publishAt`.
- [ ] First public canary is reviewed in YouTube Studio and canonical state reconciles to the exact remote video ID.

## Instagram progressive enablement

- [ ] The target account is an eligible professional account with current publishing capability.
- [ ] Required Meta permissions/app-review state is re-checked at activation time.
- [ ] Content publishing limit/quota preflight succeeds.
- [ ] The short-lived exact-asset delivery lease is reachable by Meta only for the intended window.
- [ ] Container processing reaches documented readiness before `media_publish`.
- [ ] An ambiguous `media_publish` result is routed to `PUBLISHING_UNKNOWN`, never blind retry.
- [ ] First controlled canary is inspected on Instagram and reconciled to the exact remote media ID/permalink when available.

## After each canary

- [ ] Compare local Publication/Attempt/AuditEvent state with the remote provider result.
- [ ] Verify no secret material appeared in jobs, logs or UI responses.
- [ ] Verify account health remained `ACTIVE`; handle explicit auth loss as `REAUTH_REQUIRED`.
- [ ] Verify Needs Attention surfaces any ambiguity/failure.
- [ ] Re-enable `PAUSE_ALL_PUBLISHING=true` if any invariant cannot be proven.

Activation remains progressive. Passing this checklist for one provider/account does not implicitly
authorize another provider/account or YouTube public publishing.
