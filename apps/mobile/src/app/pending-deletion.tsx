import { PendingDeletionScreen } from '../features/auth/screens/PendingDeletionScreen.tsx';

// Composition, and nothing else.
//
// A flat route rather than one inside `(coach)` or `(client)`: a pending
// deletion is the same blocking state for every role, and putting it in a
// group would mean two copies and, worse, a screen governed by the group
// gate it is supposed to sit in front of.
//
// It has no back affordance and there is nothing to pass it — the way out
// is the three exits the screen itself renders (`UI-UX.md` §UX1.3).
export default function PendingDeletionRoute() {
  return <PendingDeletionScreen />;
}
