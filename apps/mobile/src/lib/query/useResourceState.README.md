# `useResourceState` — the id-route render decision

> **Every route that takes an id uses this.** `CLAUDE.md` §9.2 requires loading, not-found,
> and forbidden to be three distinct states on such a route, and this is the one place the
> mapping from a tRPC failure to those states is decided. A feature phase that re-derives it
> will get it wrong in a way review does not catch — the states differ only in copy, and the
> wrong one is a working screen.

Built by `.claude/plan/phase-05-app-shell/navigation-primitives/03-forbidden-state.md`.
It is a pure function, `use`-prefixed because it is called during render next to the query
hook it wraps.

---

## 1. Signature

```ts
function useResourceState<TData>(query: ResourceQueryLike<TData>): ResourceState<TData>;

interface ResourceQueryLike<TData> {
  data: TData | undefined;
  error: unknown;
}

type ResourceState<TData> =
  | { state: 'loading' }
  | { state: 'notFound'; code: AppErrorCode | null; error: unknown }
  | { state: 'forbidden'; code: AppErrorCode | null; error: unknown }
  | { state: 'error'; code: AppErrorCode | null; error: unknown }
  | { state: 'success'; data: TData; refetchError: unknown };
```

The input is a structural slice, not `UseQueryResult` — every TanStack result (query,
infinite query, suspense query) and every hand-built test fixture satisfies it. `TData` is
inferred; nothing needs a cast on the way in or on the way out.

`code` is the catalogued `AppErrorCode` when the server sent one, and `null` when it did not
(a network failure, or a transport-level 403/404 with no `appCode`). Use it to specialise
copy — `FEATURE_NOT_IN_TIER` should offer an upgrade path where `ROLE_REQUIRED` should not —
never to decide the state, which is already decided.

---

## 2. Five states, not four

`CLAUDE.md` §9.2 names three failure states and `packages/ui` ships one component for each.
`error` is the fifth member, and it is not an oversight: a `RATE_LIMITED`, an
`INTERNAL_ERROR`, or a dead socket is none of the four. Folding it into `notFound` tells the
user a resource was deleted when it was not; folding it into `loading` hangs the screen
forever. Both are the silent swallow `code-conventions` §8 forbids, so it gets its own state
and the caller has to render something for it.

---

## 3. The mapping

The transport code decides the state, and `APP_ERROR_TRPC_CODE` in `@coachos/schemas`
**is** the mapping — this module reads it rather than keeping a list. A code added to that
catalogue with `NOT_FOUND` or `FORBIDDEN` against it reaches the right state the day it is
added, with no change here and no change in your feature.

| tRPC transport code | State       | Catalogued codes that reach it today                                                                                         |
| ------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `NOT_FOUND`         | `notFound`  | `NOT_YOUR_CLIENT`, `INVITE_NOT_FOUND`, `EXPORT_NOT_FOUND`, `DEPENDENT_NOT_FOUND`                                             |
| `FORBIDDEN`         | `forbidden` | `FEATURE_NOT_IN_TIER`, `ROLE_REQUIRED`, `RECORDING_CONSENT_REQUIRED`, the four age/guardian codes                            |
| anything else       | `error`     | `RATE_LIMITED`, `INTERNAL_ERROR`, `VALIDATION_FAILED`, `SYNC_CONFLICT`, `AUTH_REQUIRED`, every `BAD_REQUEST`/`CONFLICT` code |

Resolution order, both covered by tests:

1. `getErrorCode(error)` (`../error-code.ts`) → `APP_ERROR_TRPC_CODE[code]`. The normal path.
2. Failing that, the wire's own `data.code` / `data.httpStatus`. Covers a procedure the server
   does not have, a gateway 403, and an old build talking to a newer API.

### Two codes worth knowing about before you write the copy

- **`AUTH_REQUIRED` is `UNAUTHORIZED`, not `FORBIDDEN`,** so it lands in `error`, not
  `forbidden`. It belongs to the auth gate — refresh the session, then sign out — and a
  screen that renders `ForbiddenState` for it is telling a signed-out user their account
  lacks a permission it has.
- **`RATE_LIMITED` lands in `error` too,** and `lib/rate-limit-handling.ts`'s central
  `QueryCache.onError` has already shown the toast for it by the time you render. Do not
  show a second message.

### Which component each state renders

| State       | Component from `@coachos/ui`                                                                                                                                                                                                                       |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `loading`   | `LoadingState` (`accessibilityLabel` is required)                                                                                                                                                                                                  |
| `notFound`  | `NotFoundState` (`onRecover` is required — no dead ends)                                                                                                                                                                                           |
| `forbidden` | `ForbiddenState` (`onRecover` is required)                                                                                                                                                                                                         |
| `error`     | Your section's error fallback — one line and a retry, sized like the content it replaces (`UI-UX.md` §UX4.2). There is no `ErrorState` component; a page-level failure is the only one allowed to take the whole screen (`screen-composition` §3). |
| `success`   | Your content                                                                                                                                                                                                                                       |

**Do not swap `NotFoundState` for `ForbiddenState`, or the reverse, "to be safe".** Which of
the two a foreign resource gets is
the API's decision, not the screen's — a client that softens a 403 into a 404, or hardens a
404 into a 403, makes the two surfaces disagree about what the user is being told.

> ### `NOT_YOUR_CLIENT` is `notFound`, on purpose
>
> An `ownsResource` failure — another coach's client, or an id that never existed — travels as
> `NOT_FOUND` with `ERRORS.md`'s genuine-404 copy (ER§2.1), so a 403 never confirms a foreign
> row exists. This hook therefore returns `notFound` for it, and a screen must render
> `NotFoundState`, not `ForbiddenState`. The catalogue carried `FORBIDDEN` until 6 Sep 2026;
> the decision that settled it is recorded in `docs/UNFORGET.md` (S16).

---

## 4. Precedence when there is a cached copy

TanStack sets `status: 'error'` on a **failed background refetch** while keeping the data it
already had. Three rules, all tested:

1. **`forbidden` and `notFound` win over the cache, always.** A client who left their coach,
   or a resource that was deleted, must stop rendering the moment the server says so — not
   on the next cold start.
2. **A generic error with a cached copy stays `success`,** and the failure is handed back as
   `refetchError`. `UI-UX.md` §UX4's offline row: cached content plus a calm banner, never an
   error. Blanking a working screen because the gym has no signal is the wrong trade.
3. **A generic error with no cached copy is `error`.** Nothing to fall back to.

`refetchError` is `null` on a clean success. If your screen has a stale/offline banner, this
is what drives it; ignoring it is allowed, dropping the state is not.

---

## 5. Worked example

The switch lives in the **feature-slice component**. The route file composes and nothing else
(`CLAUDE.md` §9.2, `code-conventions` §1) — a `useState`, a query, or this switch inside
`app/**` is a review blocker.

### `apps/mobile/src/features/clients/api.ts`

```ts
import { api } from '../../lib/trpc.ts';

export function useClientDetail(clientId: string) {
  return api.clients.get.useQuery({ clientId });
}
```

### `apps/mobile/src/features/clients/components/ClientDetailScreen.tsx`

```tsx
import { ForbiddenState, LoadingState, NotFoundState, Text } from '@coachos/ui';
import { useRouter } from 'expo-router';

import { useResourceState } from '../../../lib/query/useResourceState.ts';
import { useClientDetail } from '../api.ts';

export function ClientDetailScreen({ clientId }: { clientId: string }) {
  const router = useRouter();
  const query = useClientDetail(clientId);
  const resource = useResourceState(query);
  const goBack = () => router.back();

  switch (resource.state) {
    case 'loading':
      // Name what is loading — "Loading" alone is silent to a screen reader.
      return <LoadingState shape="detail" accessibilityLabel="Loading client" />;

    case 'notFound':
      return <NotFoundState onRecover={goBack} />;

    case 'forbidden':
      // `code` specialises the way out; it never decides the state.
      return resource.code === 'FEATURE_NOT_IN_TIER' ? (
        <ForbiddenState onRecover={() => router.push('/settings/plan')} recoverLabel="See plans" />
      ) : (
        <ForbiddenState onRecover={goBack} />
      );

    case 'error':
      return <ClientDetailError onRetry={() => void query.refetch()} />;

    case 'success':
      return (
        <>
          {resource.refetchError !== null ? <OfflineBanner /> : null}
          <Text>{resource.data.displayName}</Text>
        </>
      );
  }
}
```

The `switch` is exhaustive with no `default`. That is deliberate: adding a state to
`ResourceState` fails `pnpm check` at every call site instead of falling through to a blank
screen.

### `apps/mobile/app/(coach)/clients/[clientId].tsx`

```tsx
import { useLocalSearchParams } from 'expo-router';

import { ClientDetailScreen } from '../../../src/features/clients/components/ClientDetailScreen.tsx';

export default function ClientDetailRoute() {
  const { clientId } = useLocalSearchParams<{ clientId: string }>();
  return <ClientDetailScreen clientId={clientId} />;
}
```

That is the whole route file. It reads the param and renders the feature component — it holds
no query, no switch, and no knowledge that `forbidden` exists.

---

## 6. Adoption checklist

- [ ] The query lives in the feature slice's `api.ts`, never in the component and never in the route.
- [ ] The `switch` lives in the feature component. The route file only reads params and renders.
- [ ] All five cases handled, exhaustively, with no `default`.
- [ ] `LoadingState` names what is loading; `NotFoundState`/`ForbiddenState` each have a real
      `onRecover` — neither may be a dead end.
- [ ] `error` renders something sized like the content it replaced, with a retry.
- [ ] `refetchError` either drives a banner or is consciously ignored.
- [ ] The state is never chosen from `error.message`, an HTTP status you read yourself, or a
      `try/catch` around the query. If you need a distinction this hook does not make, the
      answer is a new code in `@coachos/schemas`' catalogue, not a local special case.

---

## 7. Where a screen is more than one query

`screen-composition` §3: a boundary wraps a **section**, not the page, and only the primary
content may fail the whole screen. Call `useResourceState` once per query and let each
section switch on its own result. The page-level `notFound`/`forbidden` decision belongs to
the query that fetches the entity the route is about — a failing chart never renders
`NotFoundState` over the client's whole week.
