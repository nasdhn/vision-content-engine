# Phase 11D — Human Review Progressive Activation

**Status:** COMPLETE — durable Human Review path validated; publishing remains disabled.

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
- 11D-2A disposable Human Review execution command: DONE
- reviewed durable Human Review canary: DONE
- Human Review activation: DONE
- TikTok manual handoff activation: NOT STARTED

## 11D-2A — explicit disposable Human Review approval command

11D-2A adds a separate reviewed execution command for exactly one
disposable LOCAL Human Review approval canary.

The command requires the exact human confirmation:

`APPROVE_DISPOSABLE_HUMAN_REVIEW_CANARY`

The canary uses only:

- disposable LOCAL PostgreSQL;
- disposable LOCAL private S3;
- a deterministic local private master;
- a deterministic zero-cost Creative QA fixture;
- canonical `applyCreativeQa`;
- canonical `RenderReviewService`;
- a USER actor for the final approval.

It exercises:

`CREATIVE_QA -> READY_FOR_REVIEW -> private media verification -> APPROVED`

The deterministic Creative QA fixture exists only to prove the persistence
transition into the Human Review gate. No real Creative QA provider is
called and no provider cost is incurred.

The final approval remains an explicit human-authorized action. The client
does not choose the approved Asset; Human Review resolves the exact eligible
Asset from canonical Render lineage.

The canary asserts that Publication count is zero both before and after the
human decision.

It does not invoke Capture, Rendering, Analytics, Distribution or any
publishing adapter.

All persistent work classes remain paused and real providers remain disabled.

The 11D-2A closure gate never executes the approval canary.

Code closure does not claim that the reviewed durable Human Review canary
has run.

## Reviewed durable Human Review canary

Executed successfully on 2026-10-01.

Observed durable transition:

`CREATIVE_QA -> READY_FOR_REVIEW -> APPROVED`

Verified:

- review queue contained the exact Render;
- decision was allowed only at `READY_FOR_REVIEW`;
- private master was read successfully;
- persisted SHA-256 matched the private master;
- exact canonical output Asset was approved;
- human Approval was persisted;
- final Render status was `APPROVED`;
- Publication count remained exactly `0`;
- publishing adapter was not invoked;
- Capture was not invoked;
- Renderer was not invoked;
- Analytics was not invoked;
- real Creative QA provider was not invoked;
- external provider cost was `USD 0`;
- remote side effect was `false`.

Fixture master:

- size: `2911` bytes;
- SHA-256:
  `fb09272d15d9c1961c7d5fe9a5857c38c834ce40822959efc2217ddc55a8630c`;
- canvas: `1080x1920`;
- duration: `400 ms`;
- frame rate: `30 fps`.

The synthetic master was used only to validate Human Review mechanics.
Creative video quality will now be validated using real content rather than
additional synthetic canaries.

Phase 11D Human Review is complete.

Next product milestone: produce one real end-to-end Vision video and improve
the resulting edit until it is genuinely publishable.
