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
