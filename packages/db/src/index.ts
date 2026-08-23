// Barrel — the package's public surface. apps/api and the BullMQ worker
// import from here, never reach into `src/schema/*` directly.
export { createDbClient } from './client.ts';
export type { DbClient, DbClientOptions } from './client.ts';

export * as schema from './schema/index.ts';

// The inferred row types `types.ts` documents itself as the import path
// for — apps/api and apps/mobile were missing the re-export that promise
// depends on (api-scaffold/02 is the first consumer).
export * from './types.ts';
