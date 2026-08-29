import type { ResourceKind } from './resource-registry.ts';

// The input-field-name → resource-kind map (`03-owns-resource.md` step 8,
// Files table). `phase-02-api-foundation/authorization-middleware/
// 04-authz-enumeration-test.md` reads this to know what a procedure's
// `*Id` input fields are supposed to be guarded against, and fails the
// build on a field it finds in neither this map nor the allowlist below —
// that test does not exist yet in this task, but the map it will read does.
export const RESOURCE_FIELD_KIND: Record<string, ResourceKind> = {
  clientId: 'client',
  coachNoteId: 'coachNote',
  inviteId: 'invite',
  programId: 'program',
  workoutSessionId: 'workoutSession',
  setLogId: 'setLog',
  mealId: 'meal',
  mediaAssetId: 'mediaAsset',
  commentId: 'comment',
  checkinId: 'checkin',
  liveSessionId: 'liveSession',
};

/**
 * `*Id` input field names that name something real but are deliberately
 * NOT client-scoped, with the reason recorded — `04`'s enumeration test
 * treats an unlisted `*Id` field as a bug, so a legitimate exception must
 * be named here rather than silently passing.
 */
export const NON_RESOURCE_ID_FIELDS: Record<string, string> = {
  // A global exercise-library row (`training.exercises`) — coach-authored
  // but not owned by any one client; every coach may reference any
  // exercise (`CLAUDE.md` §8.3).
  exerciseId: 'Global exercise catalogue row, not client-scoped.',
  // A device row keyed to the caller's own `users.id`, never another
  // user's — scoped by `ctx.user.id` in the resolver itself, not by
  // `ownsResource`.
  deviceId: "Always the caller's own device; scoped by ctx.user.id, not ownership.",
  // The offline-outbox idempotency key (DB§14) — a value the client
  // generates, not an id that resolves to a row anyone owns.
  clientLocalId: 'Idempotency key, not a row reference.',
  // `me.update` (`account-lifecycle/01`) writes this onto the caller's own
  // `users` row — it is a value being *set*, not a resource being *read*,
  // so there is nothing for `ownsResource` to check against. Whether the
  // referenced media asset belongs to the caller is out of this task's
  // scope (its Scope section names only `me.get`/`me.update`).
  avatarAssetId: 'A value the caller sets on their own row; scoped by ctx.user.id, not ownership.',
  // `me.exportStatus` (`account-lifecycle/10`) — a `platform.export_requests`
  // row belonging to the caller's own account, never a coach/client
  // cross-boundary resource. Scoped by a plain `userId` equality check in
  // the resolver (`../../routers/me.ts`), same reasoning as `deviceId`
  // above — `ownsResource`'s coach/client sharing model doesn't apply to
  // "is this my own row".
  exportId: "Always the caller's own export request; scoped by ctx.user.id, not ownership.",
  // `me.requestExportForDependent` (`account-lifecycle/12`) — never the
  // caller's own id. Eligibility is a manual, re-verified-every-call check
  // (`isConfirmedGuardianOf`, `../../services/export/delegated.ts`): a
  // real, non-deleted client, currently a minor, with guardian consent
  // recorded, whose `guardian_email` matches the caller's own verified
  // email. `ownsResource`'s coach/client sharing model doesn't apply — this
  // is a guardian/dependent relationship, a different kind of ownership
  // entirely.
  dependentUserId:
    "The caller's confirmed dependent (a minor client whose guardian_email matches the caller), verified inline — not ownsResource.",
  // `support.triggerUserExport` (`account-lifecycle/12`) — the operator
  // path. Gated by `operatorProcedure` (SUPPORT.md SU§2), not `ownsResource`:
  // an operator's authority to act here comes from `users.internal_operator`,
  // never from a coach/client relationship to the subject.
  subjectUserId:
    'The export subject an operator names on a support ticket, gated by operatorProcedure — not ownsResource.',
};
