// Builds a minimal value satisfying a Zod input schema, then lets the
// caller override one top-level field with a foreign id
// (`04-authz-enumeration-test.md` step 2). Every construct this file does
// not recognise — a union, a custom refinement, anything with a `check:
// 'custom'` — throws `SynthesisFailure` rather than guessing or skipping:
// "fail with 'cannot synthesise, add an explicit probe' rather than
// skipping. A skip is a silent hole" (step 2's own words).
import type { z } from 'zod';

export class SynthesisFailure extends Error {
  constructor(path: string, reason: string) {
    super(`cannot synthesise ${path}: ${reason}`);
    this.name = 'SynthesisFailure';
  }
}

// zod v4's internal shape (`schema._zod.def`) — same reasoning as
// `walk-router.ts`'s `ProcedureInternals`: the public `z.ZodType` surface
// doesn't expose enough to walk a schema generically, so this reaches one
// level past it, deliberately and in one place.
interface ZodCheck {
  check: string;
  format?: string;
  minimum?: number;
  maximum?: number;
  value?: number;
  inclusive?: boolean;
}
interface ZodDef {
  type: string;
  checks?: { _zod: { def: ZodCheck } }[];
  innerType?: z.ZodType;
  element?: z.ZodType;
  shape?: Record<string, z.ZodType>;
  entries?: Record<string, unknown>;
  in?: z.ZodType;
}

function defOf(schema: z.ZodType): ZodDef {
  return (schema as unknown as { _zod: { def: ZodDef } })._zod.def;
}

function checksOf(def: ZodDef): ZodCheck[] {
  return (def.checks ?? []).map((c) => c._zod.def);
}

function assertNoCustomCheck(def: ZodDef, path: string): void {
  if (checksOf(def).some((c) => c.check === 'custom')) {
    throw new SynthesisFailure(path, 'a custom refinement — value cannot be guessed safely');
  }
}

function synthesiseString(def: ZodDef, path: string): string {
  assertNoCustomCheck(def, path);
  const format = checksOf(def).find((c) => c.format)?.format;
  switch (format) {
    case 'uuid':
      return '00000000-0000-7000-8000-000000000001';
    case 'email':
      return 'probe@example.com';
    case 'date':
      return '2026-01-01';
    case 'datetime':
      return '2026-01-01T00:00:00.000Z';
    case undefined:
      return 'probe-value';
    default:
      throw new SynthesisFailure(path, `unrecognised string format "${format}"`);
  }
}

function synthesiseNumber(def: ZodDef, path: string): number {
  assertNoCustomCheck(def, path);
  const checks = checksOf(def);
  const lowerBound = checks.find((c) => c.check === 'greater_than');
  if (lowerBound && typeof lowerBound.value === 'number') {
    return lowerBound.inclusive ? lowerBound.value : lowerBound.value + 1;
  }
  return 1;
}

function synthesiseArray(def: ZodDef, path: string): unknown[] {
  assertNoCustomCheck(def, path);
  if (!def.element) {
    throw new SynthesisFailure(path, 'array has no element schema');
  }
  const minLength = checksOf(def).find((c) => c.check === 'min_length')?.minimum ?? 0;
  return Array.from({ length: Math.max(minLength, 0) }, (_, i) =>
    synthesiseValue(def.element as z.ZodType, `${path}[${i}]`),
  );
}

function synthesiseObject(def: ZodDef, path: string): Record<string, unknown> {
  if (!def.shape) {
    throw new SynthesisFailure(path, 'object has no shape');
  }
  const result: Record<string, unknown> = {};
  for (const [key, fieldSchema] of Object.entries(def.shape)) {
    const fieldDef = defOf(fieldSchema);
    // Optional and defaulted fields are omitted — step 2's "minimal value
    // for each *required* field". A field the enumeration needs to
    // override (e.g. an optional `clientId`) still gets a value: the
    // override is applied after synthesis, unconditionally, by the caller.
    if (fieldDef.type === 'optional' || fieldDef.type === 'default') {
      continue;
    }
    result[key] = synthesiseValue(fieldSchema, `${path}.${key}`);
  }
  return result;
}

function synthesiseValue(schema: z.ZodType, path: string): unknown {
  const def = defOf(schema);
  switch (def.type) {
    case 'string':
      return synthesiseString(def, path);
    case 'number':
      return synthesiseNumber(def, path);
    case 'boolean':
      return true;
    case 'enum': {
      const first = def.entries && Object.values(def.entries)[0];
      if (first === undefined) {
        throw new SynthesisFailure(path, 'enum has no members');
      }
      return first;
    }
    case 'array':
      return synthesiseArray(def, path);
    case 'object':
      return synthesiseObject(def, path);
    case 'nullable':
    case 'optional':
    case 'default':
      if (!def.innerType) {
        throw new SynthesisFailure(path, `"${def.type}" has no inner type`);
      }
      return synthesiseValue(def.innerType, path);
    case 'pipe':
      // Validated against the *input* side of the pipe (`email`'s
      // `.trim().toLowerCase().pipe(z.email())` in `packages/schemas` is
      // exactly this shape) — the transform's output type is irrelevant to
      // whether the raw value we send satisfies input validation.
      if (!def.in) {
        throw new SynthesisFailure(path, 'pipe has no input schema');
      }
      return synthesiseValue(def.in, path);
    default:
      throw new SynthesisFailure(path, `unsupported zod type "${def.type}"`);
  }
}

/**
 * `schema` must be a top-level object (every tRPC procedure input in this
 * codebase is — `api-conventions` §4). `overrides` is applied after
 * synthesis and unconditionally, so it can supply a value for a field
 * synthesis would otherwise have omitted (an optional id the enumeration
 * still wants to probe).
 */
export function synthesiseInput(
  schema: z.ZodType,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const value = synthesiseValue(schema, '$input');
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new SynthesisFailure('$input', 'top-level input schema did not synthesise an object');
  }
  return { ...(value as Record<string, unknown>), ...overrides };
}

/**
 * The top-level field names of an object input schema — what the
 * enumeration's fail-closed `/Id$/` check (step 1's fourth branch) walks.
 * Every tRPC procedure input in this codebase is a top-level object
 * (`api-conventions` §4); anything else returns no fields to check, which
 * is conservative (nothing to flag) rather than a crash.
 */
export function topLevelFieldNames(schema: z.ZodType): string[] {
  const def = defOf(schema);
  return def.type === 'object' && def.shape ? Object.keys(def.shape) : [];
}
