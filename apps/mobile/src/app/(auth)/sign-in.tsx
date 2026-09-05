import { SignInScreen } from '../../features/auth/screens/SignInScreen.tsx';

// Composition only (`CLAUDE.md` §9.2). The screen this used to draw inline
// moved to the auth feature slice unchanged — see `SignInScreen`'s own
// comment.
export default function SignInRoute() {
  return <SignInScreen />;
}
