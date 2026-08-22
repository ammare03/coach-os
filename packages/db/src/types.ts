// Barrel — every table's inferred row types, re-exported. Starts empty on
// purpose (db-package-scaffold/05): no table exists yet. Features 2 through
// 6 each add their own exports here as they define tables; nothing
// redeclares a row shape anywhere else in the codebase (CLAUDE.md §17.1).
//
// The convention every later export follows, for a table `setLogs`
// (DATABASE.md DB§11.2's own example):
//
//   export type SetLog    = typeof setLogs.$inferSelect;
//   export type NewSetLog = typeof setLogs.$inferInsert;
//
// `apps/api` routers and `apps/mobile` features import the row type from
// here, never from `./schema/*` directly and never by hand-writing an
// `interface`/`type` that mirrors a table — `eslint.base.js`'s
// `local/no-hand-written-row-type` rule flags the common case of the
// latter.
import type {
  authProviders,
  clientProfiles,
  coachClientNotes,
  coachProfiles,
  devices,
  invites,
  refreshTokens,
  users,
} from './schema/identity.ts';
import type { exercises } from './schema/training.ts';

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export type AuthProvider = typeof authProviders.$inferSelect;
export type NewAuthProvider = typeof authProviders.$inferInsert;

export type Device = typeof devices.$inferSelect;
export type NewDevice = typeof devices.$inferInsert;

export type RefreshToken = typeof refreshTokens.$inferSelect;
export type NewRefreshToken = typeof refreshTokens.$inferInsert;

export type CoachProfile = typeof coachProfiles.$inferSelect;
export type NewCoachProfile = typeof coachProfiles.$inferInsert;

export type ClientProfile = typeof clientProfiles.$inferSelect;
export type NewClientProfile = typeof clientProfiles.$inferInsert;

// ⚠️ NEVER exposed to the client. No tRPC procedure returns this to
// role='client' (DATABASE.md DB§5.1's own in-line warning,
// identity-schema/04). Restated here as a forward pointer for whoever
// implements this table's router in P02/P03.
export type CoachClientNote = typeof coachClientNotes.$inferSelect;
export type NewCoachClientNote = typeof coachClientNotes.$inferInsert;

export type Invite = typeof invites.$inferSelect;
export type NewInvite = typeof invites.$inferInsert;

export type Exercise = typeof exercises.$inferSelect;
export type NewExercise = typeof exercises.$inferInsert;
