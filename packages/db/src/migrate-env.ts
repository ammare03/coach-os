// The three-target resolution DB§12.4's runbook names, and the production
// guard (db-package-scaffold/03). Shared by `migrate.ts` (which needs it to
// pick a connection at runtime) and `drizzle.config.ts` (which needs the
// same resolution for `db:generate`/`db:studio` against a non-local target).
//
// Kept in one place so the guard can never accidentally differ between the
// two call sites — see `code-conventions`: one implementation of a rule,
// used everywhere it applies.
export type MigrationEnvironment = 'local' | 'staging' | 'production';

const ENV_VAR_BY_TARGET: Record<MigrationEnvironment, string> = {
  local: 'DATABASE_URL',
  staging: 'STAGING_DATABASE_URL',
  production: 'PRODUCTION_DATABASE_URL',
};

export function parseEnvironment(value: string | undefined): MigrationEnvironment {
  if (value === undefined || value === 'local') return 'local';
  if (value === 'staging' || value === 'production') return value;
  throw new Error(`Unknown environment "${value}". Expected "local", "staging", or "production".`);
}

/**
 * Reads `--env <target>` from a CLI argv array (e.g. `process.argv.slice(2)`).
 * Defaults to `local` when the flag is absent, matching DB§12.4's
 * `pnpm db:migrate` (no flag) = local.
 */
export function readEnvironmentFlag(argv: string[]): MigrationEnvironment {
  const flagIndex = argv.indexOf('--env');
  if (flagIndex === -1) return 'local';
  return parseEnvironment(argv[flagIndex + 1]);
}

export function resolveConnectionString(target: MigrationEnvironment): string {
  const varName = ENV_VAR_BY_TARGET[target];
  const value = process.env[varName];
  if (!value) {
    throw new Error(
      `${varName} is not set. Local reads it from packages/db/.env; staging and ` +
        `production must be injected by CI, never committed to a file (configuration skill).`,
    );
  }
  return value;
}

/**
 * A backstop, not a permission system (db-package-scaffold/03 §Risks): it
 * stops an accidental `pnpm db:migrate --env production` from a developer's
 * shell, not someone who has copied CI's own environment locally. Real
 * access control is the hosting/secrets layer.
 *
 * `CI` and `GITHUB_ACTIONS` are set by GitHub Actions itself on every run
 * and are not variables a local shell carries — no new secret to manage.
 */
export function assertProductionGuard(target: MigrationEnvironment): void {
  if (target !== 'production') return;

  const runningInGithubActions = process.env.CI === 'true' && process.env.GITHUB_ACTIONS === 'true';
  if (!runningInGithubActions) {
    throw new Error(
      'Refusing to run migrations against production outside CI. ' +
        '`--env production` is only ever invoked from CI on main (DATABASE.md DB§12.4).',
    );
  }
}
