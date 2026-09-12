// `account-actions/02` Approach step 6 — the week between the request and
// the purge, and Ammar's decision for what the app does during it: a
// **blocking state** with exactly three exits, enforced on the server by
// `pendingDeletionGate` throwing `ACCOUNT_PENDING_DELETION`.
//
// The reason it blocks rather than warns: a coach who has asked to leave
// does not spend a week half-coaching clients who are about to be detached,
// and a client whose data is on its way out should not keep adding to it.
//
// `UI-UX.md` §UX1.3 — a blocking state must have a route out. This one has
// three: **Restore** (primary, because it is what most people who reach
// this screen came for), **Export your data**, and **Sign out**. There is no
// fourth, and deliberately no way to re-request deletion: the date is
// already fixed and `me.requestDeletion` is idempotent, so a second request
// would change nothing while looking like it had.
import {
  Button,
  Card,
  Divider,
  Text,
  createThemedStyles,
  density as densityTokens,
  spacing,
  useTheme,
  type Density,
} from '@coachos/ui';
import { useRouter } from 'expo-router';
import { Calendar, Clock, Mail, RotateCcw, Users, WifiOff } from 'lucide-react-native';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useConnectivity } from '../../../lib/connectivity/useConnectivity.ts';
import { api } from '../../../lib/trpc.ts';
import { UnsyncedWorkPrompt } from '../components/UnsyncedWorkPrompt.tsx';
import { useSignOutFlow } from '../hooks/useSignOutFlow.ts';
import { useAuthStore } from '../store.ts';

/**
 * The purge instant, as a date in the account holder's own timezone.
 *
 * **Absolute, never a countdown** (`CLAUDE.md` §25.13): iOS suspends JS the
 * instant the screen locks, so "6 days left" is wrong by however long the
 * phone stayed in a pocket — and wrong in the direction that costs someone
 * their data.
 *
 * `users.timezone`, not the device's: a client in Kolkata whose phone is on
 * UTC would otherwise be told a date a day early. The same zone
 * `send-deletion-recovery-email.ts` formatted the email in, so the two
 * agree. Not `date-fns` — it is not a dependency of `apps/mobile`, and this
 * is an instant rendered for a human, not a training-day computation
 * (`code-conventions` §6 governs the latter, not this).
 */
export function formatPurgeDate(at: Date, timeZone: string): string {
  return at.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone,
  });
}

export function PendingDeletionScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const themed = useThemedStyles();
  const { isConnected } = useConnectivity();
  const utils = api.useUtils();
  const signOutFlow = useSignOutFlow();

  // The same rule every settings surface follows: role from the auth store,
  // never from a query that may still be in flight.
  const role = useAuthStore((state) => state.role);
  const isCoach = role === 'coach' || role === 'assistant';
  const density: Density = isCoach ? 'coach' : 'client';
  const gutter = densityTokens[density].gutter;

  const me = api.me.get.useQuery();
  const scheduledFor = me.data?.deletionScheduledFor ?? null;
  const timeZone = me.data?.timezone ?? null;

  const restore = api.me.cancelDeletion.useMutation({
    onSuccess: () => {
      // `me.get` no longer carries a `deletionScheduledFor`, which is what
      // `PendingDeletionRedirect` reads. Route home rather than `back()`:
      // this screen replaced whatever was there, and `/` resolves the
      // restored session's own group (`AuthHomeRedirect`).
      void utils.me.get.invalidate();
      router.replace('/');
    },
  });

  const offlineReason =
    'Restoring needs a connection. Your account is not removed before the date above, so there is time.';
  const canRestore = isConnected && !restore.isPending;

  const glyph = (Icon: typeof Clock) => <Icon size={12} color={theme.colors.brand.DEFAULT} />;

  return (
    <View style={[styles.screen, themed.screen]} testID="pending-deletion-screen">
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingHorizontal: gutter,
            paddingTop: insets.top + spacing(26),
            gap: densityTokens[density].sectionGap,
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.hero, themed.hero]}>
          {/* `fg.warm`, NOT `urgent-text`. The prototype drew this glyph in
              the urgent accent and that is the one thing in it this screen
              does not copy: green/amber/red are reserved for adherence state
              and may never be decorative (`ui-conventions` §2), and the
              heading beside it already carries the whole meaning in words.
              A rose clock here would put an adherence signal on a screen
              that has nothing to do with adherence, one scroll away from a
              coach's dashboard. */}
          <View style={[styles.heroGlyph, themed.heroGlyph]}>
            <Clock size={24} color={theme.colors.fg.warm} />
          </View>
          <Text size="eyebrow" tone="warm-muted" style={styles.eyebrow}>
            Account
          </Text>
          <Text size={isCoach ? 'h1' : 'h1-client'} tone="bright" accessibilityRole="header">
            Your account is scheduled for deletion
          </Text>
          <Text size={isCoach ? 'body' : 'body-lg'} tone="warm-muted" style={styles.lede}>
            {isCoach
              ? 'Nothing has been removed and no client has been told. Restoring puts everything back exactly as it was.'
              : 'Nothing has been removed yet. Restoring puts everything back exactly as it was.'}
          </Text>
          {scheduledFor !== null && timeZone !== null ? (
            <View style={[styles.date, themed.inset]}>
              <Calendar size={14} color={theme.colors.fg.warm} />
              <Text size="label" tone="warm" testID="pending-deletion-date">
                {`Removed on ${formatPurgeDate(scheduledFor, timeZone)}`}
              </Text>
            </View>
          ) : null}
        </View>

        <Card>
          {isCoach ? (
            <>
              <Row
                icon={glyph(Users)}
                title="Your clients are told on that date"
                body="Each then has 30 days to export their history before they are detached. They keep their own data."
                borderColor={theme.colors.border.strong}
              />
              <Divider />
              <Row
                icon={glyph(RotateCcw)}
                title="Restoring takes one tap"
                body="Coaching resumes exactly where it stopped — programs, clients, messages, all of it."
                borderColor={theme.colors.border.strong}
              />
            </>
          ) : (
            <>
              <Row
                icon={glyph(RotateCcw)}
                title="Restoring takes one tap"
                body="Your workouts, meals, photos and messages are all still here until the date above."
                borderColor={theme.colors.border.strong}
              />
              <Divider />
              <Row
                icon={glyph(Mail)}
                title="The link in your email works too"
                body="Either one restores the same account. You do not need both."
                borderColor={theme.colors.border.strong}
              />
            </>
          )}
        </Card>
      </ScrollView>

      {/* Pinned, and never dependent on a query resolving
          (`screen-composition` §3.3): sign out is reachable in every state,
          including the one where `me.get` could not be reached at all. */}
      <View
        style={[
          styles.actions,
          { paddingHorizontal: gutter, paddingBottom: insets.bottom + spacing(20) },
        ]}
      >
        <Button
          size="lg"
          fullWidth
          density={density}
          onPress={() => restore.mutate()}
          disabled={!canRestore}
          loading={restore.isPending}
          accessibilityLabel={
            isConnected ? 'Restore my account' : `Restore my account. ${offlineReason}`
          }
          testID="pending-deletion-restore"
        >
          Restore my account
        </Button>

        {/* `account-lifecycle/11`'s own offline rule — the export screen
            cannot start a build with no connection either, so the door to
            it is closed here rather than opening onto a dead end. */}
        <Button
          variant="secondary"
          size="lg"
          fullWidth
          density={density}
          onPress={() => router.push('/your-data')}
          disabled={!isConnected}
          accessibilityLabel={
            isConnected
              ? 'Export your data'
              : 'Export your data. Building an export needs a connection.'
          }
          testID="pending-deletion-export"
        >
          Export your data
        </Button>

        {/* Task 01's flow, unchanged: it works offline, and it is the one
            exit on this screen that never depends on the network. */}
        <Button
          variant="ghost"
          size="lg"
          fullWidth
          density={density}
          onPress={signOutFlow.requestSignOut}
          loading={signOutFlow.isSigningOut}
          accessibilityLabel="Sign out"
          testID="pending-deletion-sign-out"
        >
          Sign out
        </Button>

        {!isConnected ? (
          <View style={styles.hint}>
            <WifiOff size={15} color={theme.colors.fg.muted} />
            <Text size="body-sm" tone="muted" style={styles.hintText}>
              {offlineReason}
            </Text>
          </View>
        ) : null}

        {restore.isError ? (
          <View style={styles.hint} accessibilityLiveRegion="polite" accessibilityRole="alert">
            <Text size="body-sm" tone="muted" style={styles.hintText}>
              That didn’t go through, and your account is unchanged. Try again.
            </Text>
          </View>
        ) : null}
      </View>

      <UnsyncedWorkPrompt
        pendingCount={signOutFlow.pendingCount}
        onKeepSignedIn={signOutFlow.keepSignedIn}
        onDiscard={signOutFlow.discardAndSignOut}
        isDiscarding={signOutFlow.isSigningOut}
        testID="pending-deletion-unsynced-work"
      />
    </View>
  );
}

/** One fact row. Local, one consumer (`code-conventions` §1). */
function Row({
  icon,
  title,
  body,
  borderColor,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  borderColor: string;
}) {
  return (
    <View style={styles.row}>
      <View style={[styles.rowGlyph, { borderColor }]}>{icon}</View>
      <View style={styles.flex}>
        <Text size="label">{title}</Text>
        <Text size="body-sm" tone="muted" style={styles.rowBody}>
          {body}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  screen: { flex: 1 },
  content: { paddingBottom: spacing(20), flexGrow: 1 },
  // `DESIGN.md` §1.4's 22px section radius.
  hero: { borderRadius: 22, padding: spacing(20), borderWidth: 1 },
  heroGlyph: {
    width: 56,
    height: 56,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    marginBottom: spacing(16),
  },
  // §1.2 — the eyebrow is the one thing in the product that is uppercased.
  eyebrow: { textTransform: 'uppercase', marginBottom: spacing(10) },
  lede: { marginTop: spacing(10) },
  date: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing(8),
    marginTop: spacing(14),
    paddingVertical: spacing(10),
    paddingHorizontal: spacing(14),
    borderRadius: 12,
    borderWidth: 1,
  },
  row: { flexDirection: 'row', gap: spacing(12), padding: spacing(16) },
  rowGlyph: {
    width: 22,
    height: 22,
    borderRadius: 7,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  rowBody: { marginTop: spacing(3) },
  actions: { paddingTop: spacing(10), gap: spacing(10) },
  hint: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing(7), paddingHorizontal: 6 },
  hintText: { flex: 1 },
});

const useThemedStyles = createThemedStyles((theme) => ({
  screen: { backgroundColor: theme.colors.bg.DEFAULT },
  hero: { backgroundColor: theme.colors.bg.raised, borderColor: theme.colors.border.tinted },
  heroGlyph: { backgroundColor: theme.colors.bg.inset, borderColor: theme.colors.border.strong },
  inset: { backgroundColor: theme.colors.bg.inset, borderColor: theme.colors.border.strong },
}));
