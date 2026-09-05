import { useAuthStore } from '../features/auth/store.ts';
import { resolveDeepLink } from '../features/navigation/deep-links/link-table.ts';
import { parseDeepLink } from '../features/navigation/deep-links/parse.ts';
import { holdPendingDeepLink } from '../features/navigation/deep-links/pending.ts';

// `phase-05-app-shell/deep-linking/02`. expo-router calls this with every
// incoming URL before its own file-based resolution runs. Composition only
// (`code-conventions` §1, the same rule every route file follows) — the
// parsing and the §9.3 table live under `features/navigation/deep-links/`,
// which is what makes both testable without a navigator.
//
// Synchronous by contract: expo-router awaits nothing here, so this can only
// ever use the role already in the store. At cold start there is none yet,
// and the table answers `needs-role` rather than guessing —
// `deep-linking/04` is what replays those once the auth gate has resolved.
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  const link = parseDeepLink(path);
  if (link === null) {
    // Not ours, or unreadable. Hand it back untouched so the router does
    // exactly what it would with no `+native-intent.ts` at all — a link
    // truncated by a messaging app's preview must cost a normal launch,
    // never a crash (this task's Risks section).
    return path;
  }

  const { status, role } = useAuthStore.getState();
  const target = resolveDeepLink(link, role);
  if (target.status === 'resolved') {
    return target.href;
  }

  // `deep-linking/04`. The cold-start case: the link is one of ours and
  // role-dependent, and the bootstrap has not answered yet. Park it — the
  // gate is about to redirect to a group root, and `PendingDeepLinkReplay`
  // navigates on top of that once it has.
  if (target.status === 'needs-role' && status === 'loading') {
    holdPendingDeepLink(link);
  }

  return path;
}
