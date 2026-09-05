// Input schemas for `me.*` (get, update, updatePreferences, deleteAccount).
// `me.get` takes no input — only `update` (this task) needs one so far.
import { z } from 'zod';

import { id, strictObject, timezone } from './primitives.ts';

/**
 * A BCP-47-shaped locale tag (e.g. `"en"`, `"en-IN"`, `"hi"`). `identity.users.locale`
 * (DB§5.1) is an unconstrained `text` column with no `CHECK`, so this only bounds shape
 * and length — same reasoning as `primitives.ts`'s own `.max()` comment.
 */
export const locale = z.string().trim().min(2).max(35);

/**
 * `me.update` (`account-lifecycle/01`) — an explicit allowlist of the shared `users`
 * columns a person may change about themselves. `email` and `role` are deliberately
 * absent: an email change is a separate, more sensitive flow out of this task's scope,
 * and `role` is immutable (CLAUDE.md §8.1). A generic partial-update schema here would
 * risk exposing `passwordHash` or billing fields to a client-driven update — the
 * allowlist is the whole point (see this task's Risks section).
 */
export const updateMeInput = strictObject({
  name: z.string().trim().min(1).max(200).optional(),
  timezone: timezone.optional(),
  locale: locale.optional(),
  avatarAssetId: id.nullable().optional(),
}).refine((value) => Object.keys(value).length > 0, {
  message: 'Provide at least one field to update.',
});

/** Mirrors `platform.notification_preferences.channel`'s `CHECK (channel IN ('push','email'))`. */
export const notificationChannel = z.enum(['push', 'email']);

/**
 * `platform.notification_preferences.type` (DB§5.8) is a free-text column
 * with no `CHECK` — deliberately open, since the set of notification types
 * grows with `phase-15-notifications` and nothing in this phase closes it.
 * Bounded here for shape only, never as a closed list.
 */
export const notificationPreferenceType = z.string().trim().min(1).max(64);

const notificationPreferenceInput = strictObject({
  channel: notificationChannel,
  type: notificationPreferenceType,
  enabled: z.boolean(),
});

/**
 * `me.updatePreferences` (`account-lifecycle/02`) — every field optional so a
 * caller can change one thing without resending the rest (this task's Approach
 * step 3). `notifications` is a partial list: only the `{channel, type}` tuples
 * present are touched, upserted against their composite primary key.
 */
/**
 * `identity.users.weight_unit` (DB§5.1.1) — display only. Never an input
 * to any computation; every stored weight stays kg regardless of this
 * value (`account-lifecycle/08`, `CLAUDE.md` §5.1.1).
 */
export const weightUnit = z.enum(['kg', 'lb']);

export const updatePreferencesInput = strictObject({
  analyticsOptOut: z.boolean().optional(),
  aiProcessingOptOut: z.boolean().optional(),
  weightUnit: weightUnit.optional(),
  notifications: z.array(notificationPreferenceInput).max(50).optional(),
}).refine((value) => Object.keys(value).length > 0, {
  message: 'Provide at least one preference to update.',
});

/** `me.exportStatus` (`account-lifecycle/10`) — no `clientId`; a user only ever polls their own. */
export const exportStatusInput = strictObject({
  exportId: id,
});

/**
 * `me.requestExportForDependent` (`account-lifecycle/12`) — the guardian
 * path. No delivery-address field, ever (that task's own governing rule):
 * the destination is always the confirmed `guardian_email` already on the
 * dependent's own row, resolved server-side, never a value this input could
 * carry.
 */
export const requestExportForDependentInput = strictObject({
  dependentUserId: id,
});

/**
 * The wordings of the §21.3 medical disclaimer this API will accept an
 * acknowledgment of (`phase-06-onboarding/onboarding-infrastructure/03`).
 * A closed set, so a patched client cannot record agreement to a string
 * nobody has ever seen.
 *
 * **Add a version here in the same change that changes the words** — most
 * immediately, when §21.3's "get a lawyer before launch" review replaces
 * the placeholder copy. Never edit an existing entry's meaning: a person
 * acknowledged the text that shipped under that identifier, and rewriting
 * it under them is exactly what the version exists to prevent. Old
 * versions stay in this list forever; they are what already-stored rows
 * refer to.
 *
 * The copy itself lives with the component that renders it
 * (`packages/ui/src/MedicalDisclaimer/copy.ts`), which cannot import this
 * package — `apps/mobile`'s `medical-disclaimer-version.test.ts` is what
 * asserts the two agree.
 */
/** The wording currently shown to a user. */
export const CURRENT_MEDICAL_DISCLAIMER_VERSION = '2026-09-placeholder';

export const MEDICAL_DISCLAIMER_VERSIONS = [CURRENT_MEDICAL_DISCLAIMER_VERSION] as const;

export const medicalDisclaimerVersion = z.enum(MEDICAL_DISCLAIMER_VERSIONS);

/**
 * `me.medicalDisclaimer.acknowledge` — the client sends back the version it
 * actually displayed rather than the server assuming the current one, so a
 * device running an older build records what that build showed.
 */
export const acknowledgeMedicalDisclaimerInput = strictObject({
  version: medicalDisclaimerVersion,
});

// `me.exportHistory`'s input is the package-root `paginationInput`
// (`./pagination.ts`), imported directly at the router call site, never
// redeclared here — this module's own layout test restricts every §6.1
// domain module to `zod` and `./primitives.ts` only, and `pagination.ts`
// is deliberately outside that boundary as a shared, already-covered
// infrastructure export (`layout.test.ts`'s own rule).
