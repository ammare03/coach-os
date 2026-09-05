import { Stack } from 'expo-router';

// Bare passthrough (`phase-05-app-shell/router-skeleton/01`), the (client)
// counterpart to (coach)/_layout.tsx. The focus modes — workout, scan,
// record-form-check, live — sit outside the tab layout by design
// (`screen-composition` §1.3), which is why they are siblings of (tabs)
// here and not children of it.
export default function ClientLayout() {
  return <Stack />;
}
