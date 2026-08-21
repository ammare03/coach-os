// Points drizzle-kit at the schema and migrations output, and — critically —
// lists all five DB§3 schemas in `schemaFilter`. Without that filter,
// drizzle-kit only introspects `public`, concludes every table in the other
// four schemas shouldn't exist, and a later `db:generate` proposes dropping
// all of them. See db-package-scaffold/01's "Risks" section.
import { defineConfig } from 'drizzle-kit';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  // drizzle-kit is a CLI, run outside the API process, so it can't go
  // through apps/api/src/env.ts — this is the one place in the repo a
  // Postgres connection string is read directly from process.env.
  throw new Error('DATABASE_URL must be set to run drizzle-kit (see packages/db/.env.example).');
}

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
