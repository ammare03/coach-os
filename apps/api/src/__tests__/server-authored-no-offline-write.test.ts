// DB§14.3 row two — `programs`, targets, `checkin_templates`, assignments —
// says the SERVER wins. `sync-engine/03-server-wins.md` resolves what that
// means in practice: not an algorithm, but the absence of one. These tables
// never accept an offline-originated write, so no conflict can occur by
// construction.
//
// This file is the executable half of that boundary
// (`../lib/server-authored-boundary.md` is the written half). It is a pure
// Node test: no testcontainer, no database, no reading of a spec document.
// Everything it asserts comes from the live router tree and the real source
// files on disk.
//
// The three properties, and the mistake each one catches:
//
//   A. No coach-authored procedure's input schema declares `clientLocalId`
//      anywhere in its tree. Adding one is the design inconsistency
//      `03-server-wins.md`'s Approach step 1 says to flag.
//   B. Every coach-authored input schema REJECTS a payload carrying
//      `clientLocalId`. This is the property that makes the boundary
//      structural rather than conventional: `flush.ts`'s
//      `buildProcedureInput` merges `clientLocalId` into every payload it
//      sends, unconditionally, so a strict schema turns "route this through
//      the outbox" into a validation failure the first time it is tried.
//      Goes red if a schema is switched off `strictObject`.
//   C. No coach-authored resolver imports the offline upsert helper. That
//      helper targets a `UNIQUE (owner, client_local_id)` index; none of
//      these tables has one, and reaching for it here would mean someone had
//      decided they should.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import type { z } from 'zod';

import { appRouter } from '../routers/index.ts';

import { synthesiseInput } from './authz/synthesise-input.ts';
import { walkRouter, type WalkedProcedure } from './authz/walk-router.ts';

/**
 * The coach-authored surface, as tRPC paths. Prefixes rather than a list of
 * procedure names, so a procedure added to one of these routers tomorrow is
 * covered without anyone remembering to come back here — the same reason
 * `router-registry.test.ts` reads the directory instead of a fixed list.
 *
 * `checkins.templates.` and `nutrition.plans.` match nothing yet (P17 and
 * P13 are unbuilt) and are declared anyway: they are DB§14.3's
 * `checkin_templates` and its "targets", and the cost of naming them now is
 * zero while the cost of not naming them is that the first procedure either
 * phase adds arrives unguarded. `checkins.submit` is deliberately NOT
 * covered — a client submitting a check-in is client-authored data, not
 * coach-authored, and is not on DB§14.3's server-wins row.
 */
const SERVER_AUTHORED_PREFIXES = [
  'programs.',
  'assignments.',
  'checkins.templates.',
  'nutrition.plans.',
] as const;

/**
 * Resolver directories behind those prefixes, for property C. A directory
 * that does not exist yet is skipped; one that is named here and has been
 * renamed fails, which is the point — the alternative is a scan that
 * silently covers nothing.
 */
const SERVER_AUTHORED_FEATURE_DIRS = ['programs', 'assignments', 'checkins', 'nutrition'];

const API_SRC = path.join(__dirname, '..');
const FEATURES_DIR = path.join(API_SRC, 'features');

const WALKED = walkRouter(appRouter);

function isServerAuthored(procedurePath: string): boolean {
  return SERVER_AUTHORED_PREFIXES.some((prefix) => procedurePath.startsWith(prefix));
}

const SERVER_AUTHORED_PROCEDURES = WALKED.filter((p) => isServerAuthored(p.path));

// zod v4 keeps a schema's shape on `_zod.def`; the public `z.ZodType`
// surface does not expose enough to walk it. Same one-level reach, and the
// same justification, as `./authz/synthesise-input.ts`'s own `defOf`.
interface ZodDef {
  type: string;
  shape?: Record<string, z.ZodType>;
  innerType?: z.ZodType;
  element?: z.ZodType;
  in?: z.ZodType;
  out?: z.ZodType;
}

function defOf(schema: z.ZodType): ZodDef {
  return (schema as unknown as { _zod: { def: ZodDef } })._zod.def;
}

/** Every field name reachable in a schema, at any depth — `clientLocalId` nested inside an object or an array still counts. */
function collectFieldNames(schema: z.ZodType, seen = new Set<z.ZodType>()): string[] {
  if (seen.has(schema)) return [];
  seen.add(schema);

  const def = defOf(schema);
  const names: string[] = [];

  if (def.shape) {
    for (const [key, field] of Object.entries(def.shape)) {
      names.push(key, ...collectFieldNames(field, seen));
    }
  }
  for (const inner of [def.innerType, def.element, def.in, def.out]) {
    if (inner) names.push(...collectFieldNames(inner, seen));
  }
  return names;
}

// Comments are stripped before matching so that a file *documenting* the
// absence of an offline path is not mistaken for one taking it — this whole
// codebase explains itself in comments, and a red build for a sentence would
// train people to weaken the check.
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

function tsFilesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return tsFilesUnder(full);
    return entry.isFile() && entry.name.endsWith('.ts') ? [full] : [];
  });
}

describe('server-authored data has no offline write path (DB§14.3, DB§14.6)', () => {
  // Guards every assertion below: a filter that matches nothing passes
  // vacuously, and a router rename would make it match nothing.
  it('matches the coach-authored routers that exist today', () => {
    const topLevelKeys = Object.keys(appRouter._def.record);
    expect(topLevelKeys).toEqual(
      expect.arrayContaining(['programs', 'assignments', 'checkins', 'nutrition']),
    );
    expect(SERVER_AUTHORED_PROCEDURES.length).toBeGreaterThan(0);
    expect(SERVER_AUTHORED_PROCEDURES.map((p) => p.path)).toEqual(
      expect.arrayContaining(['programs.update', 'assignments.create']),
    );
  });

  // Property A.
  it.each(SERVER_AUTHORED_PROCEDURES.map((p): [string, WalkedProcedure] => [p.path, p]))(
    '%s declares no clientLocalId field',
    (_path, procedure) => {
      if (!procedure.inputSchema) return;
      expect(collectFieldNames(procedure.inputSchema)).not.toContain('clientLocalId');
    },
  );

  // Property B. The `expect(valid)` line is what stops this being a
  // tautology: without it a synthesised payload that was never valid in the
  // first place would "reject" the augmented one for the wrong reason.
  it.each(SERVER_AUTHORED_PROCEDURES.map((p): [string, WalkedProcedure] => [p.path, p]))(
    '%s rejects an outbox-shaped payload carrying clientLocalId',
    (_path, procedure) => {
      const schema = procedure.inputSchema;
      if (!schema) return;

      const valid = synthesiseInput(schema);
      expect(schema.safeParse(valid).success).toBe(true);

      // Exactly what `apps/mobile/src/lib/outbox/flush.ts`'s
      // `buildProcedureInput` would send.
      const fromOutbox = { ...valid, clientLocalId: '018f0a3e-1b5a-7c9e-8f3d-1234567890ab' };
      expect(schema.safeParse(fromOutbox).success).toBe(false);
    },
  );

  // Property C.
  it('has no coach-authored resolver importing the offline upsert helper', () => {
    const scanned: string[] = [];
    const offenders: string[] = [];

    for (const feature of SERVER_AUTHORED_FEATURE_DIRS) {
      const dir = path.join(FEATURES_DIR, feature);
      let exists = false;
      try {
        exists = statSync(dir).isDirectory();
      } catch {
        exists = false;
      }
      if (!exists) continue;

      for (const file of tsFilesUnder(dir)) {
        scanned.push(file);
        const source = stripComments(readFileSync(file, 'utf8'));
        if (/offline-upsert|offlineUpsert|clientLocalId|client_local_id/.test(source)) {
          offenders.push(path.relative(API_SRC, file));
        }
      }
    }

    expect(scanned.length).toBeGreaterThan(0);
    expect(offenders).toEqual([]);
  });
});
