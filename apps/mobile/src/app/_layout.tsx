import { Stack } from 'expo-router';

import { TRPCProvider } from '../lib/trpc-provider.tsx';

export default function RootLayout() {
  return (
    <TRPCProvider>
      {/* No screen in this app uses the native header yet — every route
          builds its own chrome (the (auth) group's glass nav bar, this
          placeholder's plain body). `phase-05-app-shell/router-skeleton/`
          revisits this once a screen actually needs one. */}
      <Stack screenOptions={{ headerShown: false }} />
    </TRPCProvider>
  );
}
