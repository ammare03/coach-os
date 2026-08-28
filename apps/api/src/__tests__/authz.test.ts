// The authorization enumeration test `CLAUDE.md` §18.3 names, at the path
// it names. Behavioural, not structural (`04-authz-enumeration-test.md`'s
// own framing): it never inspects the middleware chain, only calls every
// procedure in `appRouter` and watches what comes back.
//
// `appRouter` is imported statically — walking its structure needs no
// database connection, so this file never fights the env-freezing problem
// `context.test.ts` and friends work around with dynamic imports. Every
// probe below builds its own context via `createTestContext`, injecting the
// real testcontainer-backed `db` directly; the process-wide singleton in
// `../trpc/context.ts` is never touched.
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { createDbClient, type DbClient } from '@coachos/db';
import { TRPCError } from '@trpc/server';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

import { isCatalogedError } from '../lib/app-error.ts';
import { appRouter } from '../routers/index.ts';
import { NON_RESOURCE_ID_FIELDS, RESOURCE_FIELD_KIND } from '../trpc/authz/resource-fields.ts';
import type { ResourceKind } from '../trpc/authz/resource-registry.ts';
import type { ContextUser } from '../trpc/context.ts';

import { classifyProbe } from './authz/probe-result.ts';
import { SynthesisFailure, synthesiseInput, topLevelFieldNames } from './authz/synthesise-input.ts';
import { walkRouter, type WalkedProcedure } from './authz/walk-router.ts';
import { PUBLIC_ALLOWLIST } from './authz-allowlist.ts';
import { createTwoCoachesFixture, type TwoCoachesFixture } from './fixtures/two-coaches.ts';
import { createTestContext } from './test-context.ts';

// Pure reflection over the router tree — no I/O, safe to run at describe
// time, before `beforeAll` has a real database to hand out.
const WALKED_PROCEDURES = walkRouter(appRouter);

let container: StartedTestContainer;
let db: DbClient;
let fixture: TwoCoachesFixture;

beforeAll(async () => {
  container = await new GenericContainer('postgres:16')
    .withEnvironment({
      POSTGRES_USER: 'coachos',
      POSTGRES_PASSWORD: 'coachos',
      POSTGRES_DB: 'coachos',
    })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage('database system is ready to accept connections', 2))
    .start();

  const connectionString = `postgres://coachos:coachos@${container.getHost()}:${container.getMappedPort(5432)}/coachos`; // secret-scan-ignore — well-known local dev credential

  const migrateScript = path.join(
    __dirname,
    '..',
    '..',
    '..',
    '..',
    'packages',
    'db',
    'src',
    'migrate.ts',
  );
  execFileSync(process.execPath, ['--experimental-strip-types', migrateScript], {
    env: { ...process.env, DATABASE_URL: connectionString },
    stdio: 'inherit',
  });

  db = createDbClient({ connectionString, sslMode: false });
  fixture = await createTwoCoachesFixture(db);
}, 120_000);

afterAll(async () => {
  await db.$client.end();
  await container.stop();
});

// Rolls back every write a probe makes — Risks: "probing mutations against
// a real database mutates it... a probe that leaves a row behind makes the
// next probe's assertion depend on test ordering." No procedure mutates
// anything today (every router is still a P07+ stub), but this is the
// mechanism that keeps that true once one does.
const PROBE_ROLLBACK = Symbol('authz-probe-rollback');
async function withRolledBackTx<T>(fn: (tx: DbClient) => Promise<T>): Promise<T> {
  let out: T | undefined;
  try {
    await db.transaction(async (tx) => {
      out = await fn(tx as unknown as DbClient);
      throw PROBE_ROLLBACK;
    });
  } catch (error) {
    if (error !== PROBE_ROLLBACK) throw error;
  }
  return out as T;
}

function coachAUser(): ContextUser {
  return {
    id: fixture.coachA.userId,
    email: 'coach-a@two-coaches-fixture.com',
    role: 'coach',
    timezone: 'UTC',
    locale: 'en',
    coachProfileId: fixture.coachA.profileId,
    clientProfileId: null,
    deletedAt: null,
  };
}

function clientA1User(): ContextUser {
  return {
    id: fixture.clientA1.userId,
    email: 'client-a1@two-coaches-fixture.com',
    role: 'client',
    timezone: 'UTC',
    locale: 'en',
    coachProfileId: null,
    clientProfileId: fixture.clientA1.profileId,
    deletedAt: null,
  };
}

function callerFor(tx: DbClient, user: ContextUser | null) {
  return appRouter.createCaller(createTestContext({ db: tx, user }));
}

// Navigates a `createCaller()` result by a dotted path — the same shape
// `router-registry.test.ts` proves `appRouter._def.procedures` produces.
function callProcedure(caller: unknown, dottedPath: string, input: unknown): Promise<unknown> {
  const method = dottedPath
    .split('.')
    .reduce<unknown>((cursor, segment) => (cursor as Record<string, unknown>)[segment], caller);
  return (method as (input: unknown) => Promise<unknown>)(input);
}

// Step 1's first branch: does `isAuthed` reject an anonymous caller before
// anything else runs? The input passed doesn't need to be valid — a
// procedure built on `protectedProcedure` rejects for `AUTH_REQUIRED`
// before `.input()` ever parses it, since `isAuthed` is attached to the
// builder *before* the router's own `.input()` call composes on top of it.
async function isProtectedByAuth(procedure: WalkedProcedure): Promise<boolean> {
  const probeInput = procedure.inputSchema ? {} : undefined;
  try {
    await withRolledBackTx((tx) => callProcedure(callerFor(tx, null), procedure.path, probeInput));
    return false;
  } catch (error) {
    return (
      error instanceof TRPCError &&
      isCatalogedError(error) &&
      error.cause.appCode === 'AUTH_REQUIRED'
    );
  }
}

function foreignIdFor(kind: ResourceKind): string {
  // Exhaustive over `ResourceKind` (`03-owns-resource.md` step 8's ten
  // seeded kinds, plus `invite` from `invites/01`) — adding a twelfth fails
  // this switch until it's given a case, the same exhaustiveness discipline
  // as `has-role.ts`.
  switch (kind) {
    case 'client':
      return fixture.clientB1.profileId;
    case 'coachNote':
      return fixture.coachB.coachNoteId;
    case 'invite':
      return fixture.coachB.inviteId;
    case 'program':
      return fixture.coachB.programId;
    case 'workoutSession':
      return fixture.clientB1.workoutSessionId;
    case 'setLog':
      return fixture.clientB1.setLogId;
    case 'meal':
      return fixture.clientB1.mealId;
    case 'mediaAsset':
      return fixture.clientB1.mediaAssetId;
    case 'comment':
      return fixture.clientB1.commentId;
    case 'checkin':
      return fixture.clientB1.checkinId;
    case 'liveSession':
      return fixture.clientB1.liveSessionId;
  }
}

async function probeOneProcedure(procedure: WalkedProcedure): Promise<void> {
  const { path: dottedPath, inputSchema } = procedure;
  const failures: string[] = [];

  // Branch 1/2: public vs protected.
  if (!(await isProtectedByAuth(procedure))) {
    if (!PUBLIC_ALLOWLIST.some((entry) => entry.path === dottedPath)) {
      failures.push(
        `${dottedPath}: reachable with no token and not on the allowlist (authz-allowlist.ts) — ` +
          'public and unjustified',
      );
    }
    if (failures.length > 0) throw new Error(failures.join('\n'));
    return;
  }

  // Branch 5: protected, no input at all → scoped by ctx alone.
  if (!inputSchema) {
    return;
  }

  // Branches 3/4: classify every `*Id` field.
  const idFields = topLevelFieldNames(inputSchema).filter((field) => field.endsWith('Id'));
  const fieldsToProbe: { field: string; kind: ResourceKind }[] = [];
  for (const field of idFields) {
    const kind = RESOURCE_FIELD_KIND[field];
    if (kind) {
      fieldsToProbe.push({ field, kind });
    } else if (field in NON_RESOURCE_ID_FIELDS) {
      continue;
    } else {
      failures.push(
        `${dottedPath}.${field}: unregistered identifier — add it to RESOURCE_FIELD_KIND ` +
          '(../trpc/authz/resource-fields.ts) or to NON_RESOURCE_ID_FIELDS with a reason',
      );
    }
  }

  // Branch 2 (probe) for every registered field, as both roles.
  for (const { field, kind } of fieldsToProbe) {
    let input: Record<string, unknown>;
    try {
      input = synthesiseInput(inputSchema, { [field]: foreignIdFor(kind) });
    } catch (error) {
      failures.push(
        `${dottedPath}.${field}: ${error instanceof SynthesisFailure ? error.message : String(error)}`,
      );
      continue;
    }

    const probesByRole: [string, ContextUser][] = [
      ["coach A (against coach B's client)", coachAUser()],
      ["client A1 (against coach B's client)", clientA1User()],
    ];
    for (const [roleLabel, user] of probesByRole) {
      const outcome = await withRolledBackTx((tx) =>
        classifyProbe(() => callProcedure(callerFor(tx, user), dottedPath, input)),
      );
      if (outcome.verdict !== 'refused') {
        const detail = 'description' in outcome ? outcome.description : '';
        failures.push(
          `${dottedPath}.${field} as ${roleLabel}: expected FORBIDDEN/NOT_YOUR_CLIENT, got ` +
            `${outcome.verdict} — ${detail}`,
        );
      }
    }
  }

  if (failures.length > 0) {
    throw new Error(failures.join('\n'));
  }
}

describe('authorization enumeration', () => {
  it.each(WALKED_PROCEDURES)('$path', async (procedure: WalkedProcedure) => {
    await probeOneProcedure(procedure);
  });

  // The fail-closed guarantee itself, independent of which procedures
  // exist today (`04-authz-enumeration-test.md` acceptance criteria).
  it('reaches every registered router, including two levels deep', () => {
    const paths = WALKED_PROCEDURES.map((p) => p.path);
    expect(paths).toContain('health.ping');
    expect(paths).toContain('coach.clients.list');
  });

  // `05-public-allowlist.md` step 3/4 — the two checks that keep the
  // allowlist honest. Both run over every entry in one assertion each,
  // rather than per-entry `it.each`, since a stale or redundant entry is a
  // property of the *list*, not of any one procedure the walk found.
  it('has no stale entry — every allowlisted path exists in the walk', () => {
    const walkedPaths = new Set(WALKED_PROCEDURES.map((p) => p.path));
    const stale = PUBLIC_ALLOWLIST.filter((entry) => !walkedPaths.has(entry.path));

    expect(stale.map((entry) => entry.path)).toEqual([]);
  });

  it('has no redundant entry — no allowlisted path is already guarded by isAuthed', async () => {
    const redundant: string[] = [];
    for (const entry of PUBLIC_ALLOWLIST) {
      const procedure = WALKED_PROCEDURES.find((p) => p.path === entry.path);
      if (procedure && (await isProtectedByAuth(procedure))) {
        redundant.push(entry.path);
      }
    }

    expect(redundant).toEqual([]);
  });
});
