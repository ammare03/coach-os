// Points drizzle-kit at the schema and migrations output, and — critically —
// lists all five DB§3 schemas in `schemaFilter`. Without that filter,
// drizzle-kit only introspects `public`, concludes every table in the other
// four schemas shouldn't exist, and a later `db:generate` proposes dropping
// all of them. See db-package-scaffold/01's "Risks" section.
import { defineConfig } from 'drizzle-kit';

import { parseEnvironment, resolveConnectionString } from './src/migrate-env.ts';

// drizzle-kit's CLI doesn't forward custom flags into this file, so
// `db:generate`/`db:studio` target a non-local database via DRIZZLE_ENV
// rather than `--env` (which `db:migrate` uses instead — see migrate.ts).
// `db:generate` and `db:studio` are local-only in every command DB§12.4
// documents; DRIZZLE_ENV exists for the rare case of pointing `db:studio`
// at staging to inspect it, not as a routine workflow.
const target = parseEnvironment(process.env.DRIZZLE_ENV);
const databaseUrl = resolveConnectionString(target);

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './migrations',
  schemaFilter: ['identity', 'training', 'nutrition', 'coaching', 'platform'],
  dbCredentials: {
    url: databaseUrl,
  },
  verbose: true,
  strict: true,
});
