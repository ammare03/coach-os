import { WelcomeScreen } from '../../features/auth/screens/WelcomeScreen.tsx';

// The `(auth)` group's entry point — `src/app/index.tsx` redirects here
// until `providers-and-gates/03` puts the real gate in front of it.
// Composition only (`CLAUDE.md` §9.2).
export default function WelcomeRoute() {
  return <WelcomeScreen />;
}
