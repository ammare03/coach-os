// `account-lifecycle/09`'s central safety mechanism: DATABASE.md DB§19.2
// says the purge order IS the definition of "data a user owns," and that
// the export must walk the same inventory or silently under-export. This
// module is that inventory, written down once so a test
// (`table-inventory.test.ts`) can fail the build the moment it drifts from
// either the purge job's own tables or the export collectors' own tables.
//
// Granularity matches DB§19.2's OWN naming, not a full leaf-table dump —
// the purge order itself folds `meal_items` under "meals" and
// `habit_logs` under "habits" rather than naming them separately
// (`DATABASE.md` DB§19.2's own parenthetical "meals (cascade meal_items)").
// This file does the same: a child table that only ever cascades silently
// from a named parent, and that DB§19.2 itself never names on its own
// line, is folded into its parent here too — `set_logs` under
// `workout_sessions`... no: `set_logs` IS named on its own line in DB§19.2
// step 4, so it gets its own entry. The rule is "does DB§19.2 name it",
// not "is it a child table" — that is what keeps this file from silently
// disagreeing with the one document that owns the definition.
export interface PurgeTableEntry {
  /** `schema.table`, matching how DATABASE.md DB§19.2 itself writes each name. */
  readonly name: string;
  /** Where in DB§19.2 this table is named — for anyone re-deriving this list by hand. */
  readonly purgeStep: string;
}

/**
 * DB§19.2's numbered block plus its cascade-coverage table — the union the
 * task doc calls "the definition of data the user owns" — restricted to
 * tables that actually exist in this codebase today.
 *
 * Deliberately excluded, matching `../../jobs/purge-account.ts`'s own
 * documented precedent for the same gap: `coaching.reports`,
 * `coaching.blocks`, and `platform.moderation_actions` belong to
 * `phase-26-trust-and-safety`, which hasn't been built yet. Tracked in
 * `docs/UNFORGET.md` there already; this list inherits the same exclusion
 * rather than re-opening it, and must gain an entry the moment that phase
 * lands (its own PR is the natural place — the same PR that teaches
 * `purge-account.ts` about them teaches this file too).
 */
export const PURGE_TABLES: readonly PurgeTableEntry[] = [
  { name: 'identity.users', purgeStep: 'step 5' },
  { name: 'identity.coach_profiles', purgeStep: 'step 5' },
  { name: 'identity.client_profiles', purgeStep: 'step 5' },
  { name: 'identity.coach_client_notes', purgeStep: 'step 5 / cascade table' },
  { name: 'identity.invites', purgeStep: 'step 5' },
  { name: 'identity.devices', purgeStep: 'step 5' },
  { name: 'identity.refresh_tokens', purgeStep: 'step 5' },
  { name: 'identity.auth_providers', purgeStep: 'step 5' },
  { name: 'identity.deletion_requests', purgeStep: 'cascade table' },
  { name: 'identity.medical_disclaimer_acknowledgements', purgeStep: 'cascade table' },
  { name: 'training.workout_sessions', purgeStep: 'step 4' },
  { name: 'training.set_logs', purgeStep: 'step 4' },
  { name: 'training.assignments', purgeStep: 'step 4' },
  { name: 'training.personal_records', purgeStep: 'step 4' },
  { name: 'training.exercises', purgeStep: 'step 4 (coach-owned)' },
  { name: 'training.programs', purgeStep: 'step 4 (coach-owned)' },
  { name: 'nutrition.meals', purgeStep: 'step 3' },
  { name: 'nutrition.water_logs', purgeStep: 'step 3' },
  { name: 'nutrition.daily_nutrition_summary', purgeStep: 'step 3' },
  { name: 'nutrition.meal_plans', purgeStep: 'cascade table' },
  { name: 'nutrition.meal_plan_assignments', purgeStep: 'cascade table' },
  { name: 'coaching.comments', purgeStep: 'step 2' },
  { name: 'coaching.reactions', purgeStep: 'step 2' },
  { name: 'coaching.media_assets', purgeStep: 'step 2' },
  { name: 'coaching.checkins', purgeStep: 'step 2' },
  { name: 'coaching.body_metrics', purgeStep: 'step 2' },
  { name: 'coaching.progress_photos', purgeStep: 'step 2' },
  { name: 'coaching.habits', purgeStep: 'step 2' },
  { name: 'coaching.live_sessions', purgeStep: 'step 2' },
  { name: 'coaching.live_session_participants', purgeStep: 'cascade table' },
  { name: 'coaching.messages', purgeStep: 'step 2' },
  { name: 'coaching.checkin_templates', purgeStep: 'cascade table' },
  { name: 'coaching.conversations', purgeStep: 'cascade table' },
  { name: 'platform.notifications', purgeStep: 'cascade table' },
  { name: 'platform.notification_preferences', purgeStep: 'cascade table' },
  { name: 'platform.storage_usage', purgeStep: 'cascade table' },
  { name: 'platform.feature_usage', purgeStep: 'cascade table' },
  { name: 'platform.export_requests', purgeStep: 'step 8' },
];

/**
 * Tables `PURGE_TABLES` names that this feature has reviewed and
 * deliberately left OUT of the archive, each with the one-line reason a
 * reviewer needs. Every entry here is a considered decision, never an
 * oversight — `table-inventory.test.ts` asserts `PURGE_TABLES` minus this
 * set equals `EXPORT_TABLES` exactly, so an UNREVIEWED gap still fails the
 * build; only a name added to both this file's export collector AND this
 * list (or neither) passes.
 */
export const EXPORT_EXCLUDED: Readonly<Record<string, string>> = {
  // Security/session artifacts, not authored content. DB§18.1: a refresh
  // token is never stored except as a hash, and a hash has no value to a
  // user reading their own export — the security skill's "never export a
  // token" rule would be violated by including even the hash.
  'identity.devices': 'device/session metadata, not authored content',
  'identity.refresh_tokens': 'security credential — DB§18.1 never exports a token, hashed or not',
  'identity.auth_providers': 'social sign-in linkage, not portable content',
  // Process metadata about the deletion flow itself — not the user's
  // product data, and by definition only relevant while an export could
  // even run (a fully purged account has nothing left to export from).
  'identity.deletion_requests': 'records the deletion request itself, not user content',
  // Same shape of reasoning: a (version, timestamp) pair recording that a
  // notice was shown and accepted. The notice's own words are in the app
  // and in settings at any time (`onboarding-infrastructure/03`), so the
  // archive would carry a row referencing text it does not contain.
  'identity.medical_disclaimer_acknowledgements':
    'records that a notice was acknowledged, not content the user authored',
  // A coach-authored template, but `checkins.template_snapshot` already
  // freezes the exact question set a client's check-in was generated
  // against — the archive's check-ins.json carries that snapshot, so the
  // live template adds no portability value the frozen copy doesn't.
  'coaching.checkin_templates':
    'superseded by checkins.template_snapshot, already in check-ins.json',
  // A thin (coach_id, client_id, last_message_at) pointer with no content
  // of its own — every message it groups is already in messages.json.
  'coaching.conversations': 'index-only wrapper; content is in messages.json',
  // Multi-participant semantics (`live_session_kind = 'group'`) have no
  // real code path yet (Phase 3, phase-19). Until then a session's own row
  // in live-sessions.json already implies who was in it (the coach, and
  // the one named client for a 1:1 call).
  'coaching.live_session_participants': 'no group-session feature yet; 1:1 attendance is implicit',
  // Derived, recomputable aggregate counters — not content the user
  // authored, the same reasoning DB§19.2 itself applies to leaving
  // `nutrition.foods`' nutrition values alone while stripping authorship.
  'platform.storage_usage': 'derived aggregate counter, recomputable, not authored content',
  'platform.feature_usage': 'derived aggregate counter, recomputable, not authored content',
  // The export mechanism's own bookkeeping — including "your past export
  // requests" inside an export is circular, and DB§19.2 step 8 already
  // treats this table as disposable alongside the archives themselves.
  'platform.export_requests': 'records the export process itself, not user content',
};

/**
 * The tables `../../services/export/collect.ts` actually reads, at
 * DB§19.2's own naming granularity. Every one of these must appear in
 * `PURGE_TABLES` — an export reading a table the purge order doesn't even
 * know about would mean DB§19.2 itself under-documents what the user owns.
 */
export const EXPORT_TABLES: readonly string[] = [
  'identity.users',
  'identity.coach_profiles',
  'identity.client_profiles',
  'identity.coach_client_notes',
  'identity.invites',
  'training.workout_sessions',
  'training.set_logs',
  'training.assignments',
  'training.personal_records',
  'training.exercises',
  'training.programs',
  'nutrition.meals',
  'nutrition.water_logs',
  'nutrition.daily_nutrition_summary',
  'nutrition.meal_plans',
  'nutrition.meal_plan_assignments',
  'coaching.comments',
  'coaching.reactions',
  'coaching.media_assets',
  'coaching.checkins',
  'coaching.body_metrics',
  'coaching.progress_photos',
  'coaching.habits',
  'coaching.live_sessions',
  'coaching.messages',
  'platform.notifications',
  'platform.notification_preferences',
];
