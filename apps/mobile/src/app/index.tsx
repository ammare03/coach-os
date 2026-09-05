import { AuthHomeRedirect } from '../features/auth/AuthGate.tsx';

// CLAUDE.md §9.1's tree has no root index, but expo-router needs one: with
// no `/` route the app opens on `+not-found`. So this file survives as the
// tree's entry point and nothing else — composition only, per §9.2.
//
// The destination is no longer a placeholder decision. `providers-and-
// gates/03` replaced the hardcoded `/(auth)/welcome` redirect that used to
// live here with the real one: session present → that role's group, session
// absent → (auth). The hardcoded version is what made every sign-in path's
// `router.replace('/')` bounce straight back into (auth).
export default function IndexScreen() {
  return <AuthHomeRedirect />;
}
