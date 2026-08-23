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
