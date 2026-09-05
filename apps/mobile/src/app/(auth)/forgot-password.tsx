import { useRouter } from 'expo-router';

import { ForgotPasswordScreen } from '../../features/auth/screens/ForgotPasswordScreen.tsx';

// Composition plus the one navigation call the screen needs — the same
// shape `src/app/your-data.tsx` already uses (`CLAUDE.md` §9.2).
export default function ForgotPasswordRoute() {
  const router = useRouter();
  return <ForgotPasswordScreen onBack={() => router.back()} />;
}
