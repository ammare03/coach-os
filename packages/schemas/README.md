# @coachos/schemas

One Zod schema per input, imported by both the API procedure and the mobile form —
`CLAUDE.md` §6.4. If validation exists in two places, that's a bug.

**Layout.** One module per `CLAUDE.md` §6.1 router (`workouts.ts`, `nutrition.ts`, …), plus
`primitives.ts` for shared building blocks (`id`, `email`, `weightKg`, …). Every feature
schema composes primitives; it never re-declares a UUID check.

**Naming.** For `workouts.logSet`: `logSetInput`, optionally `logSetOutput`, inferred types
`LogSetInput` / `LogSetOutput` via `z.infer` — never hand-written (§17.1). Name after the
procedure, not the entity: two procedures on one entity are two schemas, not one shared
schema with optional fields.

**Import direction.** Depends on Zod and nothing else — no `@coachos/db`, no Node builtin,
no `apps/*`. A Drizzle row type and a Zod input schema describe different things (what's
stored vs. what a caller may send) and are never generated from each other.

**Importing.** `import { workouts } from '@coachos/schemas'` (barrel) or
`import { logSetInput } from '@coachos/schemas/workouts'` (sub-path).

**Testing.** Every schema gets one valid case and one invalid case (§18.1).

## Conventions (`error-and-validation/03`)

**Strictness.** Every object schema is built with `strictObject()` from `strict.ts`, never
bare `z.object` — enforced by `packages/config/eslint.base.js`'s `noBareZodObjectRules` at
write time and by `__tests__/conventions.test.ts` at test time, which walks every exported
schema in every feature module and fails if one isn't strict, or has an uncapped array or
string. Zod's own default silently strips an unrecognised key; strict turns that into a
`VALIDATION_FAILED` the caller can see. Two narrow exceptions, neither routed through
`strictObject()`: inbound webhook bodies (RevenueCat, LiveKit — rejecting an unknown field
means dropping a subscription event), and `checkins.responses` / `checkin_templates.fields`
(schema'd per template in P16, genuinely schemaless JSONB per DB§2).

**Coercion.** No `z.coerce` on anything a human typed — `z.coerce.number()` maps `""` to
`0`, which on a weight field is a set logged at zero. Numbers cross the wire as numbers
(superjson, `api-scaffold/01`); there's nothing to coerce. Calendar dates stay strings
(`primitives.ts`'s `calendarDate`), never `z.date()`.

**Cross-field rules.** Use `.superRefine()` and always pass a `path`. Without one, the
issue attaches to the object root and `../02-error-formatter-and-codes.md`'s formatter has
no field to key the error under — the form shows a general error the user can't locate.

**Caps.** Every array and string draws its bound from `limits.ts` — `MAX_PAGE_SIZE`,
`MAX_ID_ARRAY`, `MAX_SHORT_TEXT`, `MAX_NOTE_TEXT`, `MAX_BODY_TEXT`, `MAX_TAG_ARRAY` — never
an inlined number. DB§2 leaves text columns unbounded at the database; these constants are
the only cap that exists.

**Pagination.** `pagination.ts` exports `paginationInput` (`{ cursor?, limit }`, `limit`
capped at `MAX_PAGE_SIZE` and rejected — never clamped — above it) and `pageOf(itemSchema)`,
producing the `{ items, nextCursor }` envelope every list procedure returns. No `offset`,
no `page`, no `total` — DB§22 bans `OFFSET` on anything that grows. `pageOf()`'s envelope is
deliberately not `strictObject()`: it describes server-composed output, not caller input,
and is exempt from the strictness rule for the same reason the two webhook/checkin
exceptions above are.

**Output gates live in `apps/api`, not here.** A procedure's `.output()` redaction schema —
see `apps/api/src/routers/README.md` — is defined next to the resolver it guards, not
shared with the mobile client. The client never validates a response; it trusts what the
server already redacted.
