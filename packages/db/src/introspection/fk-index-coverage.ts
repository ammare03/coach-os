// F4 (pre-phase-09 audit): DB§7 says "Every FK is indexed. No exceptions,"
// and claims a migration lint rule enforces it. No such rule exists. This
// module is the guard that should have — it doesn't add the 31 missing
// indexes (that's real migration risk belonging to the phases that query
// these tables), it just stops the count from growing silently.
//
// Every entry below is a FK unindexed *today*, confirmed by
// `fk-index-coverage.test.ts` against a freshly migrated schema, each with
// the phase whose queries will need the index. This list may only shrink —
// a new unindexed FK anywhere else fails the build (see the test).
export type UnindexedForeignKey = {
  /** Postgres constraint name, e.g. `habits_client_id_client_profiles_id_fk`. */
  constraint: string;
  /** One line: which phase owns the query that will justify the index. */
  reason: string;
};

export const UNINDEXED_FOREIGN_KEYS: readonly UnindexedForeignKey[] = [
  {
    constraint: 'body_metrics_checkin_id_checkins_id_fk',
    reason: 'phase-18-habits-metrics-photos owns the check-in-sourced metrics queries.',
  },
  {
    constraint: 'checkin_templates_coach_id_coach_profiles_id_fk',
    reason: 'phase-17-structured-checkins/template-builder owns the per-coach template list.',
  },
  {
    constraint: 'checkins_coach_video_asset_id_media_assets_id_fk',
    reason: 'phase-17-structured-checkins/checkin-review owns the video-reply lookup.',
  },
  {
    constraint: 'checkins_template_id_checkin_templates_id_fk',
    reason: 'phase-17-structured-checkins owns the template-usage queries.',
  },
  {
    constraint: 'comments_author_user_id_users_id_fk',
    reason: 'phase-12-feedback-comments owns the "my comments" / moderation queries.',
  },
  {
    constraint: 'comments_parent_comment_id_comments_id_fk',
    reason: 'phase-12-feedback-comments owns thread-reply lookups.',
  },
  {
    constraint: 'comments_video_reply_asset_id_media_assets_id_fk',
    reason: 'phase-12-feedback-comments owns the video-reply lookup.',
  },
  {
    constraint: 'comments_voice_note_asset_id_media_assets_id_fk',
    reason: 'phase-12-feedback-comments owns the voice-note lookup.',
  },
  {
    constraint: 'conversations_client_id_client_profiles_id_fk',
    reason: 'phase-14-messaging-and-realtime owns the per-client conversation lookup.',
  },
  {
    constraint: 'habits_client_id_client_profiles_id_fk',
    reason: 'phase-18-habits-metrics-photos owns the queries and the indexes.',
  },
  {
    constraint: 'habits_coach_id_coach_profiles_id_fk',
    reason: 'phase-18-habits-metrics-photos owns the queries and the indexes.',
  },
  {
    constraint: 'live_session_participants_user_id_users_id_fk',
    reason: "phase-19-live-sessions owns a user's live-session-history query.",
  },
  {
    constraint: 'live_sessions_client_id_client_profiles_id_fk',
    reason: 'phase-19-live-sessions/checkin-call owns the per-client session list.',
  },
  {
    constraint: 'live_sessions_coach_id_coach_profiles_id_fk',
    reason: 'phase-19-live-sessions owns the per-coach session list.',
  },
  {
    constraint: 'live_sessions_recording_asset_id_media_assets_id_fk',
    reason: 'phase-19-live-sessions/checkin-call owns the recording-to-timeline lookup.',
  },
  {
    constraint: 'live_sessions_workout_session_id_workout_sessions_id_fk',
    reason: 'phase-19-live-sessions/live-workout-mode owns this join.',
  },
  {
    constraint: 'media_assets_exercise_id_exercises_id_fk',
    reason: 'phase-07-exercise-and-program-authoring owns the per-exercise form-check lookup.',
  },
  {
    constraint: 'media_assets_set_log_id_set_logs_id_fk',
    reason: 'phase-09-workout-logger owns the per-set media attachment lookup.',
  },
  {
    constraint: 'media_assets_workout_session_id_workout_sessions_id_fk',
    reason: 'phase-10-coach-review-surfaces/session-review owns this join.',
  },
  {
    constraint: 'messages_attachment_asset_id_media_assets_id_fk',
    reason: 'phase-14-messaging-and-realtime owns the attachment lookup.',
  },
  {
    constraint: 'progress_photos_asset_id_media_assets_id_fk',
    reason: 'phase-18-habits-metrics-photos owns the photo-compare queries.',
  },
  {
    constraint: 'progress_photos_checkin_id_checkins_id_fk',
    reason: 'phase-18-habits-metrics-photos owns the check-in-linked photo queries.',
  },
  {
    constraint: 'progress_photos_client_id_client_profiles_id_fk',
    reason: 'phase-18-habits-metrics-photos owns the queries and the indexes.',
  },
  {
    constraint: 'coach_profiles_brand_logo_asset_id_media_assets_id_fk',
    reason: 'phase-25-white-label-and-teams/coach-branding owns this lookup.',
  },
  {
    constraint: 'users_avatar_asset_id_media_assets_id_fk',
    reason:
      'No feature queries by this column yet — avatars are read via a row join, not looked up by asset id.',
  },
  {
    constraint: 'foods_created_by_user_id_users_id_fk',
    reason: 'phase-13-nutrition/food-data owns the user-submitted-food queries.',
  },
  {
    constraint: 'meals_photo_asset_id_media_assets_id_fk',
    reason: 'phase-13-nutrition/diary owns the meal-photo lookup.',
  },
  {
    constraint: 'export_requests_requested_by_user_id_users_id_fk',
    reason: 'phase-03-identity-and-auth/account-lifecycle (export-builder) owns this query.',
  },
  {
    constraint: 'exercises_coach_id_coach_profiles_id_fk',
    reason:
      'phase-07-exercise-and-program-authoring owns the query. The only candidate index ' +
      '(`exercises_coach_name`) leads with the expression coalesce(coach_id, sentinel), ' +
      'which Postgres cannot use for a plain `coach_id = $1` predicate.',
  },
  {
    constraint: 'exercises_demo_asset_id_media_assets_id_fk',
    reason: 'phase-07-exercise-and-program-authoring/exercise-library owns the demo-video lookup.',
  },
] as const;
