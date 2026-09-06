// The typed event registry — `ANALYTICS.md` AN§1, in code.
//
// **The privacy guardrail is a type, not a review convention** (AN§2). A
// free-form `string` is not a permitted property value anywhere below;
// that is what would otherwise let a food name, a message body, a filename,
// or an email address reach PostHog. Permitted values are exactly four
// things: a branded identifier, a `number`, a `boolean`, and a named
// literal union. If a new event seems to need free text, it does not — it
// needs an enum, or it needs to not exist (AN§1).
//
// **Where this will eventually live.** AN§1 puts the union in
// `packages/schemas/src/analytics/events.ts` so the server emitter imports
// the same definitions. It is here for now because this task ships only
// the client emitter; the move is mechanical (this file imports nothing
// but its own types) and belongs to whichever task adds the server side.
//
// **Every event here has a row in `ANALYTICS.md` AN§3, and every row there
// has an entry here.** `__tests__/events-match-dictionary.test.ts` fails
// the build if that stops being true.

// ---------------------------------------------------------------------------
// Permitted property value types (AN§1)
// ---------------------------------------------------------------------------

declare const uuidBrand: unique symbol;
declare const procedureNameBrand: unique symbol;

/**
 * An identifier. Branded so an arbitrary string cannot be passed where an
 * id is expected — the caller has to say `asUuid(...)`, which is a visible,
 * greppable act rather than an accident.
 */
export type Uuid = string & { readonly [uuidBrand]: true };

/** A tRPC procedure path (`workouts.logSet`) — machine-generated, never user text. */
export type ProcedureName = string & { readonly [procedureNameBrand]: true };

/**
 * Brands an id for use in an event payload.
 *
 * This is a type-level cast and nothing more: it does not validate, because
 * `trackEvent()` validates every string-shaped property centrally against
 * the safe-token pattern before it reaches PostHog (`track-event.ts`). One
 * runtime check, in one place, rather than one per call site that each
 * decides for itself whether to throw.
 */
export function asUuid(id: string): Uuid {
  return id as Uuid;
}

/** As `asUuid`, for the one machine-generated dotted path in the dictionary. */
export function asProcedureName(path: string): ProcedureName {
  return path as ProcedureName;
}

// ---------------------------------------------------------------------------
// Named literal unions — the closed vocabularies (AN§1)
//
// Each mirrors a Postgres enum in `packages/db/src/schema/enums.ts` where
// one exists, declared locally rather than imported: the mobile app never
// depends on `@coachos/db` (CLAUDE.md §4), and an analytics vocabulary is
// allowed to be narrower than the column's — it is a reporting facet, not
// a foreign key.
// ---------------------------------------------------------------------------

/** Mirrors `user_role`. AN§3.0's `role`. */
export type AnalyticsRole = 'coach' | 'client' | 'assistant';

/** Mirrors `subscription_tier`. */
export type AnalyticsTier = 'starter' | 'coach' | 'pro' | 'studio' | 'agency';

/** CLAUDE.md §15.6's two price tracks. Never the amount — only which track. */
export type AnalyticsCurrency = 'USD' | 'INR';

/** CLAUDE.md §15.2: annual is 10× monthly, and there is no third period. */
export type AnalyticsBillingPeriod = 'monthly' | 'annual';

/** Mirrors `meal_type`. */
export type AnalyticsMealType =
  'breakfast' | 'lunch' | 'dinner' | 'snack' | 'pre_workout' | 'post_workout';

/** Mirrors `food_source`, plus `none` for a scan or search that resolved nothing. */
export type AnalyticsFoodSource =
  'openfoodfacts' | 'usda' | 'coach' | 'client' | 'verified' | 'none';

/** How a food reached the diary. A facet of logging friction, never the food. */
export type AnalyticsFoodEntryMethod = 'search' | 'barcode' | 'recent' | 'favourite' | 'custom';

/** Mirrors `comment_target`. */
export type AnalyticsCommentTarget =
  | 'workout_session'
  | 'set_log'
  | 'meal'
  | 'media_asset'
  | 'checkin'
  | 'program_day'
  | 'body_metric';

/** Mirrors `report_target`. */
export type AnalyticsReportTarget = 'message' | 'comment' | 'media_asset' | 'user';

/** Mirrors `report_reason`. §21.6 — the reason code, never the report's text. */
export type AnalyticsReportReason =
  'harassment' | 'spam' | 'inappropriate_content' | 'impersonation' | 'unsafe_advice' | 'other';

/**
 * Mirrors `photo_angle`, and is the **only** property
 * `progress_photo_uploaded` may ever carry (AN§3.4: "Nothing else. Ever.").
 */
export type AnalyticsPhotoAngle = 'front' | 'side' | 'back' | 'custom';

/** Mirrors `metric_source`. Which surface saved it — never what it said. */
export type AnalyticsMetricSource = 'manual' | 'checkin' | 'coach';

/** Mirrors `live_session_kind`. */
export type AnalyticsLiveSessionKind = 'checkin_call' | 'live_workout' | 'group';

/** Coarse connectivity class for the §19 live-join budget. Never an SSID, never an IP. */
export type AnalyticsNetworkType = 'wifi' | 'cellular' | 'unknown';

/** What a client changed about a prescribed session mid-workout. */
export type AnalyticsSessionModification =
  'exercise_swapped' | 'exercise_skipped' | 'set_added' | 'set_removed';

/** Which kind of PR was hit. Never the value that achieved it — that is a health value. */
export type AnalyticsRecordType = 'weight' | 'reps' | 'volume' | 'estimated_1rm';

/** How the coach arrived at a client's detail screen. */
export type AnalyticsClientEntryPoint =
  'dashboard' | 'client_list' | 'inbox' | 'notification' | 'search' | 'deep_link';

/** What put the paywall on screen — the input to CLAUDE.md §15.3's seat-pack question. */
export type AnalyticsPaywallEntryPoint =
  'seat_limit' | 'feature_gate' | 'settings' | 'onboarding' | 'banner' | 'trial_expiry';

/** Why a subscription ended, from the store webhook — a code, never free text. */
export type AnalyticsCancellationReason =
  'user_cancelled' | 'billing_issue' | 'refund' | 'expired' | 'downgraded' | 'unknown';

/** How the account was created (`phase-03-identity-and-auth`). */
export type AnalyticsAuthMethod = 'email' | 'apple' | 'google';

/**
 * Every closed vocabulary declared above, as one union.
 *
 * This exists so `AnalyticsPropertyValue` can say "a named literal union"
 * without saying `string` — which is the whole guardrail. Adding a
 * vocabulary above and forgetting to list it here makes the new event fail
 * to compile, which is the intended direction of failure.
 */
export type AnalyticsEnumValue =
  | AnalyticsRole
  | AnalyticsTier
  | AnalyticsCurrency
  | AnalyticsBillingPeriod
  | AnalyticsMealType
  | AnalyticsFoodSource
  | AnalyticsFoodEntryMethod
  | AnalyticsCommentTarget
  | AnalyticsReportTarget
  | AnalyticsReportReason
  | AnalyticsPhotoAngle
  | AnalyticsMetricSource
  | AnalyticsLiveSessionKind
  | AnalyticsNetworkType
  | AnalyticsSessionModification
  | AnalyticsRecordType
  | AnalyticsClientEntryPoint
  | AnalyticsPaywallEntryPoint
  | AnalyticsCancellationReason
  | AnalyticsAuthMethod;

/**
 * The complete set of values a property may hold (AN§1's table).
 *
 * Note what is absent: `string`. That omission is the guardrail — with a
 * bare `string` here, a food name, a message body, a filename, or an email
 * address would all type-check.
 */
export type AnalyticsPropertyValue = Uuid | ProcedureName | number | boolean | AnalyticsEnumValue;

// ---------------------------------------------------------------------------
// The registry — one entry per `ANALYTICS.md` AN§3 row
// ---------------------------------------------------------------------------

export interface AnalyticsEventRegistry {
  // AN§3.1 Training — the core loop
  workout_started: {
    session_id: Uuid;
    assignment_id: Uuid;
    exercise_count: number;
    was_offline: boolean;
  };
  set_logged: {
    session_id: Uuid;
    exercise_id: Uuid;
    set_number: number;
    is_warmup: boolean;
    had_rpe: boolean;
    was_offline: boolean;
    /** The §19 "<100ms set log → confirmation" budget, measured in the field. */
    entry_ms: number;
  };
  workout_completed: {
    session_id: Uuid;
    set_count: number;
    duration_s: number;
    completion_pct: number;
    was_offline: boolean;
  };
  workout_abandoned: { session_id: Uuid; set_count: number; last_activity_s: number };
  session_modified: { session_id: Uuid; modification_type: AnalyticsSessionModification };
  rest_timer_used: { session_id: Uuid; duration_s: number; was_backgrounded: boolean };
  personal_record_hit: { exercise_id: Uuid; record_type: AnalyticsRecordType };

  // AN§3.2 Nutrition — never a food name, never a barcode (AN§2.1)
  meal_logged: {
    meal_type: AnalyticsMealType;
    item_count: number;
    entry_method: AnalyticsFoodEntryMethod;
    was_offline: boolean;
  };
  barcode_scanned: { resolved: boolean; source: AnalyticsFoodSource; duration_ms: number };
  food_search_performed: { result_count: number; duration_ms: number; was_offline: boolean };
  food_created: { created_by_role: AnalyticsRole };

  // AN§3.3 Feedback — the differentiator
  form_check_uploaded: {
    asset_id: Uuid;
    duration_s: number;
    bytes: number;
    attempts: number;
    /** Proves the resumable-upload path actually resumes (E§15). */
    resumed: boolean;
  };
  /** Numerator of ship gate 2's >40% annotation rate (AN§4). */
  video_annotated: { asset_id: Uuid; annotation_count: number; has_voice_note: boolean };
  comment_created: {
    target_type: AnalyticsCommentTarget;
    is_reply: boolean;
    has_media: boolean;
    author_role: AnalyticsRole;
  };
  feedback_opened: { target_type: AnalyticsCommentTarget; seconds_since_created: number };

  // AN§3.4 Check-ins and progress
  checkin_submitted: {
    checkin_id: Uuid;
    field_count: number;
    had_photos: boolean;
    days_late: number;
  };
  checkin_reviewed: { checkin_id: Uuid; hours_to_review: number };
  progress_photo_uploaded: { angle: AnalyticsPhotoAngle };
  body_metric_logged: { source: AnalyticsMetricSource; field_count: number };

  // AN§3.5 Coach surfaces
  dashboard_viewed: {
    client_count: number;
    needs_attention_count: number;
    load_ms: number;
    from_cache: boolean;
  };
  client_detail_viewed: { client_id: Uuid; entry_point: AnalyticsClientEntryPoint };
  program_created: { week_count: number; from_template: boolean };
  program_assigned: { client_id: Uuid; program_id: Uuid; week_count: number };
  client_invited: { invite_id: Uuid };
  client_activated: { client_id: Uuid; hours_to_accept: number };
  coach_note_created: { client_id: Uuid };

  // AN§3.6 Messaging and live — never a message body
  message_sent: { conversation_id: Uuid; has_attachment: boolean; was_offline: boolean };
  live_session_joined: {
    session_id: Uuid;
    kind: AnalyticsLiveSessionKind;
    join_ms: number;
    network_type: AnalyticsNetworkType;
  };
  live_session_ended: { session_id: Uuid; duration_s: number; participant_count: number };

  // AN§3.7 Billing — the currency track, never the amount (§15.6)
  paywall_viewed: { entry_point: AnalyticsPaywallEntryPoint; current_tier: AnalyticsTier };
  subscription_started: {
    tier: AnalyticsTier;
    period: AnalyticsBillingPeriod;
    is_trial: boolean;
    currency: AnalyticsCurrency;
  };
  subscription_cancelled: {
    tier: AnalyticsTier;
    days_subscribed: number;
    reason_code: AnalyticsCancellationReason;
  };
  seat_limit_hit: { tier: AnalyticsTier; seats_used: number };
  seat_pack_purchased: { tier: AnalyticsTier; pack_count: number };
  trial_started: { tier: AnalyticsTier };
  trial_converted: { tier: AnalyticsTier };
  trial_expired: { tier: AnalyticsTier };

  // AN§3.8 Lifecycle, safety, and health
  signup_completed: { role: AnalyticsRole; auth_method: AnalyticsAuthMethod };
  onboarding_completed: { role: AnalyticsRole; duration_s: number; steps_skipped: number };
  account_deletion_requested: { role: AnalyticsRole; account_age_days: number };
  user_reported: {
    report_id: Uuid;
    target_type: AnalyticsReportTarget;
    reason_code: AnalyticsReportReason;
    reporter_role: AnalyticsRole;
  };
  user_blocked: { blocker_role: AnalyticsRole };
  /**
   * `guardian-consent/06`. The highest-abandonment step in the client
   * funnel and, until now, entirely unmeasured (§21.5).
   *
   * No properties, deliberately: AN§3.0's base `user_id` and `role`
   * are the whole of what may be known here. The guardian's email
   * address and the client's date of birth are both present on the
   * screen that fires this, and neither may ever accompany it.
   */
  guardian_consent_pending_viewed: Record<string, never>;
  /** `address_changed` distinguishes "it didn't arrive" from "I typed it wrong" — never the address itself. */
  guardian_consent_resend_requested: { address_changed: boolean };
  /** Adoption only. No health value ever accompanies these two (ARCHITECTURE.md AI-15). */
  health_sync_enabled: Record<string, never>;
  health_sync_disabled: Record<string, never>;
  sync_failed: { procedure: ProcedureName; attempts: number };
}

export type AnalyticsEventName = keyof AnalyticsEventRegistry;

export type AnalyticsProperties<TName extends AnalyticsEventName> = AnalyticsEventRegistry[TName];

/**
 * The runtime mirror of the registry's keys, in `ANALYTICS.md` AN§3 order.
 *
 * `satisfies` makes a name with no registered shape a compile error;
 * `EVENT_NAMES_MATCH_REGISTRY` below closes the other direction. Together
 * they mean this list cannot drift from the types, and the dictionary test
 * means neither can drift from `ANALYTICS.md`.
 */
export const ANALYTICS_EVENT_NAMES = [
  'workout_started',
  'set_logged',
  'workout_completed',
  'workout_abandoned',
  'session_modified',
  'rest_timer_used',
  'personal_record_hit',
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
  'dashboard_viewed',
  'client_detail_viewed',
  'program_created',
  'program_assigned',
  'client_invited',
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
  'onboarding_completed',
  'account_deletion_requested',
  'user_reported',
  'user_blocked',
  'guardian_consent_pending_viewed',
  'guardian_consent_resend_requested',
  'health_sync_enabled',
  'health_sync_disabled',
  'sync_failed',
] as const satisfies readonly AnalyticsEventName[];

type MutuallyAssignable<TLeft, TRight> = [TLeft] extends [TRight]
  ? [TRight] extends [TLeft]
    ? true
    : never
  : never;

/**
 * Fails to compile if the registry gains an event the list above missed —
 * `never` is not assignable to `true`. A const rather than a bare type
 * alias so `noUnusedLocals` cannot quietly delete the check.
 */
export const EVENT_NAMES_MATCH_REGISTRY: MutuallyAssignable<
  AnalyticsEventName,
  (typeof ANALYTICS_EVENT_NAMES)[number]
> = true;
