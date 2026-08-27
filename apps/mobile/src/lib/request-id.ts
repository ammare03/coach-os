import { uuidv7 } from 'uuidv7';

// `observability/05-request-correlation.md`: the device generates the
// correlation id, not the server — a request that never arrives still has
// an id the user can quote, which is exactly the case a server-generated id
// can't cover. `uuidv7` is not a new dependency choice made for this file:
// it's the same package `apps/api` and `packages/db` already use for row
// ids (DB§21), so the app gains one ID scheme, not a second one. It has no
// Node-builtin dependency (falls back to `Math.random()` when no global
// `crypto.getRandomValues` is present, which is fine here — this id carries
// no security meaning, only correlation, per step 7 below) so it bundles
// through Metro with no polyfill.
//
// Step 7: "it carries no meaning" — a bare UUID, never composed from user id
// or a timestamp. An id that encodes identity is personal data appearing on
// every log line, which is exactly what DB§18 forbids.
export function generateRequestId(): string {
  return uuidv7();
}

// Deferred: tagging the client-side Sentry event with this same id
// (`05-request-correlation.md` step 5, "server and client"). There is no
// `@sentry/react-native` integration in this app yet
// (`phase-05-app-shell/providers-and-gates/05` builds it) — when it lands,
// the trpc-links.ts error/logger link should call `generateRequestId()` up
// front and set it as a Sentry scope tag the same way `../lib/sentry.ts`
// does server-side, rather than each call site tagging it individually.
