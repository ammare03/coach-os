import { useRouter } from 'expo-router';

import { DeleteAccountScreen } from '../features/settings/screens/DeleteAccountScreen.tsx';

// Composition, and nothing else (`code-conventions` §1.3).
//
// A flat route, for the same reason `your-data.tsx` and
// `medical-disclaimer.tsx` are: there is a single screen here, reached from
// both roles' settings, and two routes under two groups would be two copies
// to keep in step. `account-actions/02` calls for exactly this ("a
// role-agnostic root route like `/your-data`, so P28's org admin reaches
// the same one").
export default function DeleteAccountRoute() {
  const router = useRouter();
  return <DeleteAccountScreen onBack={() => router.back()} />;
}
