import { useRouter } from 'expo-router';

import { MedicalDisclaimerScreen } from '../features/settings/screens/MedicalDisclaimerScreen.tsx';

// `CLAUDE.md` §21.3 requires the disclaimer to be reachable from settings —
// both settings screens, coach and client. A flat route rather than one
// under each group, for the same reason `your-data.tsx` is one: there is a
// single screen here, identical for both roles, and two routes would be two
// copies to keep in step. The phase that builds the real settings screens
// gives it a home under each of them.
export default function MedicalDisclaimerRoute() {
  const router = useRouter();
  return <MedicalDisclaimerScreen onBack={() => router.back()} />;
}
