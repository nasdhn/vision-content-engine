# 10 — Dashboard UX

**Status:** ACCEPTED  
**Specification version:** spec-v0.11  
**Scope:** Vision Content Engine V1  
**Depends on:** Product Capture / Playwright ACCEPTED  
**Accepted:** 2026-09-18

---

# 1. Purpose

The dashboard is the human control surface of the Vision Content Engine.

The user should act as:

```text
creative director
+ final reviewer
+ operator of exceptional cases
```

not as:

```text
project manager
+ editor
+ scheduler
+ retry operator
+ asset librarian
```

The interface must expose enough control to trust the system without forcing the user to manually shepherd every workflow state.

---

# 2. Primary UX principle

The interface optimizes for:

```text
few high-value decisions
+ clear state
+ fast review
+ obvious exceptions
```

not:

```text
maximum configuration
+ one screen per entity
+ one click per workflow transition
```

The two mandatory human gates remain:

1. Concept review.
2. Final Render review.

Everything else is automated by default unless blocked.

---

# 3. V1 audience

V1 is internal and single-user.

Therefore V1 does not need:

```text
organization switcher
roles/permissions UI
team mentions
comments
approval routing
billing UI
multi-brand switcher
```

The design should not make later multi-user support impossible, but must not pay UX complexity for it now.

---

# 4. Navigation

Primary navigation:

```text
Dashboard
Ideas & Campaigns
Concepts
Production
Review
Calendar
Published
Analytics
Assets
Templates
Settings
```

Global utility:

```text
Needs Attention
global search
system health indicator
```

`Review` and `Needs Attention` receive stronger visual priority than configuration pages.

---

# 5. Dashboard home

Purpose:

```text
What needs my attention?
What is happening?
What shipped?
What is working?
```

Core modules:

```text
Needs Attention
Concepts awaiting review
Final videos awaiting review
Currently producing
Scheduled today / next 7 days
Recently published
Top current signals
System warnings
```

Do not make vanity metrics the primary dashboard.

---

# 6. Needs Attention

`Needs Attention` is a derived operational view, not a workflow enum.

Sources include:

```text
Publication.PUBLISHING_UNKNOWN
PlatformAccount.REAUTH_REQUIRED
failed outbox events
failed render/capture attempts
blocked WorkflowRun
missing required recording
schema-invalid AI output after retry budget
permanent platform rejection
```

Each item shows:

```text
what is blocked
why
affected content
recommended operator action
safe retry/reconcile action if available
```

---

# 7. Campaign / Brief screen

The user can create a weekly or ad-hoc Brief.

Fields:

```text
campaign
brief title
goal
audience
topics
product area/use case
things to mention
things to avoid
target platforms
target concept count
notes
```

The screen should feel like giving strategic direction, not filling a database form.

Advanced fields can remain collapsed.

---

# 8. Brief lifecycle UX

Primary actions:

```text
Save draft
Generate concepts
Archive
```

When generation is running:

```text
status visible
progress summary
no duplicate Generate action
```

Historical BriefVersions are inspectable but not prominent.

---

# 9. Ideas

Ideas can be:

```text
manually added
brief-derived
performance-derived
future research-derived
```

V1 Idea management should support:

```text
title
short description
source
status
linked concepts
```

Do not require the user to curate every Idea before concept generation.

---

# 10. Concepts screen

Concepts are optimized for batch review.

Default card shows:

```text
hook
angle
pattern
format
target duration
hypothesis
why this could fit Vision
similarity/fatigue warning if relevant
```

The user should be able to understand the concept without opening five nested panels.

---

# 11. Concept review actions

Primary:

```text
APPROVE
REJECT
```

Secondary:

```text
Edit
Regenerate variant
Open details
```

Batch actions:

```text
Approve selected
Reject selected
```

Structured rejection reasons should be available but not mandatory for every rejection.

Examples:

```text
HOOK_WEAK
ANGLE_TOO_GENERIC
TOO_AD_LIKE
TOO_REPETITIVE
NOT_TRUE_TO_VISION
WRONG_AUDIENCE
OTHER
```

---

# 12. Concept approval semantics

The UI makes it clear that approval applies to the **specific ConceptVersion** shown.

If the concept is edited after approval:

```text
new version
→ approval no longer applies automatically
```

The user should not need to understand database versioning terminology to use this safely.

---

# 13. No mandatory script review screen

Script is editable, but it is **not** an additional mandatory gate.

From Concept detail / Production, user can inspect or edit:

```text
script
CTA
creative plan
recording instructions
```

But normal flow continues automatically after concept approval.

---

# 14. Production screen

Purpose:

```text
show what is currently being produced
show what is waiting for human input
show what failed
```

Views:

```text
All
Waiting for me
Capturing
Editing
Rendering
Failed
Done
```

Avoid exposing raw queue mechanics by default.

---

# 15. Production item summary

Shows:

```text
concept/hook
current stage
current state
next expected action
elapsed time
required human recording status
capture status
render status
```

Technical IDs available in expandable diagnostics only.

---

# 16. Recording Pack

When human media is required, the user gets a compact Recording Pack.

For each RecordingRequest:

```text
what to record
exact line/text
target duration
framing
presenter position
gesture direction
background
example visual layout
```

The user records raw material, not a finished TikTok.

---

# 17. Recording upload UX

Support:

```text
drag/drop
file picker
mobile handoff later if needed
multiple takes
```

For each take:

```text
preview
duration
basic technical validation
select/reject
```

Default behavior may auto-select the best valid take, while still allowing override.

---

# 18. Recording quality feedback

After upload, show useful technical feedback:

```text
audio missing
too short
too long
wrong orientation
green-screen quality warning
file unreadable
```

Do not pretend subjective creative quality is deterministic when it is not.

---

# 19. Capture visibility

Product capture is normally automatic.

Production details may show:

```text
scenario
status
captured outputs
marked moments
warnings
```

The user should not have to operate Playwright manually.

---

# 20. Render progress

Render card shows:

```text
Queued
Rendering
Technical QA
Creative QA
Ready for review
Failed
```

Do not expose low-level worker/job states unless diagnostics are opened.

---

# 21. Review screen is the most important screen

Default landing behavior should strongly surface final renders awaiting review.

Each review item shows:

```text
large vertical video player
hook
concept summary
script
CTA
target platforms
Creative QA summary
warnings
```

The video remains visually dominant.

---

# 22. Review actions

Primary:

```text
APPROVE
REJECT
```

Secondary:

```text
Regenerate edit
Edit script
Change CTA
Open production details
```

Batch approval is allowed when the user has actively selected items.

No automatic batch approval by default.

---

# 23. Rejection reasons

Structured render rejection reasons:

```text
PACING_TOO_SLOW
PACING_TOO_FAST
CUTS_TOO_MECHANICAL
CAPTIONS_TOO_BUSY
PRODUCT_NOT_VISIBLE_ENOUGH
HOOK_VISUALLY_WEAK
SOUND_TOO_BUSY
CTA_TOO_LONG
GREEN_SCREEN_BAD_PLACEMENT
SCRIPT_VISUAL_MISMATCH
OTHER
```

Optional free-text note.

The selected reason guides minimal-scope repair.

---

# 24. Regenerate semantics

`Regenerate edit` does not imply full pipeline regeneration.

Default mapping:

```text
editing issue
→ new EditingPlanVersion
→ new Render
```

Script/strategy only changes when user explicitly asks.

---

# 25. Approval to publication

After final Render approval:

```text
create/complete Publication intents
resolve mediaAssetId
schedule according to calendar policy
publish automatically at due time
```

The review screen shows the planned publication outcome before approval:

```text
TikTok — tomorrow 09:30
Instagram — tomorrow 12:00
YouTube — tomorrow 18:00
```

when schedules are already resolved.

---

# 26. Calendar

Calendar is publication-centric.

Views:

```text
Week
Month
List
```

Each event shows:

```text
thumbnail
platform
scheduled time
status
```

Drag/reschedule may be supported before publication.

Published items remain historical and are not silently moved.

---

# 27. Scheduling UX

The user may:

```text
accept automatic slot
move publication
pause publication
cancel before publish
```

The UI should make platform timezone explicit.

Canonical scheduling still lives in `Publication.scheduledAt`.

---

# 28. Published

Published screen provides a clean content history.

Card/table data:

```text
thumbnail
hook/title
platform
publishedAt
remote status
initial metrics
latest normalized metrics
site/sign-up signals when available
```

Remote URL opens in new tab.

---

# 29. Publication uncertainty

`PUBLISHING_UNKNOWN` must be visually distinct from both:

```text
PUBLISHED
FAILED
```

Operator actions:

```text
Reconcile now
Open diagnostics
```

Never show a normal Retry button before reconciliation confirms absence.

---

# 30. Analytics screen

Analytics answers:

```text
What is working?
What is merely getting views?
What should we test next?
```

Default sections:

```text
business funnel signals
content performance
platform breakdown
patterns
formats
editing dimensions
experiments
Insights
Recommendations
```

---

# 31. Analytics confidence language

Insights visibly use:

```text
Données insuffisantes
Signal faible
Signal intéressant
Assez solide
```

Do not visually imply certainty through rankings/green badges when evidence is weak.

---

# 32. Analytics metric semantics

Unknown metrics display as:

```text
—
Unavailable
Not reported
```

not:

```text
0
```

Comparability warnings appear where platform definitions differ.

---

# 33. Business funnel

When available:

```text
publication
→ website visit
→ signup
→ activation
→ customer
```

Direct and inferred attribution are visually distinguished.

Do not merge inferred attribution into deterministic totals without labeling.

---

# 34. Experiment view

Experiment view shows:

```text
hypothesis
what changed
what stayed constant
arms
measurement window
primary metric
current evidence
limitations
```

Avoid winner badges before the evidence policy supports a conclusion.

---

# 35. Assets

Asset library is primarily operational/supporting.

Filters:

```text
recordings
product captures
images
audio
renders
template assets
```

Show:

```text
preview
source
createdAt
usage/lineage
technical metadata
status
```

Do not encourage manual file management for normal workflow.

---

# 36. Asset lineage

From an Asset, user can inspect:

```text
where it came from
which content uses it
which render uses it
which publication uploaded it
```

Deletion controls respect historical Restrict/archive semantics.

---

# 37. Templates

Templates screen shows:

```text
family
current version
status
preview
supported slots
compatible profiles
last changed
```

Normal user flow does not directly edit raw JSON.

V1 template changes remain developer/operator-oriented.

---

# 38. Pattern Library UX

Pattern page shows:

```text
name
category
mechanism
when to use
when not to use
failure modes
recent usage
contextual evidence
current version
status
```

No universal leaderboard.

---

# 39. Settings

V1 Settings sections:

```text
Vision knowledge
AI providers/models
platform accounts
publishing schedule rules
capture environment
storage
cost limits
retention
system
```

Secrets are never displayed after creation beyond masked/reference state.

---

# 40. Vision Knowledge UX

User can inspect/edit current Brand/Product Knowledge.

Before changes become active:

```text
validate
preview changed claims
create new Knowledge Snapshot
```

Historical snapshots remain inspectable.

---

# 41. Platform account UX

For TikTok/Instagram/YouTube:

```text
account
status
last successful publish
token/auth health
capabilities
reauth action
```

`REAUTH_REQUIRED` surfaces in Needs Attention.

---

# 42. Search

Global search may find:

```text
concept
publication
campaign
asset
render
```

Search is operational convenience, not required for every entity in first implementation phase.

---

# 43. Deep links

Important objects have stable dashboard URLs:

```text
/campaigns/:id
/concepts/:id
/production/:id
/review/:renderId
/publications/:id
/assets/:id
```

Refreshing a page must preserve the intended object context.

---

# 44. Notifications

V1 prioritizes in-app notifications/status.

Potential events:

```text
concepts ready for review
recording needed
renders ready for review
publication auth failure
publishing unknown
weekly report ready
```

Email/push are not required V1 unless later useful.

---

# 45. Empty states

Empty states explain the next meaningful action.

Examples:

```text
No concepts awaiting review.
Your approved concepts are being produced.
```

not generic:

```text
No data.
```

---

# 46. Loading states

Use meaningful stage labels instead of indefinite generic spinners.

Example:

```text
Generating concepts…
Preparing product capture…
Rendering video…
Running technical checks…
```

Long-running work is async; leaving the page does not cancel it.

---

# 47. Error states

User-facing errors contain:

```text
what failed
whether content is safe
whether retry/reconcile is safe
recommended next action
```

Technical diagnostic details are expandable.

Do not dump raw stack traces into normal UI.

---

# 48. Optimistic UI

Use optimistic behavior only where the action is locally reversible and remote side effects are not ambiguous.

Do not optimistically mark:

```text
publication as published
render as approved
remote deletion
```

before canonical confirmation.

---

# 49. Accessibility

Internal tool still follows basic accessibility:

```text
keyboard reachable actions
visible focus
semantic buttons/labels
sufficient contrast
captions for video
not color-only status
```

This also improves automated testing and Playwright stability.

---

# 50. Responsive scope

Primary V1 dashboard is desktop-first.

Minimum mobile/tablet use cases:

```text
review video
approve/reject
view recording instructions
upload recording
inspect Needs Attention
```

Complex template/configuration screens may remain desktop-oriented.

---

# 51. Video review player

The review player should support:

```text
play/pause
scrub
mute/volume
captions on/off
frame/time display where useful
fullscreen
```

Creative QA issues with timestamps should jump to the relevant moment.

---

# 52. Side-by-side comparison

When regenerating an edit, review can optionally compare:

```text
previous render
vs
new render
```

Useful for pacing/caption/layout repairs.

Not required for first narrow implementation if expensive, but architecture/UX should permit it.

---

# 53. Keyboard review

Recommended desktop shortcuts:

```text
Space      play/pause
A          approve
R          reject
← / →      seek
J / K      previous/next item
```

Destructive/approval shortcuts require clear focus and may use confirmation safeguards.

---

# 54. Review queue ordering

Default:

```text
oldest ready first
```

Allow optional priority/campaign grouping.

Do not rank final review purely by AI confidence.

---

# 55. Automatic refresh

Long-running views may update through polling/SSE later.

UX requirement:

```text
state updates without full page reload
```

The transport is implementation detail.

---

# 56. Audit visibility

Important user actions show lightweight history:

```text
approved by
rejected by
when
reason
version
```

For V1 single-user, actor usually resolves to the user/system.

---

# 57. Cost visibility

Dashboard may show:

```text
today
this week
per content item
AI
render
provider/live capture
```

Cost warnings should be actionable, not noisy.

---

# 58. System health

Settings/System or dashboard indicator:

```text
API
DB
Redis/queues
object storage
render workers
capture workers
publishing auth
analytics freshness
```

Do not turn the main dashboard into infrastructure monitoring.

---

# 59. V1 visual direction

The tool should feel:

```text
calm
professional
media-first
high information density without clutter
```

Review video and content state matter more than decorative dashboard chrome.

---

# 60. V1 anti-patterns

Avoid:

```text
mandatory script approval
mandatory CreativePlan approval
raw queue dashboards as primary UX
modal for every transition
one settings field per internal config
showing database IDs everywhere
vanity views as dashboard headline
unlabeled inferred attribution
zero for unavailable metrics
retry button on PUBLISHING_UNKNOWN
editing JSON by hand for normal tasks
forcing desktop for simple approval/upload
```

---

# 61. Screen contracts

V1 primary routes:

```text
/
 /campaigns
 /campaigns/:id
 /concepts
 /concepts/:id
 /production
 /production/:id
 /review
 /review/:renderId
 /calendar
 /published
 /publications/:id
 /analytics
 /assets
 /assets/:id
 /patterns
 /templates
 /settings
 /attention
```

Exact React routing library details are implementation decisions.

---

# 62. Dashboard implementation phases

Recommended order:

```text
1. shell + nav + Needs Attention
2. Concepts review
3. Production + Recording Pack
4. Final Review
5. Calendar / Published
6. Analytics
7. Assets / Patterns / Templates
8. Settings / system support
```

This prioritizes the human gates before secondary administration.

---

# 63. Acceptance checklist

- [x] navigation accepted.
- [x] dashboard home accepted.
- [x] Needs Attention accepted.
- [x] campaign/brief UX accepted.
- [x] Ideas/Concepts UX accepted.
- [x] concept batch-review accepted.
- [x] no mandatory script review accepted.
- [x] Production UX accepted.
- [x] Recording Pack/upload UX accepted.
- [x] final Review UX accepted.
- [x] structured rejection/repair UX accepted.
- [x] Calendar/scheduling UX accepted.
- [x] Published/publication-uncertainty UX accepted.
- [x] Analytics confidence/null semantics accepted.
- [x] Asset lineage UX accepted.
- [x] Pattern/Template/Settings UX accepted.
- [x] desktop-first responsive scope accepted.
- [x] async/loading/error behavior accepted.
- [x] accessibility baseline accepted.
- [x] implementation ordering accepted.

Historical spec-sequencing note — completed:

1. freeze this specification;
2. generate screen/action spec artifacts;
3. update Decisions/Status/Checklist;
4. proceed to Distribution.
