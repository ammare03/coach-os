// The tracked event dictionary — `ANALYTICS.md` AN§3, transcribed into the
// repository.
//
// **Why this file exists.** AN§2.4 asks for a cross-check between the typed
// registry and the dictionary, and `events-match-dictionary.test.ts` used to
// read `ANALYTICS.md` itself for it. That document is kept out of the
// repository by `.gitignore`'s "Specification documents" block, so on a CI
// checkout it is absent and the cross-check had nothing to read — it passed
// by vacuity on every CI run (UNFORGET **A4**). A test may not depend on a
// gitignored document. This is the tracked, machine-readable source it reads
// instead; the prose dictionary stays local-only and unchanged.
//
// **What it is.** One entry per AN§3 row: the event name, and the properties
// that row declares, in the order the document lists them. Deliberately data
// and nothing else, so a reviewer can diff it against AN§3 by eye.
//
// **What keeps it honest.** The `satisfies` below fails to compile if this
// file names an event or a property the registry does not declare, and
// `EVERY_REGISTRY_PROPERTY_IS_LISTED` fails to compile in the other
// direction. The test asserts the same two directions at runtime, and
// additionally that nothing emitted anywhere in `apps/mobile/src` is missing
// from here.
//
// AN§3.0's base properties (`user_id`, `role`, `platform`, `app_version`,
// `is_offline_queued`) are attached by the emitter and are not listed — they
// belong to no single event.

import type { AnalyticsEventName, AnalyticsProperties } from './events.ts';

/**
 * The property names an event declares.
 *
 * An event with no properties is typed `Record<string, never>`, whose
 * `keyof` is `string` — which would otherwise make every string a valid
 * entry for it. The `string extends` guard collapses that case to `never`,
 * so the only list those events accept is an empty one.
 */
type DeclaredPropertyNames<TProperties> = string extends keyof TProperties
  ? never
  : keyof TProperties & string;

type AnalyticsEventDictionary = {
  readonly [TName in AnalyticsEventName]: readonly DeclaredPropertyNames<
    AnalyticsProperties<TName>
  >[];
};

export const ANALYTICS_EVENT_DICTIONARY = {
  // AN§3.1 Training — the core loop
  workout_started: ['session_id', 'assignment_id', 'is_ad_hoc', 'exercise_count', 'was_offline'],
  set_logged: [
    'session_id',
    'exercise_id',
    'set_number',
    'is_warmup',
    'had_rpe',
    'was_offline',
    'entry_ms',
  ],
  workout_completed: ['session_id', 'set_count', 'duration_s', 'completion_pct', 'was_offline'],
  workout_abandoned: ['session_id', 'set_count', 'last_activity_s'],
  session_modified: ['session_id', 'modification_type'],
  rest_timer_used: ['session_id', 'duration_s', 'was_backgrounded'],
  personal_record_hit: ['exercise_id', 'record_type'],

  // AN§3.2 Nutrition — never a food name, never a barcode (AN§2.1)
  meal_logged: ['meal_type', 'item_count', 'entry_method', 'was_offline'],
  barcode_scanned: ['resolved', 'source', 'duration_ms'],
  food_search_performed: ['result_count', 'duration_ms', 'was_offline'],
  food_created: ['created_by_role'],

  // AN§3.3 Feedback — the differentiator
  form_check_uploaded: ['asset_id', 'duration_s', 'bytes', 'attempts', 'resumed'],
  video_annotated: ['asset_id', 'annotation_count', 'has_voice_note'],
  comment_created: ['target_type', 'is_reply', 'has_media', 'author_role'],
  feedback_opened: ['target_type', 'seconds_since_created'],

  // AN§3.4 Check-ins and progress
  checkin_submitted: ['checkin_id', 'field_count', 'had_photos', 'days_late'],
  checkin_reviewed: ['checkin_id', 'hours_to_review'],
  // AN§3.4: "Nothing else. Ever."
  progress_photo_uploaded: ['angle'],
  body_metric_logged: ['source', 'field_count'],

  // AN§3.5 Coach surfaces
  dashboard_viewed: ['client_count', 'needs_attention_count', 'load_ms', 'from_cache'],
  client_detail_viewed: ['client_id', 'entry_point'],
  program_created: ['week_count', 'from_template'],
  program_assigned: ['client_id', 'program_id', 'week_count'],
  client_invited: ['invite_id'],
  client_activated: ['client_id', 'hours_to_accept'],
  coach_note_created: ['client_id'],

  // AN§3.6 Messaging and live — never a message body
  message_sent: ['conversation_id', 'has_attachment', 'was_offline'],
  live_session_joined: ['session_id', 'kind', 'join_ms', 'network_type'],
  live_session_ended: ['session_id', 'duration_s', 'participant_count'],

  // AN§3.7 Billing — the currency track, never the amount (§15.6)
  paywall_viewed: ['entry_point', 'current_tier'],
  subscription_started: ['tier', 'period', 'is_trial', 'currency'],
  subscription_cancelled: ['tier', 'days_subscribed', 'reason_code'],
  seat_limit_hit: ['tier', 'seats_used'],
  seat_pack_purchased: ['tier', 'pack_count'],
  trial_started: ['tier'],
  trial_converted: ['tier'],
  trial_expired: ['tier'],

  // AN§3.8 Lifecycle, safety, and health
  signup_completed: ['role', 'auth_method'],
  onboarding_completed: ['role', 'duration_s', 'steps_skipped'],
  account_deletion_requested: ['role', 'account_age_days'],
  user_reported: ['report_id', 'target_type', 'reason_code', 'reporter_role'],
  user_blocked: ['blocker_role'],
  guardian_consent_pending_viewed: [],
  guardian_consent_resend_requested: ['address_changed'],
  health_sync_enabled: [],
  health_sync_disabled: [],
  sync_failed: ['procedure', 'attempts'],
  local_cache_reset: ['had_pending_outbox', 'entry_count', 'from_version', 'to_version'],
} as const satisfies AnalyticsEventDictionary;

type UnlistedProperty = {
  [TName in AnalyticsEventName]: Exclude<
    DeclaredPropertyNames<AnalyticsProperties<TName>>,
    (typeof ANALYTICS_EVENT_DICTIONARY)[TName][number]
  >;
}[AnalyticsEventName];

/**
 * Fails to compile if the registry declares a property this file omits —
 * `never` is not assignable to `true`. The `satisfies` above closes the
 * other direction. A const rather than a bare type alias so `noUnusedLocals`
 * cannot quietly delete the check.
 */
export const EVERY_REGISTRY_PROPERTY_IS_LISTED: [UnlistedProperty] extends [never] ? true : never =
  true;

/**
 * Events this app declares but does not yet emit, because the feature that
 * fires them is not built.
 *
 * This is what lets the test assert the dictionary in both directions: an
 * event here must be absent from the code, an event absent from here must be
 * emitted somewhere, and there is no third state. **Delete the row in the
 * same PR that adds the emit** — the test fails if a listed event turns out
 * to be emitted after all, so it cannot rot into an unread allowlist.
 *
 * Server-emitted events (AN§3.0 admits `platform: 'server'`) sit here too
 * while the mobile app is the only emitter in the repository.
 */
export const ANALYTICS_EVENTS_NOT_YET_EMITTED = [
  'workout_abandoned',
  'session_modified',
  'rest_timer_used',
  'meal_logged',
  'barcode_scanned',
  'food_search_performed',
  'food_created',
  'form_check_uploaded',
  'video_annotated',
  'comment_created',
  'feedback_opened',
  'checkin_submitted',
  'checkin_reviewed',
  'progress_photo_uploaded',
  'body_metric_logged',
  'client_detail_viewed',
  'program_created',
  'client_activated',
  'coach_note_created',
  'message_sent',
  'live_session_joined',
  'live_session_ended',
  'paywall_viewed',
  'subscription_started',
  'subscription_cancelled',
  'seat_limit_hit',
  'seat_pack_purchased',
  'trial_started',
  'trial_converted',
  'trial_expired',
  'signup_completed',
  'user_reported',
  'user_blocked',
  'health_sync_enabled',
  'health_sync_disabled',
] as const satisfies readonly AnalyticsEventName[];
