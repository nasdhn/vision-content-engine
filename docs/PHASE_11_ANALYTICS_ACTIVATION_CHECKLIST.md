# Phase 11 — Analytics Activation & Retention Checklist

**Status:** future activation checklist only. Phase 8 closure does not authorize or perform live
provider analytics activation.

Use this checklist immediately before progressively enabling real analytics collection for a
specific provider/account/environment. Re-check provider policy, metric semantics, permissions,
retention and deletion requirements at activation time rather than relying on implementation-time
assumptions.

## Global gates

- [ ] Phase 8 is closed on a known commit with `pnpm check:phase8` green.
- [ ] The target environment has reviewed secret storage, rotation, logging and incident procedures.
- [ ] Current provider terms, permissions, quotas, metric semantics and retention/deletion rules have been re-verified.
- [ ] No provider credential, API token, HMAC secret or resolved secret value exists in Git, browser code, BullMQ payloads or canonical public metadata.
- [ ] The target `PlatformAccount` is the intended account and its capability/auth state is current.
- [ ] A deterministic fake-provider regression remains green before the first live call.
- [ ] Raw retention, normalized retention, diagnostics retention and opaque session/user retention are explicitly documented for the source.
- [ ] Required provider/user deletion can be executed without mutating immutable raw evidence in place.
- [ ] Operational rollback is explicit and can disable the provider without deleting canonical evidence.
- [ ] Needs Attention / Analytics read surfaces are available to inspect failures and stale evidence.

## Runtime activation gate

Phase 8 intentionally keeps:

```text
VCE_REAL_PROVIDERS_ENABLED=false
```

The accepted runtime parser still fails closed if `true` is supplied.

Before any live provider collection:

- [ ] introduce a separate reviewed activation change rather than bypassing the parser;
- [ ] activate one provider/account at a time;
- [ ] keep queue payloads secret-free;
- [ ] run a no-side-effect readiness/capability check first;
- [ ] prove collection identity/idempotence using the existing `collectionOperationId`;
- [ ] verify a live canary writes raw evidence before/atomically with normalization;
- [ ] verify unavailable data remains `NULL` and explicit zero remains `0`;
- [ ] verify provider schema/semantic drift fails closed.

## YouTube Analytics

- [ ] OAuth credential belongs to the intended channel/account and uses only the required analytics access.
- [ ] `reports.query` response mapping is still valid for the configured fields and is interpreted from response headers.
- [ ] Current YouTube policy for authorized-data retention, authorization revalidation and deletion has been re-checked.
- [ ] The implemented authorization/video-existence compliance hook is enabled and tested against the current required cadence.
- [ ] Early collection windows are allowed to return `NOT_YET_AVAILABLE`/`NULL`.
- [ ] No unsupported YouTube-derived composite score/rate is introduced by activation.
- [ ] First live canary reconciles to the intended `Publication`/remote video.

## Instagram Analytics

- [ ] The target account is an eligible owned Professional account.
- [ ] Current Meta app permissions/review status required for media insights are verified.
- [ ] The exact metric profile supplied to the adapter has been checked against current provider names, units and availability.
- [ ] Current Meta retention/deletion requirements for the configured integration are documented and accepted.
- [ ] Capability/media ownership checks pass before credentials or HTTP collection are used.
- [ ] Provider schema drift, unsupported metrics and auth/capability failures fail closed.
- [ ] First live canary reconciles to the intended `Publication`/remote media.

## TikTok

- [ ] TikTok Analytics remains `MANUAL_ENTRY` for V1.
- [ ] No scraping is added to simulate unsupported API access.
- [ ] Manual prompts remain bounded to the versioned collection windows.
- [ ] Empty fields persist as `NULL`; an explicitly observed zero persists as `0`.
- [ ] Overdue manual prompts continue to surface through Needs Attention rather than silent fabrication.

## Umami

- [ ] The configured Umami website ID is the intended Vision site/property.
- [ ] Access uses the supported Umami API; there is no direct Umami database coupling.
- [ ] The server-side Bearer credential is stored outside Git/browser/jobs.
- [ ] Import windows and pagination ceilings are bounded and fail closed rather than silently truncating.
- [ ] Umami event IDs remain stable external identities for idempotent import.
- [ ] `utm_content`/tracking-code direct attribution is verified on a controlled canary.
- [ ] Temporal inference, if enabled, has an explicit bounded policy and never overrides an unresolved explicit tracking code.
- [ ] Suspicious traffic is retained as evidence unless an explicit auditable exclusion policy is introduced.

## Vision signed attribution ingest

- [ ] HTTPS is enforced on the service-to-service path.
- [ ] `VCE_VISION_ATTRIBUTION_INGEST_SECRET` is generated/stored server-side and is not exposed to the browser.
- [ ] Secret rotation procedure is documented for both producer and Content Engine.
- [ ] Producer and receiver clocks are monitored closely enough for the bounded replay window.
- [ ] Signature covers the exact timestamp plus exact raw request bytes using the frozen signing contract.
- [ ] Invalid signature/timestamp creates no `AttributionEvent`.
- [ ] Duplicate `externalEventId` is rejected/fenced under concurrent delivery.
- [ ] REVENUE producer sends non-negative safe integer minor units plus explicit currency.
- [ ] PII is not added merely for attribution convenience.

## After each live canary

- [ ] Compare remote/provider evidence with `MetricSnapshotRaw`, normalized snapshot and read model.
- [ ] Verify no secret material appeared in queue payloads, logs or API/browser responses.
- [ ] Verify `NULL`/zero semantics remained intact.
- [ ] Verify exact publication/account lineage.
- [ ] Verify duplicate delivery does not create duplicate raw/business evidence.
- [ ] Verify failures appear as data-quality/operational states rather than metric values.
- [ ] Disable the provider immediately if provenance, policy or metric semantics cannot be proven.

Passing this checklist for one source/account does not authorize another source/account.

## Phase 9 handoff

Provider activation is not a Phase 9 prerequisite for implementation of the learning architecture,
but any Phase 9 claim must retain Phase 8 provenance, uncertainty, source authority and attribution
confidence.

Phase 9 may reason over evidence; it may not retroactively rewrite Phase 8 raw observations or
silently convert `INFERRED`/`UNKNOWN` into `DIRECT`.
