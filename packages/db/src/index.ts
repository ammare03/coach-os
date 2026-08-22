// Barrel — the package's public surface. apps/api and the BullMQ worker
// import from here, never reach into `src/schema/*` directly.
export { createDbClient } from './client.ts';
export type { DbClient, DbClientOptions } from './client.ts';

export * as schema from './schema/index.ts';
