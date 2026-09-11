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
  programWeekId: 'programWeek',
  programDayId: 'programDay',
  programExerciseId: 'programExercise',
  // `programs.days.duplicate` / `programs.weeks.duplicate`
  // (`program-builder/06`). A copy names a SOURCE and a DESTINATION, so one
  // field name could not carry both — and both are real rows this coach
  // either owns or does not. Registering them here is what makes the
  // enumeration test probe each side independently; without it, a coach
  // could copy their own day into another coach's week.
  sourceDayId: 'programDay',
  targetWeekId: 'programWeek',
  sourceWeekId: 'programWeek',
  // `programs.duplicate` (`program-templates/02`) — the whole-program copy.
  // The destination is a brand-new program this call creates, not a row to
  // guard, so `sourceProgramId` is the only field that needs registering.
  sourceProgramId: 'program',
  // `assignments.pause` / `assignments.complete` (`assignment/01`).
  // `assignments.create` names no `assignmentId` — it names `programId`
  // and `clientId` instead, both already registered above.
  assignmentId: 'assignment',
  workoutSessionId: 'workoutSession',
  setLogId: 'setLog',
  mealId: 'meal',
  mediaAssetId: 'mediaAsset',
  commentId: 'comment',
  checkinId: 'checkin',
  liveSessionId: 'liveSession',
  // `me.update` (`account-lifecycle/01`). It names a `coaching.media_assets`
  // row the caller may not own — `users.avatar_asset_id` FKs to that table —
  // so it is guarded like any other cross-boundary id, not exempted as "a
  // value the caller sets on their own row" (pre-phase-09 audit, S2).
  avatarAssetId: 'mediaAsset',
  // Plural. `assignments.bulkCreate` (`assignment/03`) takes a batch, and
  // `ownsResource`'s selector already returns `string[]` for exactly this —
  // partial ownership is total failure. Registered so the enumeration test
  // probes it: until it did, an unguarded array-of-ids procedure passed
  // (pre-phase-09 audit, F10).
  clientIds: 'client',
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
  // The plural forms of the same thing — `programs.exercises.reorder`,
  // `.setSupersetGroup`, and `.setAlternatives`. Each is guarded by the
  // `programDayId` / `programExerciseId` the same input carries, which IS
  // registered above; the exercise ids themselves are catalogue references.
  orderedExerciseIds: 'Global exercise catalogue rows, not client-scoped.',
  exerciseIds: 'Global exercise catalogue rows, not client-scoped.',
  alternativeExerciseIds: 'Global exercise catalogue rows, not client-scoped.',
  // A device row keyed to the caller's own `users.id`, never another
  // user's — scoped by `ctx.user.id` in the resolver itself, not by
  // `ownsResource`.
  deviceId: "Always the caller's own device; scoped by ctx.user.id, not ownership.",
  // The offline-outbox idempotency key (DB§14) — a value the client
  // generates, not an id that resolves to a row anyone owns.
  clientLocalId: 'Idempotency key, not a row reference.',
  // `workouts.complete` (`session-runtime/07`). The SESSION's own
  // `client_local_id` rather than the mutation's — a second key, same kind
  // of value. It does name a row, but only ever one inside the caller's own
  // `client_id` scope: the UPDATE pins `client_id` to
  // `ctx.user.clientProfileId`, so the key alone resolves to nothing
  // (`../../features/workouts/complete.ts` decision (b)). Completion has to
  // take this instead of a server id because an ad-hoc session started and
  // finished offline has no server id yet.
  sessionClientLocalId:
    "The client's own session key, resolved only within ctx.user.clientProfileId — not a cross-boundary row reference.",
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
