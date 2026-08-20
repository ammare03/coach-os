# ARCHITECTURE-ESSENTIALS.md — CoachOS

> **The load-bearing walls.**
>
> `ARCHITECTURE.md` describes how CoachOS is put together. This file lists the parts of
> that architecture that are **not optional**: the ones whose absence either breaks the
> product outright, corrupts data, leaks something, or quietly makes the experience bad
> enough that a coach goes back to WhatsApp.
>
> This is the document to read when you are behind schedule and looking for something to
> cut. Everything in Tier 0 and Tier 1 is the wrong thing to cut. Several items here are
> *cheap to build now and near-impossible to retrofit* — those are marked ⏳ and are the
> real reason this file exists.

---

## E§0. How to use this file

Each entry has the same shape:

| Field | Meaning |
|---|---|
| **What** | The mechanism, in one line |
| **Without it** | The concrete failure — what a real user sees or what silently rots |
| **Minimum viable** | The smallest honest version. Not the ideal one. |
| **Built in** | Where in `.claude/plan/` it lands |
| **Verify** | How you know it is actually working, not just present |

**Tiers**

| Tier | Meaning | Rule |
|---|---|---|
| **0 — Structural** | Absence corrupts data, leaks data, or makes the app unshippable | Never ship without it. No exceptions, no "we'll add it after launch". |
| **1 — Core experience** | Absence breaks the loop the product exists for | Ship gate 1 is not passed without these |
| **2 — Quiet degradation** | Absence produces an app that works but feels bad | Fix before charging money |
| **3 — Scale-triggered** | Absence bites at a specific measurable threshold | Build when the number is hit, not before — but know the number |

**⏳ = retrofit-hostile.** Adding it later means a migration, a data backfill, or
reprocessing existing rows. Build these on the first pass.

---

# Tier 0 — Structural

Nine things. Every one of them can lose or leak a user's data.

---

### E§1 ⏳ Idempotency keys on every offline-writable mutation

**What.** `client_local_id` (UUIDv7, generated once on the device at the moment of the
user's action) sent with every offline-capable mutation, backed by a
`UNIQUE (owner, client_local_id)` index, upserted with `ON CONFLICT … DO UPDATE`.

**Without it.** A flaky gym connection produces duplicate sets, duplicate meals,
duplicate sessions. Volume totals, PRs, adherence, and every derived summary are wrong
— and wrong in a way the coach discovers by not trusting the numbers. There is no
after-the-fact repair: once two indistinguishable rows exist you cannot tell which was
the retry.

**Minimum viable.** The unique index. It is the whole mechanism; the rest is ergonomics.

**Built in.** `phase-01-data-layer/` (indexes) · `phase-08-offline-core/outbox/`

**Verify.** Flush the outbox twice concurrently and assert zero duplicate rows. This
test is named explicitly as the P08 exit gate — it is not a nice-to-have.

> **Why ⏳:** retrofitting means adding a column that is NULL for all historical rows,
> which makes the unique index unenforceable without a backfill you cannot compute.

---

### E§2 The `ownsResource` authorisation middleware

**What.** The third of three ordered middleware checks. A coach may only touch resources
where `client_profiles.coach_id` resolves to them (or to one of their assistants); a
client may only touch their own.

**Without it.** One unguarded procedure taking a `clientId` leaks another coach's
client's body metrics, progress photos, injuries, and food logs. This is the single most
likely catastrophic bug in the product, and it is a regulatory event under DPDP/GDPR, not
just an outage.

**Minimum viable.** The middleware plus the enumeration test. Not the middleware alone —
the middleware alone is one forgotten `.use()` away from a breach.

**Built in.** `phase-02-api-foundation/authorization-middleware/`

**Verify.** The enumeration test walks every registered procedure and fails the build if
one accepts a `clientId` without the guard. Adding a procedure to the allowlist requires
a written reason in the test file.

**Related failure to watch:** an unauthorised read must return `NOT_FOUND`, not
`FORBIDDEN`. `FORBIDDEN` confirms the resource exists, which is itself a leak.

---

### E§3 ⏳ Refresh-token rotation with reuse detection

**What.** Refresh tokens are single-use. Presenting one twice revokes the entire token
family and signs the user out.

**Without it.** A stolen refresh token grants indefinite access with no signal and no
revocation path. Combined with 30-day refresh lifetimes, one leaked token is a
permanent, invisible account compromise.

**Minimum viable.** A `refresh_tokens` row per issued token with a `replaced_by` chain
and a `revoked_at`. Rotation without detection is meaningfully weaker but still better
than static tokens.

**Built in.** `phase-03-identity-and-auth/auth-server/`

**Verify.** Use a refresh token, then replay the old one; assert the whole family is
revoked and the client is signed out.

---

### E§4 ⏳ Webhook idempotency ledger

**What.** A `webhook_events` table keyed on the provider's event ID, written before the
handler runs. RevenueCat webhooks are **neither ordered nor exactly-once**.

**Without it.** A redelivered `EXPIRATION` arriving after a `RENEWAL` downgrades a paying
coach. A duplicated `INITIAL_PURCHASE` double-counts. A replayed `REFUND` revokes
entitlement from someone who re-subscribed. All of these are billing incidents with real
users, and all of them are silent.

**Minimum viable.** Insert-first on the event ID with a unique constraint; on conflict,
acknowledge and do nothing. Plus: order-independent handlers that compute state from the
event's own timestamps rather than assuming arrival order.

**Built in.** `phase-20-billing-and-entitlements/webhooks-and-reconciliation/`

**Verify.** Replay a captured webhook payload ten times; assert one state change. Deliver
`EXPIRATION` then `RENEWAL` out of order; assert the coach ends up active.

---

### E§5 Foreground entitlement reconciliation

**What.** On every app foreground, the client asks the API to reconcile against
RevenueCat's REST API rather than trusting the local billing replica.

**Without it.** A single dropped webhook leaves a paying coach locked out of features
they paid for, or an expired coach with indefinite access. Webhooks *will* be dropped —
this is the self-healing mechanism, not a redundancy.

**Minimum viable.** Reconcile on foreground and on any entitlement-gated failure.

**Built in.** `phase-20-billing-and-entitlements/webhooks-and-reconciliation/`

**Verify.** Change the subscription in the RevenueCat dashboard with the webhook endpoint
deliberately unreachable; foreground the app; assert correct state within one cycle.

---

### E§6 Server-side entitlement enforcement on every gated write

**What.** The client caches entitlements to render UI. The server re-checks on every
gated action.

**Without it.** A patched or MITM'd app unlocks every paid feature. Given that our
entire revenue model is one boolean per feature, this is the difference between a
business and a free app.

**Minimum viable.** One `requireEntitlement(feature)` middleware, composed onto every
gated procedure, reading from Postgres (Redis-cached, but re-verified on writes).

**Built in.** `phase-20-billing-and-entitlements/entitlement-service/05-server-side-gate.md`

**Verify.** Call a Pro-only procedure with a hand-crafted request from a Starter account.
It must fail server-side, not client-side.

---

### E§7 No public access on the R2 bucket; signed URLs only

**What.** Zero public read on the bucket. Every media read is a signed URL with ≤1h TTL,
issued only after an authorisation check.

**Without it.** Progress photos — the most sensitive class of data in the product — are
enumerable by anyone who guesses or leaks a key. There is no undo for a leaked photo.

**Minimum viable.** Bucket policy locked, presign-on-read behind `ownsResource`, Redis
URL cache TTL (55m) strictly shorter than the signature TTL (1h).

**Built in.** `phase-11-media-pipeline/playback/`

**Verify.** Take a signed URL, strip the signature, request it — 403. Wait past the TTL
with the full URL — 403. Request another coach's client's asset — `NOT_FOUND`.

---

### E§8 ⏳ Transactional account deletion and purge order

**What.** A single ordered, transactional purge across all five schemas plus R2 objects,
required by both app stores and by DPDP/GDPR.

**Without it.** Deletion half-completes and leaves orphaned photos in R2, orphaned rows
that violate FKs, or — worst — a "deleted" account whose progress photos are still
retrievable. Also a hard store-review rejection.

**Minimum viable.** The DB§19.2 purge order executed in one transaction, R2 deletion
enqueued only after commit, an `audit_log` entry retained by ID only.

**Built in.** `phase-03-identity-and-auth/account-lifecycle/04-transactional-purge.md`

**Verify.** Purge a fully-populated fixture account and assert zero remaining rows in
every table and zero remaining objects under every R2 prefix.

---

### E§9 Migration safety discipline

**What.** Migrations are committed, never edited after being applied, expand-then-contract
for anything destructive, and never lock a hot table.

**Without it.** One `ALTER TABLE` that takes an `ACCESS EXCLUSIVE` lock on `set_logs`
during a deploy takes the entire product down mid-workout for every client
simultaneously. This is the one failure in `ARCHITECTURE.md` A§12 with no graceful
degradation.

**Minimum viable.** The `db-migrations` skill's rules, plus a rehearsal against a
production-sized copy for anything touching `set_logs`, `meals`, or `messages`.

**Built in.** `phase-01-data-layer/` and the `db-migrations` skill

**Verify.** Every migration reviewed for lock class before merge. Destructive changes ship
in two releases (add + backfill + read-both, then drop), never one.

---

# Tier 1 — Core experience

Without these the app runs, and the product does not work.

---

### E§10 ⏳ The outbox, with dependency ordering and bounded retry

**What.** A durable device-side mutation queue with `depends_on` ordering, exponential
backoff (1s→5min, 10 attempts), and a visible failure state.

**Without it.** The gym-basement case — the single most common context for the client
app — either blocks on the network or loses writes. A set log that vanishes is worse than
an app that refuses to open.

**Minimum viable.** The queue plus ordering. Backoff can start naive; **silent drop can
never be acceptable at any stage.**

**Built in.** `phase-08-offline-core/outbox/`

**Verify.** Log a full 60-minute session in airplane mode; reconnect; assert it appears
on the coach's dashboard within 30 seconds and is byte-identical to what was logged.

---

### E§11 Optimistic local writes with rollback

**What.** Every user action repaints from local state in <100ms and reconciles later; a
server rejection rolls back visibly and explains itself.

**Without it.** Set logging takes a network round-trip on gym wifi, which is 800ms–never.
The client stops logging mid-workout and starts logging from memory afterwards, which is
the exact behaviour the product exists to eliminate.

**Minimum viable.** Optimistic write + rollback on the logger and the comment composer.
Other surfaces can follow.

**Built in.** `phase-09-workout-logger/set-entry/` · `phase-12-feedback-comments/`

**Verify.** Log a set with the API returning 500. The UI must show the set, then visibly
un-show it with an explanation — not silently keep it, and not silently drop it.

---

### E§12 ⏳ Local calendar dates for training days

**What.** A training day is a `date` in the client's timezone, never a `timestamptz`
rendered in the server's zone.

**Without it.** A workout logged at 00:30 IST lands on the previous day. Adherence,
streaks, "today's session", weekly summaries, and check-in windows all go subtly wrong
for every client who trains late or travels — and the bug reads as "the app is just
wrong sometimes", which is unfixable in a user's mind.

**Minimum viable.** `date` columns for anything day-scoped, timezone stored on the
client profile, all day-boundary maths in `packages/utils` so both sides agree.

**Built in.** `phase-01-data-layer/` · `packages/utils`

**Verify.** Log a session at 23:55 and 00:05 local, in a non-UTC timezone, and confirm
they land on different days on the coach's dashboard. Then fly the fixture user across a
timezone and confirm history does not shift.

> **Why ⏳:** converting a `timestamptz` history to local dates after the fact requires
> knowing what timezone each row was created in, which you did not store.

---

### E§13 Rate limiting

**What.** Redis counters per route per user, applied *before* token verification, with a
separate stricter bucket for auth endpoints keyed by IP.

**Without it.** Auth endpoints are brute-forceable; a retry loop in a buggy client build
can DoS the single API container; and every Postgres connection is available to whoever
loops fastest. On a $0 infrastructure budget there is no headroom to absorb this.

**Minimum viable.** Auth throttle + a global per-user ceiling. Per-route tuning later.

**Built in.** `phase-02-api-foundation/rate-limiting/`

**Verify.** Hammer sign-in from one IP; assert lockout. Confirm the limiter's Redis
failure mode is **closed for auth, open for reads** — a Redis outage must not lock
everyone out of a workout.

---

### E§14 Entitlement caching in Redis

**What.** `entitlements:{coachId}` cached for 5 minutes.

**Without it.** Every gated action recomputes tier, seat count, storage usage, live
minutes, and AI generations from Postgres. On the coach dashboard — which touches
entitlement on nearly every surface — that is the difference between an 800ms load and a
3-second one, on the screen the coach opens most.

**Minimum viable.** The cache with explicit `DEL` on any entitlement-changing webhook.

**Built in.** `phase-20-billing-and-entitlements/entitlement-service/02-redis-cache.md`

**Verify.** Upgrade a coach; assert the UI limit moves within one TTL, and assert the
*access* check was never served from cache on a write path.

---

### E§15 Resumable uploads that survive app kill

**What.** Multipart upload with per-part progress persisted in the device `upload_queue`
table, resumable after backgrounding, app kill, or OS eviction.

**Without it.** A 90MB form-check video on gym wifi fails at 80% and restarts from zero.
Android kills background uploads aggressively (`CLAUDE.md` §25.6), so this is the default
outcome, not the edge case. Clients stop uploading videos — which kills the feature the
whole product is differentiated on.

**Minimum viable.** Multipart + persisted progress + resume on next foreground.

**Built in.** `phase-11-media-pipeline/upload-client/`

**Verify.** Kill the app mid-upload on a physical Android device; reopen; assert it
resumes from the last completed part rather than restarting.

---

### E§16 ⏳ Video orientation normalisation during transcode

**What.** ffmpeg normalises rotation metadata so every HLS output has a single, known
orientation.

**Without it.** iOS and Android disagree on capture orientation metadata. Annotations
drawn on a video render rotated 90° on one platform — which makes the flagship
differentiator visibly broken, and the fix requires re-transcoding every asset already
uploaded.

**Minimum viable.** Normalise on ingest. Always.

**Built in.** `phase-11-media-pipeline/transcode-worker/`

**Verify.** Capture the same movement on iOS and Android, upload both, draw an annotation
on each, and confirm identical placement on both platforms.

---

### E§17 Deep-link routing that resolves in all three app states

**What.** Every notification payload carries a typed deep link that lands on the exact
object, from cold start, from background, and from foreground.

**Without it.** A push saying "your coach commented on your squat" opens the home screen.
The feedback loop — the product's entire premise — takes a client five taps and a search
instead of one. Cold start is the case that is always broken and never tested.

**Minimum viable.** Typed link payloads, a route resolver, and a cold-start test for each
notification type.

**Built in.** `phase-05-app-shell/deep-linking/` · `phase-15-notifications/deep-link-routing/`

**Verify.** Force-quit the app, fire each notification type, and confirm the exact object
opens. Repeat backgrounded and foregrounded.

---

### E§18 Server-side quiet hours

**What.** Notification suppression evaluated at fanout time, in the recipient's timezone.

**Without it.** Clients get buzzed at 2am. They disable notifications at the OS level —
permanently — and then never receive coach feedback again. One bad night costs the
notification channel forever.

**Minimum viable.** Preference check + timezone-aware window at fanout, with deferred
delivery at window open rather than a drop.

**Built in.** `phase-15-notifications/preferences-and-quiet-hours/`

**Verify.** Set quiet hours, trigger a notification inside the window from a different
server timezone, and assert it is deferred rather than sent or lost.

---

### E§19 Designed loading, empty, error, and forbidden states

**What.** Four states per screen, designed, not defaulted.

**Without it.** The app spends its most-viewed moments — first launch, a new client with
no history, a failed request — showing a spinner or a blank box. Onboarding is where
every coach decides whether this product is real, and an undesigned empty state reads as
an unfinished product.

**Minimum viable.** The four states as shared primitives in `packages/ui`, so a screen
gets them by construction rather than by remembering.

**Built in.** `phase-04-design-system/screen-states/`

**Verify.** Every screen demonstrably renders all four in the component gallery.

---

# Tier 2 — Quiet degradation

The app works. It just isn't good, and nobody files a bug about it.

---

### E§20 Dashboard caching and denormalised `coach_id`

**What.** `dash:{coachId}` cached 60s; coach-addressable leaf tables carry a
denormalised `coach_id` set on INSERT.

**Without it.** The coach dashboard is a multi-table join across 100 clients on every
open. It exceeds the 800ms p75 budget, and it is the screen a coach opens twenty times a
day. Slowness here is the whole product's perceived speed.

**Built in.** `phase-10-coach-review-surfaces/coach-dashboard/` · `DATABASE.md` DB§6

**Verify.** 100-client fixture, cold cache, p75 under 800ms; warm cache under 200ms.

---

### E§21 FlashList with `estimatedItemSize` everywhere

**What.** Every long list is virtualised with a correct size estimate.

**Without it.** Scroll performance collapses on workout history, food diaries, and
message threads — the three longest lists in the app. `CLAUDE.md` §25.8 names this
specifically because a missing `estimatedItemSize` degrades silently on the developer's
iPhone and catastrophically on a mid-range Android.

**Verify.** ≥55fps on a Pixel 6a with a 500-item fixture.

---

### E§22 Media caching and `recyclingKey` on `expo-image`

**What.** Cached images with recycling keys on every list-rendered image.

**Without it.** Avatars and thumbnails re-download on every scroll, wrong images flash
into recycled cells, and mobile data usage becomes a complaint. Progress-photo grids are
the worst case and the most sensitive one to show wrong.

---

### E§23 WebSocket reconnect with backoff and state resync

**What.** Exponential reconnect, heartbeat, and a resync-on-reconnect that reconciles
missed messages from Postgres.

**Without it.** A backgrounded app returns to a dead socket that looks alive. Messages
appear to send and never arrive; typing indicators stick on forever. The durable path
saves the data, but the user's trust in the messaging surface is gone.

**Built in.** `phase-14-messaging-and-realtime/websocket-gateway/`

**Verify.** Background for 10 minutes, return, and assert the message list reconciles
without a manual pull-to-refresh.

---

### E§24 Undo toasts instead of confirm dialogs

**What.** Destructive actions apply immediately with a 5-second undo — except account
deletion and client archival, which confirm.

**Without it.** Every delete costs two taps and a modal. In the logger, mid-set, with
chalked hands, that is the difference between a tool and an obstacle.

**Built in.** `phase-04-design-system/` · applied per feature

---

### E§25 Storage quota enforcement at presign time

**What.** Tier storage checked *before* the presigned URL is issued.

**Without it.** A coach exceeds their plan's storage and we pay for it. Because R2 egress
is free but storage is not, the failure is a slow monthly bleed rather than a spike —
which means nobody notices until the bill.

**Built in.** `phase-11-media-pipeline/retention-and-quota/`

---

### E§26 Retention sweeps that actually run

**What.** Scheduled deletion of media past its tier's retention window, and of `exports/`
past 7 days.

**Without it.** Storage grows monotonically. The tier table's retention promises (30 days
on Starter, 12 months on Coach) become fiction, and the unit-economics target of <12% of
net revenue quietly fails.

**Built in.** `phase-11-media-pipeline/retention-and-quota/` · `retention-sweep` queue

**Verify.** Fixture assets aged past their window are deleted from both Postgres and R2,
and the orphan sweep reports zero.

---

### E§27 Analytics guardrails

**What.** IDs and counts only. No PII, no health values, no food names, no media URLs, no
session recording — enforced at the event-emitter boundary, not by convention.

**Without it.** Sensitive data leaks into a third party by accident, in a way that is
invisible in code review and permanent once sent. The mitigation is a typed event API
that makes the wrong event fail to compile.

**Built in.** `phase-02-api-foundation/observability/` · `CLAUDE.md` §20

---

### E§28 Error taxonomy with actionable user-facing copy

**What.** A closed set of error codes, each mapped to one user-facing message and one
recovery action.

**Without it.** Users see "Something went wrong" for everything from an expired session
to a seat limit to a lost connection, and support has no way to distinguish them either.

**Built in.** `phase-02-api-foundation/error-and-validation/` · `api-conventions` skill

---

# Tier 3 — Scale-triggered

Do not build these now. Do know the number that triggers them.

| # | Mechanism | Trigger | Without it, at that point |
|---|---|---|---|
| **E§29** | Split the transcode worker onto its own host | ffmpeg CPU measurably raises API p95 | Every video upload degrades every user's request latency |
| **E§30** | Postgres connection pooling (PgBouncer or equivalent) | Concurrent API instances × pool size approaches Postgres `max_connections` | Requests fail with "too many connections" — an outage that looks like a database problem and is a configuration problem |
| **E§31** | Read replica for coach dashboards | Dashboard reads dominate primary CPU | Coach review blocks client logging — the worst possible coupling |
| **E§32** | Index review against `pg_stat_statements` | Any query over 100ms in production p95 | Sequential scans on `set_logs` grow linearly with the product's success |
| **E§33** | Self-hosted LiveKit SFU | LiveKit Cloud free minutes exceeded | A live-session bill with no revenue behind it |
| **E§34** | Materialised weekly summaries | Weekly report generation exceeds job budget | Reports time out for the coaches with the most clients — i.e. the best customers |
| **E§35** | Push token lifecycle cleanup | Dead-token rate above ~5% | Expo throttles or rejects the batch, degrading delivery for live users |
| **E§36** | Bundle splitting / lazy routes | Initial JS bundle approaches 3.5MB | Cold start exceeds 2.0s on a Pixel 6a — the first impression, every time |

---

# E§37. Cross-cutting essentials that have no phase of their own

These belong to no feature, which is exactly why they get forgotten.

| # | Essential | Without it |
|---|---|---|
| **a** | **Secrets never in the repo**, `EXPO_PUBLIC_` understood as public | A key in the shipped bundle. This has leaked keys at many companies (`CLAUDE.md` §25.4) |
| **b** | **Structured logging with request IDs**, correlated app→API→worker | A production bug is unreproducible and undiagnosable; you are debugging by guessing |
| **c** | **Sentry with source maps uploaded in the EAS build hook** | Crash reports are minified stack traces, which is the same as having no crash reporting |
| **d** | **Health check + readiness endpoint** | Fly restarts a container that was fine, or keeps routing to one that isn't |
| **e** | **Automated Postgres backups with a *tested restore*** | An untested backup is a belief, not a backup. Restore once before launch, on purpose |
| **f** | **A kill switch / remote config for the expensive features** (AI, live) | A cost spike can only be stopped by shipping a build, which takes a store review |
| **g** | **`pnpm check` as a merge gate in CI** | The one rule in `CLAUDE.md` that everything else depends on becomes advisory |
| **h** | **Dependency audit gate on high/critical** | A known CVE ships to devices and can only be fixed by a full release cycle |
| **i** | **A documented rollback path for OTA and for native builds** | The first bad release is discovered under pressure, with no plan |
| **j** | **Clock-skew tolerance on token expiry** | Devices with wrong clocks — common — get spurious sign-outs |

---

# E§38. The cut list

If time forces a decision, this is the order in which things may be deferred. Read it as
a commitment, not a suggestion.

**Never deferrable:** everything in Tier 0. E§10, E§11, E§12, E§16 from Tier 1.

**Deferrable with a written date:** E§13 tuning (keep the auth throttle), E§14, E§18
(keep a global mute), E§21, E§22, E§23 (keep the durable path), E§25, E§26.

**Deferrable indefinitely until measured:** all of Tier 3.

**The trap.** Everything marked ⏳ looks deferrable and is not, because deferring it does
not delay the work — it multiplies it by the number of rows already written. E§1, E§3,
E§4, E§8, E§10, E§12, and E§16 all fall into that category. If you defer exactly one
thing from this file and regret it, it will be one of those seven.

---

*Companion: `ARCHITECTURE.md` · Owner: Ammar · Last updated: 16 August 2026*
