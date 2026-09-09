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
}, 120_000);

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
    isMinor: false,
    guardianConsentAt: null,
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
    isMinor: false,
    guardianConsentAt: null,
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
  // seeded kinds, plus `invite` from `invites/01`, the two
  // program-structure kinds from `program-builder/01` and the target block
  // from `program-builder/02`, and `assignment` from `assignment/01`) —
  // adding another fails
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
    case 'programWeek':
      return fixture.coachB.programWeekId;
    case 'programDay':
      return fixture.coachB.programDayId;
    case 'programExercise':
      return fixture.coachB.programExerciseId;
    case 'assignment':
      return fixture.clientB1.assignmentId;
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

/**
 * Protected procedures that take no input at all, and are therefore scoped
 * entirely by `ctx.user`. Branch 5 has nothing to probe for these, so each
 * needs a stated reason instead — an unscoped no-input procedure would
 * otherwise pass this test in silence (pre-phase-09 audit, S3).
 *
 * The bar for an entry: the resolver reads `ctx.user.id` (or a profile id
 * hanging off it) and nothing else that identifies a row. A procedure that
 * returns anything belonging to somebody else does not belong here.
 */
const CTX_SCOPED_NO_INPUT: Record<string, string> = {
  'auth.signOutAllDevices': "Revokes every family for ctx.user.id — the caller's own sessions.",
  'clientApp.coach': "The caller's own coach, via ctx.user.clientProfileId.",
  'clientApp.leaveCoach': "Detaches the caller's own client profile.",
  'coach.clients.list':
    'coachProcedure; resolves against ctx.user.coachProfileId. A stub returning [] until P10.',
  'invites.listPending': "Invites created by ctx.user.coachProfileId — the caller's own.",
  'me.get': "The caller's own users row.",
  'me.medicalDisclaimer.status': "The caller's own acknowledgment, read by ctx.user.id.",
  'me.completeOnboarding': "Marks the caller's own onboarding complete.",
  'me.requestDeletion': "Opens a deletion request for the caller's own account.",
  'me.cancelDeletion': "Cancels the caller's own deletion request.",
  'me.requestExport': "Queues an export of the caller's own data.",
};

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

  // Branch 5: protected, no input at all. There is no id to probe, so the
  // procedure has to be scoped by `ctx` — but that is an assumption, not
  // something this behavioural test can observe, and an unscoped one would
  // pass silently. It is therefore an allowlist with a written reason each,
  // the same shape as `PUBLIC_ALLOWLIST` and `NON_RESOURCE_ID_FIELDS`:
  // a new no-input procedure fails here until someone states why it is safe.
  if (!inputSchema) {
    if (!(dottedPath in CTX_SCOPED_NO_INPUT)) {
      throw new Error(
        `${dottedPath}: takes no input, so nothing can be probed — add it to ` +
          'CTX_SCOPED_NO_INPUT with the reason it is scoped by ctx alone, or give it a ' +
          'role-narrowed builder and an input the enumeration can reach',
      );
    }
    return;
  }

  // Branches 3/4: classify every `*Id` / `*Ids` field. The plural matters:
  // until it was included, an unguarded `{ clientIds: string[] }` procedure
  // passed this test outright (pre-phase-09 audit, F10).
  const idFields = topLevelFieldNames(inputSchema).filter((field) => /Ids?$/.test(field));
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
      // A plural field takes the foreign id as a one-element array —
      // `ownsResource`'s all-or-nothing rule means one foreign id in the
      // batch is enough to require refusal.
      const foreign: string | string[] = field.endsWith('Ids')
        ? [foreignIdFor(kind)]
        : foreignIdFor(kind);
      input = synthesiseInput(inputSchema, { [field]: foreign });
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
          `${dottedPath}.${field} as ${roleLabel}: expected NOT_FOUND/NOT_YOUR_CLIENT, got ` +
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
