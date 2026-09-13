import { useHistorySharing } from '../../../features/settings/hooks/useHistorySharing.ts';
import { HistorySharingScreen } from '../../../features/settings/screens/HistorySharingScreen.tsx';

/**
 * `relationship-controls/03` — **Settings → What {coach} can see**.
 *
 * Composition only (`code-conventions` §1): the hook owns the read, the
 * write and the optimistic rollback; the screen owns everything drawn.
 * Client-only, so it lives under `(client)/settings/` rather than flat —
 * a coach has no coach, and `SettingsStack` is shared by both groups.
 *
 * An ordinary `Stack.Screen` push, so it inherits the native header, the
 * back gesture and the "Settings" back label from
 * `features/settings/navigation/SettingsStack.tsx`. The title is the one
 * piece of chrome the screen sets for itself, because it names the coach.
 */
export default function ClientSharingRoute() {
  return <HistorySharingScreen {...useHistorySharing()} />;
}
