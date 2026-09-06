// The only module in the repo that reads `WEB_API_URL`, and the only place
// `apps/web` talks to `apps/api` (`guardian-consent/05`).
//
// A plain `fetch` rather than `@trpc/client` + `superjson`: one mutation,
// one call, no cache, no types crossing the wire. Adding two dependencies
// to `apps/web` for a single POST is what CLAUDE.md §3.4.1 step 2 exists to
// stop. The wire shapes below are tRPC v11 + superjson's, transcribed and
// covered by `confirm.test.ts` — that test is what catches the transformer
// changing under us.
//
// This module is never imported by `page.tsx`. It is reachable only from
// `actions.ts`, which runs on POST. A `GET` must leave the token unconsumed
// (`05` Approach step 2) — link scanners and corporate mail gateways fetch
// URLs before the human does, and this token is single-use.

/** The tRPC mount path, fixed by `apps/api/src/trpc/handler.ts`'s `TRPC_ENDPOINT`. */
const TRPC_ENDPOINT = '/trpc';

const PROCEDURE = 'invites.confirmGuardianConsent';

const TIMEOUT_MS = 10_000;

/**
 * Task `02`'s three outcomes, plus one this side owns.
 *
 * `unavailable` is not a fourth server outcome — it is "we could not ask".
 * It must never collapse into `invalid`: telling a parent holding a
 * perfectly good link that it has expired sends them to a resend they do
 * not need, and the real link is still live and still single-use.
 */
export type GuardianConsentOutcome =
  | { outcome: 'confirmed'; clientName: string }
  | { outcome: 'already_confirmed' }
  | { outcome: 'invalid' }
  | { outcome: 'unavailable' };

function readProp(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null) return undefined;
  return (value as Record<string, unknown>)[key];
}

/** `{ result: { data: { json: <the procedure's return value> } } }`. */
function parseOutcome(body: unknown): GuardianConsentOutcome | null {
  const data = readProp(readProp(readProp(body, 'result'), 'data'), 'json');
  const outcome = readProp(data, 'outcome');

  if (outcome === 'confirmed') {
    const clientName = readProp(data, 'clientName');
    return typeof clientName === 'string' && clientName.length > 0
      ? { outcome: 'confirmed', clientName }
      : null;
  }
  if (outcome === 'already_confirmed') return { outcome: 'already_confirmed' };
  if (outcome === 'invalid') return { outcome: 'invalid' };
  return null;
}

function apiBaseUrl(): string {
  const value = process.env.WEB_API_URL;
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('WEB_API_URL is not set — apps/web cannot reach the API.');
  }
  return value.replace(/\/+$/, '');
}

/**
 * Spends the token. Called from a server action on an explicit POST, never
 * on render.
 *
 * Anything that is not one of task `02`'s three documented outcomes —
 * a transport failure, a timeout, a tRPC error envelope (`RATE_LIMITED`
 * included), a body we cannot read — becomes `unavailable`, which the page
 * renders as "try again", with the button still there.
 */
export async function confirmGuardianConsent(token: string): Promise<GuardianConsentOutcome> {
  // Outside the try: a missing `WEB_API_URL` is a deploy fault, not a
  // transport one, and must not hide behind a "try again" page.
  const url = `${apiBaseUrl()}${TRPC_ENDPOINT}/${PROCEDURE}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // superjson's serialised form. `token` is a plain string, so there is
      // no `meta` envelope to build and nothing to deserialise on the way
      // back — which is exactly why the transformer package isn't needed.
      body: JSON.stringify({ json: { token } }),
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return { outcome: 'unavailable' };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { outcome: 'unavailable' };
  }

  return parseOutcome(body) ?? { outcome: 'unavailable' };
}
