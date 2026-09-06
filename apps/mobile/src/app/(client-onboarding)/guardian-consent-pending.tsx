import { GuardianConsentPendingScreen } from '../../features/onboarding/GuardianConsentPendingScreen.tsx';

// Composition, and nothing else (`CLAUDE.md` §9.2).
//
// ⚠️ **This route is in `(client-onboarding)`, not `(client)`, and that is a
// deliberate departure from `guardian-consent/06`'s Files table.** That task
// was written against a two-dimensional `AuthGate`; `onboarding-infrastructure/02`
// has since added a third — onboarded or not. A consent-pending minor has
// `onboarding_completed_at IS NULL` by construction (every step of the flow
// that would set it runs through a `clientProcedure` the gate is refusing),
// so `resolveAuthGate` resolves their permitted group to
// `(client-onboarding)`. A route under `(client)` would therefore be
// redirected straight out to `/(client-onboarding)` — onto onboarding step
// 2, which is the single outcome this whole feature exists to prevent.
//
// The task's stated reason for `(client)` — "so `AuthGate` still governs
// it" — holds here unchanged: this group is gated by the same component.
// Only the literal path moved.
export default function GuardianConsentPendingRoute() {
  return <GuardianConsentPendingScreen />;
}
