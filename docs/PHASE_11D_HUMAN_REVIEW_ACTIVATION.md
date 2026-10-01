# Phase 11D — Human Review Progressive Activation

**Status:** 11D-1 COMPLETE — existing Human Review boundary frozen; durable human-decision canary NOT STARTED.

Phase 11D is the fourth progressive production-enablement step.

The Human Review implementation already exists and is wired into the local
authenticated API. 11D-1 freezes its safety and decision boundary before a
durable end-to-end human decision is exercised.

## 11D-1 — Human Review safety boundary

A Render can be acted on by Human Review only when it is
`READY_FOR_REVIEW`.

The review surface resolves the canonical Render lineage server-side and
requires:

- a successful RenderAttempt;
- Creative QA `PASS` or `PASS_WITH_WARNINGS`;
- Technical QA `PASS`;
- a READY private Render output Asset;
- exact RenderAttempt → Asset lineage;
- checksum and size verification before serving private media;
- authenticated local human session;
- CSRF protection for decisions;
- server-resolved approval Asset identity;
- a structured reason code for rejection.

The client cannot select or substitute the Asset that becomes approved.

Approval persists:

- one human Approval;
- Render status `APPROVED`;
- the exact latest eligible output Asset as `approvedAssetId`.

Rejection persists:

- one human Approval decision with `REJECTED`;
- a required structured rejection reason;
- optional human comment;
- Render status `REJECTED`;
- no approved Asset.

Neither approval nor rejection creates a Publication.

Human Review therefore remains a hard gate before Distribution.

## Private-media boundary

The review API does not expose private S3 object keys or bucket identifiers.

Media is resolved from canonical Render lineage, fetched from private
storage, bounded by capacity limits and verified against the persisted
SHA-256 and exact byte size before it is returned.

Review media uses private/no-store HTTP semantics and supports bounded byte
ranges for the video player.

## Existing UI

The existing `Review finale` UI already supports:

- review queue;
- exact rendered master playback;
- Creative QA evidence;
- Technical QA evidence;
- timed issue navigation;
- structured rejection;
- human comment;
- final approval;
- authenticated deep links;
- mobile layout.

11D-1 does not introduce a new mandatory review UI or duplicate the
existing implementation.

## Safety

11D-1 performs no external provider call.

It does not:

- invoke Generation;
- run Product Capture;
- run Rendering;
- invoke a real Creative QA provider;
- create a Publication;
- activate TikTok manual handoff;
- activate Instagram or YouTube publishing;
- collect Analytics;
- incur provider cost.

Publishing remains a later Phase 11 step.

## Known boundary

11D-1 freezes the Human Review gate once a canonical Render has reached
`READY_FOR_REVIEW`.

It does not claim that a production Render has automatically traversed the
full `CREATIVE_QA -> READY_FOR_REVIEW -> human decision` path in one durable
canary.

That durable transition and exact human decision will be exercised
separately in 11D-2 without publication.

Phase status:

- Generation activation: DONE
- Capture activation evidence: DONE
- Rendering activation evidence: DONE
- 11D-1 Human Review safety boundary: DONE
- reviewed durable Human Review canary: NOT STARTED
- TikTok manual handoff activation: NOT STARTED
