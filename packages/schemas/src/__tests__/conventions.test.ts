// Walks the exported schema tree reflectively rather than asserting against
// a hardcoded list (`error-and-validation/03-validation-conventions.md`,
// mirroring the argument `layout.test.ts` and `api-scaffold/04`'s router
// registry both make for themselves): a new schema module that skips
// `strictObject`, or a new array/string with no cap, must fail here without
// anyone remembering to add it to an allowlist.
//
// Zod v4 exposes `.def` publicly on every schema instance (not the
// underscore-prefixed `._def`) — that's the one piece of "internals" this
// file leans on, and only for the three checks the plan calls out: whether
// an object's unknown-key policy is `strict` (its `catchall` is a
// `ZodNever`), and whether an array/string carries a `max_length` check.
import { z } from 'zod';

import * as authModule from '../auth.ts';
import * as billingModule from '../billing.ts';
import * as checkinsModule from '../checkins.ts';
import * as clientModule from '../client.ts';
import * as coachModule from '../coach.ts';
import * as commentsModule from '../comments.ts';
import * as exercisesModule from '../exercises.ts';
import * as habitsModule from '../habits.ts';
import * as invitesModule from '../invites.ts';
import * as liveModule from '../live.ts';
import * as meModule from '../me.ts';
import * as mediaModule from '../media.ts';
import * as messagesModule from '../messages.ts';
import * as metricsModule from '../metrics.ts';
import * as notificationsModule from '../notifications.ts';
import * as nutritionModule from '../nutrition.ts';
import * as programsModule from '../programs.ts';
import * as supportModule from '../support.ts';
import * as workoutsModule from '../workouts.ts';

// The §6.1 input-schema modules — where a procedure's *caller-supplied*
// input lives, and therefore where strictness/caps apply. `primitives.ts`
// (format-validated building blocks, not length-bounded — task 01, out of
// scope here) and `pagination.ts`'s `pageOf()` envelope (server-composed
// output, exempt per its own doc comment) are deliberately not walked.
const FEATURE_MODULES: Record<string, object> = {
  auth: authModule,
  billing: billingModule,
  checkins: checkinsModule,
  client: clientModule,
  coach: coachModule,
  comments: commentsModule,
  exercises: exercisesModule,
  habits: habitsModule,
  invites: invitesModule,
  live: liveModule,
  me: meModule,
  media: mediaModule,
  messages: messagesModule,
  metrics: metricsModule,
  notifications: notificationsModule,
  nutrition: nutritionModule,
  programs: programsModule,
  support: supportModule,
  workouts: workoutsModule,
};

interface ZodLike {
  def: { type: string; [key: string]: unknown };
}

function isZodLike(value: unknown): value is ZodLike {
  return typeof value === 'object' && value !== null && 'def' in value;
}

function hasMaxLengthCheck(value: ZodLike): boolean {
  const checks = value.def.checks;
  if (!Array.isArray(checks)) return false;
  return checks.some((check) => {
    const internals = (check as { _zod?: { def?: { check?: unknown } } })._zod;
    return internals?.def?.check === 'max_length';
  });
}

function isStrictObject(value: ZodLike): boolean {
  const catchall = value.def.catchall;
  return isZodLike(catchall) && catchall.def.type === 'never';
}

/** Every violation found, as a human-readable path — collected rather than
 * thrown-on-first so one failing test names every offender in one run. */
function collectViolations(root: unknown, path: string, seen = new Set<unknown>()): string[] {
  if (!isZodLike(root) || seen.has(root)) return [];
  seen.add(root);

  const violations: string[] = [];

  switch (root.def.type) {
    case 'object': {
      if (!isStrictObject(root))
        violations.push(`${path}: object is not strict — use strictObject()`);
      const shape = (root as unknown as { shape: Record<string, unknown> }).shape;
      for (const [key, field] of Object.entries(shape)) {
        violations.push(...collectViolations(field, `${path}.${key}`, seen));
      }
      break;
    }
    case 'array': {
      if (!hasMaxLengthCheck(root)) violations.push(`${path}: array has no .max()`);
      violations.push(...collectViolations(root.def.element, `${path}[]`, seen));
      break;
    }
    case 'string': {
      if (!hasMaxLengthCheck(root)) violations.push(`${path}: string has no .max()`);
      break;
    }
    case 'optional':
    case 'nullable':
    case 'default':
    case 'readonly':
    case 'nonoptional':
    case 'catch':
      violations.push(...collectViolations(root.def.innerType, path, seen));
      break;
    case 'pipe':
      violations.push(...collectViolations(root.def.in, `${path}(in)`, seen));
      violations.push(...collectViolations(root.def.out, `${path}(out)`, seen));
      break;
    case 'union':
      for (const [i, option] of ((root.def.options as unknown[]) ?? []).entries()) {
        violations.push(...collectViolations(option, `${path}|${i}`, seen));
      }
      break;
    default:
      break;
  }

  return violations;
}

describe('collectViolations — proving the walker actually catches what it claims to', () => {
  it('flags a bare z.object as not strict', () => {
    const bad = z.object({ name: z.string().max(10) });
    expect(collectViolations(bad, 'fixture')).toContain(
      'fixture: object is not strict — use strictObject()',
    );
  });

  it('flags an array with no .max()', () => {
    const bad = z.strictObject({ tags: z.array(z.string().max(10)) });
    expect(collectViolations(bad, 'fixture')).toContain('fixture.tags: array has no .max()');
  });

  it('flags a string with no .max()', () => {
    const bad = z.strictObject({ name: z.string() });
    expect(collectViolations(bad, 'fixture')).toContain('fixture.name: string has no .max()');
  });

  it('passes a schema that follows every rule, including through optional/array wrapping', () => {
    const good = z.strictObject({
      name: z.string().max(200),
      tags: z.array(z.string().max(20)).max(20).optional(),
    });
    expect(collectViolations(good, 'fixture')).toEqual([]);
  });
});

describe('every §6.1 input-schema module', () => {
  for (const [name, mod] of Object.entries(FEATURE_MODULES)) {
    it(`${name}: every exported schema is strict, and every array/string is capped`, () => {
      const violations = Object.entries(mod).flatMap(([exportName, value]) =>
        collectViolations(value, `${name}.${exportName}`),
      );
      expect(violations).toEqual([]);
    });
  }
});
