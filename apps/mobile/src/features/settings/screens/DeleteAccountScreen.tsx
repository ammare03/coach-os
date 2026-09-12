// `account-actions/02` — the second of three taps, and everything a person
// needs to make the decision, on one screen.
//
// **What is not here is the design.** There is no "Continue" step, no
// reason picker, no "before you go" offer, and no second confirmation:
// `CLAUDE.md` §21.4 puts the whole flow at three taps from the settings
// root, and each of those would be the fourth. Nor is there a sentence
// anywhere that asks the person to stay — on a data-rights screen a
// retention plea is arguably an obstruction of the right under GDPR, not
// merely bad tone (`account-lifecycle/11`'s Risks, which apply here twice
// as hard).
//
// Pattern F, detail read (`UI-UX.md` §UX2), same shape as
// `MedicalDisclaimerScreen`: a Liquid Glass nav bar over the words, one
// destructive action pinned at the foot. Nothing on it depends on a query —
// the facts are constants and the role comes from the auth store — so it
// has no loading, empty, or error state for the thing a person came here to
// read (`screen-composition` §3: the primary action never depends on a
// query).
import {
  Button,
  Card,
  Divider,
  GlassSurface,
  Pressable,
  Text,
  createThemedStyles,
  density as densityTokens,
  spacing,
  useTheme,
  type Density,
} from '@coachos/ui';
import { useRouter } from 'expo-router';
import { Check, ChevronLeft, Clock, Download, Trash2, Users, WifiOff } from 'lucide-react-native';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuthStore } from '../../auth/store.ts';
import { DeleteAccountConfirm } from '../components/DeleteAccountConfirm.tsx';
import { useDeleteAccount } from '../hooks/useDeleteAccount.ts';

export interface DeleteAccountScreenProps {
  onBack: () => void;
}

const NAV_BAR_HEIGHT = 56;

/**
 * One fact, taken from the purge order itself (`DATABASE.md` DB§19.2) so
 * the copy can be specific rather than vague-and-safe. A local component:
 * one consumer, and `code-conventions` §1 promotes on the second.
 */
function Fact({
  icon,
  title,
  body,
  density,
  borderColor,
  isSubsequent = false,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  density: Density;
  borderColor: string;
  isSubsequent?: boolean;
}) {
  return (
    <>
      {isSubsequent ? <Divider /> : null}
      <View style={[styles.fact, { paddingVertical: density === 'coach' ? 13 : 15 }]}>
        <View style={[styles.factGlyph, { borderColor }]}>{icon}</View>
        <View style={styles.flex}>
          <Text size="label">{title}</Text>
          <Text size="body-sm" tone="muted" style={styles.factBody}>
            {body}
          </Text>
        </View>
      </View>
    </>
  );
}

export function DeleteAccountScreen({ onBack }: DeleteAccountScreenProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const themed = useThemedStyles();
  const deletion = useDeleteAccount();
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);

  // Role from the auth store, never `me.get`: the profile query can still be
  // in flight while this renders, and gating on it would paint the wrong
  // role's consequences for a frame. An assistant coach is a coach here —
  // their deletion detaches clients exactly as a root's does.
  const role = useAuthStore((state) => state.role);
  const isCoach = role === 'coach' || role === 'assistant';
  const density: Density = isCoach ? 'coach' : 'client';
  const gutter = densityTokens[density].gutter;

  const glyph = (Icon: typeof Clock) => <Icon size={12} color={theme.colors.brand.DEFAULT} />;

  const offlineReason =
    'Deleting an account needs a connection. Nothing is queued up to happen later.';

  return (
    <View style={[styles.screen, themed.screen]} testID="delete-account-screen">
      <GlassSurface
        tier="tier1"
        style={[styles.navBar, { paddingTop: insets.top, height: NAV_BAR_HEIGHT + insets.top }]}
      >
        <View style={[styles.navBarContent, { paddingHorizontal: gutter }]}>
          <Pressable
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel="Back"
            hitSlop={12}
            style={styles.backButton}
          >
            <ChevronLeft size={22} color={theme.colors.fg.DEFAULT} />
          </Pressable>
          <Text size="title">Delete account</Text>
        </View>
      </GlassSurface>

      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingHorizontal: gutter,
            paddingTop: NAV_BAR_HEIGHT + insets.top + spacing(20),
            gap: densityTokens[density].sectionGap,
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View>
          <Text size={isCoach ? 'h1' : 'h1-client'} tone="bright" accessibilityRole="header">
            Delete your account
          </Text>
          {/* The reassurance is a fact about the mechanism, not a plea. */}
          <Text size={isCoach ? 'body' : 'body-lg'} tone="muted" style={styles.lede}>
            Nothing is removed for 7 days. You can restore your account from inside the app at any
            point in that week.
          </Text>
        </View>

        <Card>
          {isCoach ? (
            <>
              <Fact
                icon={glyph(Users)}
                title="Your clients are told, and have 30 days to export"
                body="After the 7 days, each client is emailed and keeps full access for 30 days so they can take a copy of their history."
                density={density}
                borderColor={theme.colors.border.strong}
              />
              <Fact
                icon={glyph(Check)}
                title="They keep their own data"
                body="Training history, meals, measurements and photos belong to the client. They are detached from you, not deleted with you."
                density={density}
                borderColor={theme.colors.border.strong}
                isSubsequent
              />
              <Fact
                icon={glyph(Trash2)}
                title="Then everything of yours is deleted"
                body="Programs, exercises, check-in templates, notes, messages and the feedback you have written."
                density={density}
                borderColor={theme.colors.border.strong}
                isSubsequent
              />
              <Fact
                icon={glyph(Clock)}
                title="You have 7 days to change your mind"
                body="We email you a link, and Restore is in the app for the whole week. Nothing reaches your clients before then."
                density={density}
                borderColor={theme.colors.border.strong}
                isSubsequent
              />
            </>
          ) : (
            <>
              <Fact
                icon={glyph(Trash2)}
                title="Everything you have logged is deleted"
                body="Workouts and sets, meals, habits, body measurements, photos, videos, messages and your coach’s feedback."
                density={density}
                borderColor={theme.colors.border.strong}
              />
              <Fact
                icon={glyph(Users)}
                title="Your coach loses access to it"
                body="From the moment your account is removed, there is nothing left for them to see."
                density={density}
                borderColor={theme.colors.border.strong}
                isSubsequent
              />
              <Fact
                icon={glyph(Clock)}
                title="You have 7 days to change your mind"
                body="We email you a link, and Restore is in the app for the whole week. After that it cannot be undone."
                density={density}
                borderColor={theme.colors.border.strong}
                isSubsequent
              />
            </>
          )}
        </Card>

        {/* The export offer: one line and one link, ABOVE the destructive
            action so it is read first, and costing nothing to skip. Making
            it a step would be the fourth tap. */}
        <Pressable
          onPress={() => router.push('/your-data')}
          accessibilityRole="link"
          accessibilityLabel="Export your data"
          style={[styles.offer, themed.offer]}
        >
          <Download size={18} color={theme.colors.brand.DEFAULT} />
          <Text size="body-sm" tone="muted" style={styles.flex}>
            Want a copy first?{' '}
            <Text size="body-sm" tone="warm">
              Export your data
            </Text>
          </Text>
        </Pressable>
      </ScrollView>

      <View
        style={[
          styles.actions,
          { paddingHorizontal: gutter, paddingBottom: insets.bottom + spacing(20) },
        ]}
      >
        <Button
          variant="danger"
          size="lg"
          fullWidth
          density={density}
          onPress={() => setIsConfirmOpen(true)}
          disabled={!deletion.canDelete}
          loading={deletion.isDeleting}
          // Offline, the reason rides on the label as well as sitting under
          // the control: `Button` renders a disabled label at `fg.faint`,
          // which `DESIGN.md` §13 forbids from carrying meaning, and a
          // screen reader should meet the control and its constraint
          // together rather than as two unrelated things.
          accessibilityLabel={
            deletion.canDelete ? 'Delete account' : `Delete account. ${offlineReason}`
          }
          testID="delete-account-action"
        >
          Delete account
        </Button>

        {!deletion.canDelete ? (
          <View style={styles.hint}>
            <WifiOff size={15} color={theme.colors.fg.muted} />
            <Text size="body-sm" tone="muted" style={styles.hintText}>
              {offlineReason}
            </Text>
          </View>
        ) : null}

        {deletion.hasFailed ? (
          <View style={styles.hint} accessibilityLiveRegion="polite" accessibilityRole="alert">
            <Text size="body-sm" tone="muted" style={styles.hintText}>
              That didn’t go through, and nothing has changed. Try again.
            </Text>
          </View>
        ) : null}
      </View>

      <DeleteAccountConfirm
        isOpen={isConfirmOpen}
        isCoach={isCoach}
        onCancel={() => setIsConfirmOpen(false)}
        onConfirm={() => {
          setIsConfirmOpen(false);
          deletion.deleteAccount();
        }}
        isConfirming={deletion.isDeleting}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  screen: { flex: 1 },
  navBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 1,
    justifyContent: 'flex-end',
  },
  navBarContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(12),
    paddingBottom: spacing(12),
  },
  backButton: { minWidth: 48, minHeight: 48, alignItems: 'flex-start', justifyContent: 'center' },
  content: { paddingBottom: spacing(24), flexGrow: 1 },
  lede: { marginTop: spacing(10) },
  fact: { flexDirection: 'row', gap: spacing(12), paddingHorizontal: spacing(16) },
  factGlyph: {
    width: 22,
    height: 22,
    borderRadius: 7,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  factBody: { marginTop: spacing(3) },
  offer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing(10),
    padding: spacing(14),
    borderRadius: 14,
    borderWidth: 1,
    // Min-height, never height — at 200% text the line wraps and this grows.
    minHeight: 48,
  },
  actions: { paddingTop: spacing(10), gap: spacing(10) },
  hint: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing(7), paddingHorizontal: 6 },
  hintText: { flex: 1 },
});

const useThemedStyles = createThemedStyles((theme) => ({
  screen: { backgroundColor: theme.colors.bg.DEFAULT },
  offer: { backgroundColor: theme.colors.bg.inset, borderColor: theme.colors.border.soft },
}));
