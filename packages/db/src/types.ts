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
export {};
