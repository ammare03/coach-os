import { useRouter } from 'expo-router';

import { YourDataScreen } from '../features/settings/screens/YourDataScreen.tsx';

// `YourDataScreen` (`account-lifecycle/10`) was built before there was a
// settings route tree to hang it on, so nothing reached it. This exposes it
// at a flat path purely so it can be opened on a device for visual review;
// `phase-05-app-shell/router-skeleton/` gives it its real home under
// settings, and this file goes away then.
export default function YourDataRoute() {
  const router = useRouter();
  return <YourDataScreen onBack={() => router.back()} />;
}
