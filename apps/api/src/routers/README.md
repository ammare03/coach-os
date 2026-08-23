# Router registration pattern

One file per router. A router file default-exports nothing; it exports one
named `<name>Router` built with `router({ ... })` from `../trpc/init.ts`.

`index.ts` imports every router and assigns it to its key in `appRouter` —
alphabetical, `health` first. No conditionals, no spreads, no dynamic
imports, no `Object.assign`.

Nesting goes at most two levels (`coach.clients.list`). A third level means
the router is a feature in its own right and gets a top-level key instead —
§6.1 is the authoritative set of top-level keys.

Adding a router: create `apps/api/src/routers/<name>.ts` exporting
`<name>Router`, then add one import and one key to `index.ts`.
`router-registry.test.ts` fails the build if a file exists but isn't
registered.

## Procedure chain order (`error-and-validation/03`)

```
publicProcedure / coachProcedure / clientProcedure
     .input(schema)          ← parses; unknown keys rejected; caps applied
     .use(ownsResource(…))   ← needs parsed input — see authorization-middleware/03 step 1
     .output(schema)         ← optional, see the rule below
     .query / .mutation
```

`.input()` before the guard is load-bearing, not stylistic: chained the other way, the
guard's selector receives `unknown`, returns `undefined`, and rejects every request — which
gets "fixed" by deleting the guard instead of the chain order.

**Annotate the selector's parameter explicitly**, e.g. `ownsResource('workoutSession',
(i: { workoutSessionId: string }) => i.workoutSessionId)`. `ownsResource`'s generic input
type can't be inferred backward through the standalone call the way an _inline_ `.use()`
middleware's `input` can — TypeScript happily accepts the unannotated form with
`input: unknown` and no error, which silently defeats the guard's type safety. There is no
compiler error to catch a missing annotation; this is a review-time rule
(`authorization-middleware/03-owns-resource.md`'s own doc comment carries the same note).

## A public procedure needs an allowlist entry

A `publicProcedure` not on `../__tests__/authz-allowlist.ts` fails `authz.test.ts`. Adding a
row there is a security change — it needs a real, falsifiable reason and a second reviewer
(see the PR template checkbox). See that file's own header for the shape and the two checks
that keep it honest.

## When a procedure needs `.output()`

> A procedure needs an `.output()` schema when the row it reads from contains a column the
> caller must not receive. Otherwise it does not.

Output validation re-walks the response on every call — it's not free, so the rule is a
rule, not a blanket "always attach one". From DB§18 and CLAUDE.md §5.1:

| Returns                                          | Gate       | Because                                                                  |
| ------------------------------------------------ | ---------- | ------------------------------------------------------------------------ |
| `identity.users`                                 | required   | `password_hash`, `email` on a coach↔client boundary                      |
| `identity.client_profiles` to a coach            | required   | `injuries` is 🔴; an assistant (P25) may not see it                      |
| `identity.coach_client_notes`                    | required   | Never reachable by a client — the second lock                            |
| `coaching.media_assets`                          | required   | `storage_key` is an R2 path; the client gets a signed URL, never the key |
| `platform.audit_log`                             | required   | Carries `ip` and `user_agent`                                            |
| A computed aggregate (adherence, macros, counts) | not needed | Nothing on it came from a row                                            |

The gate schema lives next to the router that uses it — never in `packages/schemas`, which
the mobile client also imports and has no business validating a response it didn't send.
`../__tests__/output-redaction.test.ts` proves the gate strips what it doesn't name, and
proves the negative: the same resolver with no gate returns the field verbatim.

**Never spread a row into a response** (`return { ...row }`) — a column added in a later
migration becomes a disclosure with no code change and no review. Map fields explicitly;
the output schema catches the mistake when one is attached, explicit mapping catches it
when one isn't, and the two together are cheap.
