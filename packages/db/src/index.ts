// Barrel — the package's public surface. apps/api and the BullMQ worker
// import from here, never reach into `src/schema/*` directly.
export { createDbClient, pingDb } from './client.ts';
export type { DbClient, DbClientOptions } from './client.ts';

// The one shared transaction-handle type (`aggregates/types.ts`'s own doc
// comment), re-exported so a caller outside this package — `apps/api`'s
// `writeAuditLog` (`observability/03-audit-log-writer.md`) is the first —
// never hand-derives its own copy from `DbClient['transaction']`'s
// parameters.
export type { Transaction } from './aggregates/types.ts';

// DB§8.2's transactional aggregate helpers, as `apps/api` reaches them —
// the barrel is this package's public surface, so a resolver never imports
// `src/aggregates/*` directly. Only the implemented ones are re-exported:
// the other two still throw (see `aggregates/README.md`), and exporting a
// helper nothing may call would read as an invitation to call it.
export { recomputePersonalRecords } from './aggregates/recompute-personal-records.ts';
export { recomputeSessionVolume } from './aggregates/recompute-session-volume.ts';

// The `personal_records.record_type` vocabulary, which crosses the wire in
// `workouts.logSet`'s response (`personal-records/02`) and is what
// `personal-records/03`'s celebration switches on.
export { PERSONAL_RECORD_TYPES, type PersonalRecordType } from './schema/training.ts';

export * as schema from './schema/index.ts';

// The inferred row types `types.ts` documents itself as the import path
// for — apps/api and apps/mobile were missing the re-export that promise
// depends on (api-scaffold/02 is the first consumer).
export * from './types.ts';
