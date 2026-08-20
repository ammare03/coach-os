# ANALYTICS.md — CoachOS

> **The event dictionary. One row per event, one shape per event, enforced by types.**
>
> `CLAUDE.md` §20 owns the *policy* — the naming rule, the north star metric, and the
> privacy guardrails. This file owns the *contract*: every event we send, every property
> it carries, where it fires, and what it is for. If an event is not in this file, it does
> not exist. If it is in the code and not here, that is a bug in the same PR.
>
> **The guardrail in §20 is not a convention — it is a type.** Read §AN2 before adding
> anything.

---

## AN§0. Rules

1. **Naming:** `object_action`, snake_case, past tense. `set_logged`, not `logSet` or
   `SetLogged` or `log_set`.
2. **Every event is declared here first**, then in the typed registry, then emitted. Three
   places, in that order, in one PR.
3. **Properties are IDs, counts, enums, booleans, and durations.** Nothing else. See §AN2.
4. **No event fires more than once per user action.** If an event can double-fire on
   retry, it is wrong — dedupe at the emit site, not in PostHog.
5. **An event that nobody has committed to reading gets deleted.** Volume is the thing we
   control to stay on PostHog's free tier (`CLAUDE.md` §3.4.3); every event costs quota.
6. **Never block a user action on an emit.** Analytics are fire-and-forget, always.

---

## AN§1. The typed registry

The guardrail is enforced by making the wrong event fail to compile, not by review.

**Shape.** One discriminated union in `packages/schemas`, keyed by event name, mapping each
name to its exact property object. The emit function accepts only that union. There is no
`track(name: string, props: Record<string, unknown>)` escape hatch, and adding one is a
blocking review comment.

**Property value types are constrained at the type level** to the safe set: `string` is
**not** in it. Permitted property value types are:

| Type | Use for | Example |
|---|---|---|
| `Uuid` (branded string) | Any identifier | `client_id`, `session_id` |
| `number` | Counts, durations, sizes, percentages | `set_count`, `duration_ms` |
| `boolean` | Flags | `was_offline` |
| A named literal union | Closed vocabularies | `tier: 'starter' \| 'coach' \| 'pro' \| 'studio' \| 'agency'` |

A free-form `string` property is what lets a food name, an exercise name, a message body, or
a filename reach PostHog. **The type does not permit one.** If a new event seems to need
free text, it does not — it needs an enum, or it needs to not exist.

**Where it lives**

| Path | Responsibility |
|---|---|
| `packages/schemas/src/analytics/events.ts` | The event union — the single source of truth, mirroring this file |
| `packages/schemas/src/analytics/primitives.ts` | The permitted property value types |
| `apps/mobile/src/lib/analytics.ts` | The client emitter (PostHog RN), typed against the union |
| `apps/api/src/lib/analytics.ts` | The server emitter, typed against the same union |

Client and server import the **same** union. An event fired from both places has one
definition, not two that drift.

---

## AN§2. The privacy guardrail

`CLAUDE.md` §20 and `DATABASE.md` DB§18 both state it; this is the operational form.

### AN§2.1 Never, under any circumstance

| Category | Examples | Why |
|---|---|---|
| **Health values** | weight, body fat, circumferences, sleep, HR, calories, macros | DB§18 🔴/🟠. Special-category data under GDPR and DPDP. |
| **Food names or barcodes** | "chicken biryani", `8901234567890` | A food diary is a health record and, in several markets, a religious and cultural one. |
| **Free text authored by a user** | message bodies, comment text, coach notes, check-in answers, exercise notes | The single largest accidental-leak surface. |
| **Names, emails, phone numbers, handles** | anything from `users` or `coach_profiles` | Personal data with no analytical value we can't get from an ID. |
| **Media URLs, signed URLs, R2 keys, filenames** | `photos/{clientId}/…` | A signed URL in a third party's logs is a live credential. |
| **Anything derived from a progress photo** | dimensions, count in a comparison | DB§18 🔴. There is no safe projection of this. |
| **Precise location** | GPS, gym address, IP-derived city | We never collect it; do not start here. |

### AN§2.2 Also forbidden, less obviously

- **Session recording.** Not now, not behind a flag, not for a week. `CLAUDE.md` §20 is
  absolute on this and the mobile SDK's session-replay feature must remain disabled in
  config, verified in the release checklist.
- **Autocapture.** PostHog's automatic event capture must be **off** in the mobile SDK. It
  captures screen text, which defeats every rule above in one config default.
- **User properties beyond the permitted set.** The identified profile carries: user ID,
  role, tier, account age in days, platform, app version. Nothing else — no email, no name.
- **Group analytics keyed on anything but an ID.** A coach is `coach_id`, never a business
  name.

### AN§2.3 Consent and opt-out

- Respect the OS "limit ad tracking" / ATT signal: if denied, analytics run without any
  device identifier.
- An in-app **analytics opt-out** in settings (§20) suppresses all emission client-side and
  sets a flag the server emitter also honours. Opting out is immediate and permanent until
  reversed; there is no "essential analytics" carve-out that ignores it.
- Opt-out state is per-user, stored server-side so it survives re-install.

### AN§2.4 How this is verified, not just promised

| Check | Where |
|---|---|
| Type-level: no free-form `string` property is constructible | `packages/schemas` — compile-time |
| A test that asserts every event in the union appears in this file, and vice versa | `packages/schemas/src/analytics/events.test.ts` |
| A test that asserts autocapture and session replay are disabled in the SDK config | `apps/mobile` |
| Manual: capture a full session against a PostHog dev project and read **every** event payload before each release | `phase-22-release-engineering/e2e-and-release-qa/` |

The last one is the only check that catches a well-typed event carrying the wrong ID. Do it
once per release, by eye.

---

## AN§3. The event dictionary

Grouped by surface. **Every event carries the base properties in §AN3.0 implicitly** — they
are added by the emitter, never passed by the caller.

### AN§3.0 Base properties (automatic, every event)

| Property | Type | Notes |
|---|---|---|
| `user_id` | `Uuid` | The identified user |
| `role` | `'coach' \| 'client' \| 'assistant'` | |
| `platform` | `'ios' \| 'android' \| 'server'` | |
| `app_version` | `string` (semver, machine-generated) | The one permitted non-branded string, produced by the emitter, never by a caller |
| `is_offline_queued` | `boolean` | True if the event was buffered on-device and flushed later |

### AN§3.1 Training — the core loop

| Event | Fires when | Properties | Used for |
|---|---|---|---|
| `workout_started` | Client taps start on a session | `session_id`, `assignment_id`, `exercise_count`, `was_offline` | Funnel top for the core loop |
| `set_logged` | A set is committed locally | `session_id`, `exercise_id`, `set_number`, `is_warmup`, `had_rpe`, `was_offline`, `entry_ms` | Logging friction; `entry_ms` is the §19 <100ms budget in the field |
| `workout_completed` | Session marked complete | `session_id`, `set_count`, `duration_s`, `completion_pct`, `was_offline` | Loop completion rate |
| `workout_abandoned` | Session started, not completed, 24h elapsed | `session_id`, `set_count`, `last_activity_s` | The single best signal that the logger is in the way |
| `session_modified` | Client swaps/skips an exercise mid-session | `session_id`, `modification_type` | Program fit |
| `rest_timer_used` | Rest timer started | `session_id`, `duration_s`, `was_backgrounded` | Justifies the iOS background-audio entitlement |
| `personal_record_hit` | A PR is detected | `exercise_id`, `record_type` | Retention driver; never carries the value |

### AN§3.2 Nutrition

| Event | Fires when | Properties | Used for |
|---|---|---|---|
| `meal_logged` | A meal is committed | `meal_type`, `item_count`, `entry_method`, `was_offline` | |
| `barcode_scanned` | Scan resolves or fails | `resolved`, `source`, `duration_ms` | Open Food Facts hit rate — decides if we ever need a paid food API |
| `food_search_performed` | Search returns | `result_count`, `duration_ms`, `was_offline` | The §19 <400ms budget |
| `food_created` | User creates a custom food | `created_by_role` | Moderation load (see `TRUST-AND-SAFETY`) |

### AN§3.3 Feedback — the differentiator

| Event | Fires when | Properties | Used for |
|---|---|---|---|
| `form_check_uploaded` | Upload completes | `asset_id`, `duration_s`, `bytes`, `attempts`, `resumed` | Upload reliability; `resumed` proves E§15 works |
| `video_annotated` | An annotation is saved | `asset_id`, `annotation_count`, `has_voice_note` | **Ship gate 2's >40% metric** |
| `comment_created` | Comment posted | `target_type`, `is_reply`, `has_media`, `author_role` | The core loop's other half |
| `feedback_opened` | Client opens a coach comment | `target_type`, `seconds_since_created` | Feedback latency, both directions |

### AN§3.4 Check-ins and progress

| Event | Fires when | Properties | Used for |
|---|---|---|---|
| `checkin_submitted` | Client submits | `checkin_id`, `field_count`, `had_photos`, `days_late` | |
| `checkin_reviewed` | Coach reviews | `checkin_id`, `hours_to_review` | Coach responsiveness |
| `progress_photo_uploaded` | Upload completes | `angle` | **Nothing else. Ever.** |
| `body_metric_logged` | Metric saved | `source`, `field_count` | Never the values |

### AN§3.5 Coach surfaces

| Event | Fires when | Properties | Used for |
|---|---|---|---|
| `dashboard_viewed` | Dashboard renders | `client_count`, `needs_attention_count`, `load_ms`, `from_cache` | The §19 dashboard budget in the field |
| `client_detail_viewed` | Client detail opens | `client_id`, `entry_point` | |
| `program_created` | Program saved | `week_count`, `from_template` | |
| `program_assigned` | Assignment created | `client_id`, `program_id`, `week_count` | |
| `client_invited` | Invite sent | `invite_id` | Growth funnel |
| `client_activated` | Invite accepted | `client_id`, `hours_to_accept` | Growth funnel |
| `coach_note_created` | Private note saved | `client_id` | Never the note |

### AN§3.6 Messaging and live

| Event | Fires when | Properties | Used for |
|---|---|---|---|
| `message_sent` | Message committed | `conversation_id`, `has_attachment`, `was_offline` | Never the body |
| `live_session_joined` | Participant joins | `session_id`, `kind`, `join_ms`, `network_type` | The §19 <3s budget |
| `live_session_ended` | Session ends | `session_id`, `duration_s`, `participant_count` | Live-minute cost model |

### AN§3.7 Billing

| Event | Fires when | Properties | Used for |
|---|---|---|---|
| `paywall_viewed` | Paywall renders | `entry_point`, `current_tier` | |
| `subscription_started` | Purchase confirmed | `tier`, `period`, `is_trial`, `currency` | `currency` is `'USD' \| 'INR'` — an enum, not the amount |
| `subscription_cancelled` | Cancellation webhook | `tier`, `days_subscribed`, `reason_code` | |
| `seat_limit_hit` | Invite blocked by seat limit | `tier`, `seats_used` | The §15.3 question: are seat packs used at all? |
| `seat_pack_purchased` | Seat pack confirmed | `tier`, `pack_count` | Same question |
| `trial_started` / `trial_converted` / `trial_expired` | Per the store | `tier` | |

### AN§3.8 Lifecycle, safety, and health

| Event | Fires when | Properties | Used for |
|---|---|---|---|
| `signup_completed` | Account created | `role`, `auth_method` | |
| `onboarding_completed` | Final onboarding step | `role`, `duration_s`, `steps_skipped` | The §23 "under 10 minutes" gate |
| `account_deletion_requested` | Deletion requested | `role`, `account_age_days` | |
| `user_reported` | A report is filed | `report_id`, `target_type`, `reason_code`, `reporter_role` | Trust & safety SLA |
| `user_blocked` | A block is created | `blocker_role` | Trust & safety |
| `health_sync_enabled` / `health_sync_disabled` | Toggle changes | — | Adoption only. **No health values, ever** (`ARCHITECTURE.md` AI-15) |
| `sync_failed` | Outbox item hits max attempts | `procedure`, `attempts` | E§10's visible-failure rate |

---

## AN§4. The north star

**Weekly reviewed client-weeks** — the count of (client, ISO week) pairs in which the coach
left at least one piece of feedback (`CLAUDE.md` §20).

**Computed from:** `comment_created` where `author_role = 'coach'`, plus `video_annotated`,
plus `checkin_reviewed` — grouped by `client_id` and ISO week, distinct-counted.

It is computed in PostHog, not in our database, and it is the one number reviewed every week.

**Supporting metrics, in the order they matter:**

| Metric | From | Watch for |
|---|---|---|
| Loop completion | `workout_started` → `workout_completed` | A falling ratio means the logger is in the way |
| Feedback latency | `form_check_uploaded` → `comment_created` | The WhatsApp-replacement promise, measured |
| Annotation rate | `video_annotated` / `form_check_uploaded` | **Ship gate 2 is >40%** |
| Coach D7 retention | `dashboard_viewed` | The only retention number that predicts revenue |
| Time to first feedback | `signup_completed` → first `comment_created` | Onboarding's real success criterion |

---

## AN§5. Adding an event

1. Add the row to §AN3 here, in the right subsection, with its purpose filled in. **If you
   cannot name who reads it and what decision it changes, stop.**
2. Add it to the union in `packages/schemas/src/analytics/events.ts`.
3. Emit it. Fire-and-forget, never awaited, never in a critical path.
4. Check the property list against §AN2.1 one more time, by eye. The type system stops a
   food *name*; it cannot stop you putting a food name in a field typed `Uuid`.
5. Verify it in a PostHog dev project before merging — payload, not just arrival.

**Removing an event** is a normal, encouraged PR. Delete it from all three places and note
it in the PR body. Historic data stays in PostHog; that is fine.

---

## AN§6. Volume budget

PostHog's free tier is 1M events/month (`CLAUDE.md` §3.4.3). At 100 coaches × 10 clients ×
4 sessions/week × ~30 `set_logged` events, training alone is ~500k/month. **`set_logged` is
by far the highest-volume event in the product.**

If the budget tightens, in this order:
1. Sample `set_logged` at 10% — the aggregate signals survive sampling; per-set analysis was
   never the point.
2. Drop `food_search_performed`, replacing it with a p75 latency metric from the API.
3. Drop `rest_timer_used` once the background-audio entitlement question is settled.

**Never** cut an event that feeds the north star or a ship gate. Cut volume, not visibility.

---

*Companions: `CLAUDE.md` §20 (policy) · `DATABASE.md` DB§18 (classification) ·
`ERRORS.md` (the other typed catalogue) · Owner: Ammar · Last updated: 16 August 2026*
