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
};
