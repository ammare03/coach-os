import { Stack } from 'expo-router';

import { TRPCProvider } from '../lib/trpc-provider.tsx';

export default function RootLayout() {
  return (
    <TRPCProvider>
      <Stack />
    </TRPCProvider>
  );
}
