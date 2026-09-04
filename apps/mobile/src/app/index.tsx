import { Link } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { api } from '../lib/trpc.ts';

// The `health.ping` call proves the type flow end to end (03-mobile-trpc-client.md
// approach step 6) — `serverTime` arrives as a real `Date`, not a string.
// Temporary wiring on the temporary home screen; `phase-05-app-shell/` and
// `phase-06-onboarding/` replace both. The two links below exist only so
// `(auth)/sign-in` and `(auth)/sign-up` (`auth-client/05`) are reachable
// for manual verification before the real route gate
// (`phase-05-app-shell/providers-and-gates/`) redirects here automatically.
export default function HomeScreen() {
  const ping = api.health.ping.useQuery();

  return (
    <View style={styles.container}>
      <Text>CoachOS</Text>
      <Text>
        {ping.data
          ? `API: ${ping.data.status} @ ${ping.data.serverTime.toISOString()}`
          : 'Checking API…'}
      </Text>
      <Link href="/sign-in" style={styles.link}>
        Sign in
      </Link>
      <Link href="/sign-up" style={styles.link}>
        Create account
      </Link>
      {/* Proof the token pipeline is wired end to end (theme-tokens/02): if
          the border but not the fill renders, global.css's variable block
          is wrong; if neither renders, the preset isn't loading. Replaced by
          real screens in phase-05-app-shell. */}
      <View className="rounded-lg border border-border bg-bg-raised p-4">
        <Text className="text-fg">Token pipeline verified</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  link: {
    color: '#6366F1',
    fontWeight: '600',
  },
});
