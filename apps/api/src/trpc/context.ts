// Placeholder shape only — `02-request-context.md` adds the real `createContext`
// factory (user resolution, db/redis singletons, requestId). Declaring the type here
// lets `initTRPC.context<Context>()` bind now without task 02's Redis/auth wiring.
export interface Context {
  user: null;
}
