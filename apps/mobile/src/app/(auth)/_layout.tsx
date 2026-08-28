import { Stack } from 'expo-router';

// Minimal (auth) group shell, built ahead of `phase-05-app-shell/router-
// skeleton/02` to unblock `phase-03-identity-and-auth/auth-client/05` —
// see that task's own file table, which expects this group to already
// exist. `headerShown: false` because both screens draw their own glass
// nav bar (`GlassSurface`, DS§12.1) rather than the native header.
export default function AuthLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="sign-in" />
      <Stack.Screen name="sign-up" />
      <Stack.Screen name="complete-social-signup" />
    </Stack>
  );
}
