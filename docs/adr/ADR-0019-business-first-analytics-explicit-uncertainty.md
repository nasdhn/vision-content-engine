# ADR-0019 — Business-first analytics with explicit uncertainty

## Status
Accepted

## Decision
Analytics is split into immutable raw observations, normalized metric snapshots and attribution events.

Metric semantics stay platform-aware, unavailable values remain NULL, and cumulative performance is compared at comparable content ages.

Business attribution uses DIRECT / INFERRED / UNKNOWN confidence. Vision signup/activation/customer/revenue events enter through a signed service boundary rather than direct database coupling.

TikTok V1 analytics is manual rather than scraped while API access remains unavailable/unapproved.

## Consequences
- platform changes can be re-normalized without rewriting history;
- business outcomes remain distinguishable from views;
- attribution uncertainty stays visible;
- weekly learning can inform experiments without automatic strategy mutation.
