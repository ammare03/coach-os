import { ListRow, ListSection, density as densityTokens, type Density } from '@coachos/ui';
import { useRouter } from 'expo-router';
import { Download, Info, LogOut, Trash2 } from 'lucide-react-native';
import { ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { UnsyncedWorkPrompt } from '../../auth/components/UnsyncedWorkPrompt.tsx';
import { useSignOutFlow } from '../../auth/hooks/useSignOutFlow.ts';
import { useAuthStore } from '../../auth/store.ts';
import { AccountHeader } from '../components/AccountHeader.tsx';
import { AppearanceRow } from '../components/AppearanceRow.tsx';
import { AppVersionRow } from '../components/AppVersionRow.tsx';
import { UnitRow } from '../components/UnitRow.tsx';

/**
 * The one settings screen, for both roles.
 *
 * `docs/screens/README.md` marks both `settings/index` routes **Standalone**
 * — deliberately none of `UI-UX.md` §UX2's six patterns. It is a list of
 * destinations and one control; a page pattern would be scaffolding around
 * a scroll view.
 *
 * Three rules this file exists to hold:
 *
 * 1. **One screen, gated at the row.** The coach's list and the client's
 *    differ by a handful of rows. Two screens would be two section maps,
 *    two test files, and a drift P28's shared-screen requirement would find
 *    (`settings-shell/01`, Risks).
 * 2. **Role comes from the auth store, never `me.get`.** The profile query
 *    can still be in flight while this renders; gating on it would paint
 *    the wrong role's rows for a frame.
 * 3. **A reserved section is not a drawn row.** `ListSection` renders
 *    nothing when it has no children, so every name below costs no pixels
 *    until the phase that owns it arrives. A row that opens nothing trains
 *    people that settings is where things do not work.
 */
export function SettingsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const role = useAuthStore((state) => state.role);
  const signOutFlow = useSignOutFlow();

  // `ui-conventions` §1 — density is a prop decided by role, never a forked
  // component. An assistant coach (P25) is a coach for every purpose this
  // screen has.
  const isCoach = role === 'coach' || role === 'assistant';
  const isClient = role === 'client';
  const density: Density = isCoach ? 'coach' : 'client';
  const gutter = densityTokens[density].gutter;
  const sectionGap = densityTokens[density].sectionGap;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        {
          paddingHorizontal: gutter,
          paddingTop: gutter,
          paddingBottom: insets.bottom + gutter * 2,
          gap: sectionGap,
        },
      ]}
      showsVerticalScrollIndicator={false}
      testID="settings-screen"
    >
      {/*
        ── THE SECTION MAP ──────────────────────────────────────────────
        The contract is `.claude/plan/phase-09-workout-logger/settings-shell/README.md`
        ("The section map"). Rows are declared HERE and nowhere else; the two
        route files are composition only. A later task adds a row by putting
        a `ListRow` inside the named section below and gating on `role` where
        the map says so — it never edits a route file and never starts a
        second list.

        Section          Row                                 Coach Client  Owner
        (header)         Name · email · avatar                 ✓     ✓     this task → P11 profile-editing/01
        Preferences      Weight unit                           ✓     ✓     P03 account-lifecycle/08   ← MOUNTED
                         Appearance                            ✓     ✓     settings-shell/03          ← MOUNTED
                         Notifications                         ✓     ✓     P15 preferences-and-quiet-hours/01
                         Availability (quiet hours)            ✓     —     P14 quiet-hours/01
                         Sync workouts to Health               —     ✓     P24 workout-export/03
        Coaching         What {coach} can see                  —     ✓     P10 relationship-controls/03
                         Leave coach                           —     ✓     P10 relationship-controls/02
        Privacy & safety Privacy                               ✓     ✓     P15 preferences-and-quiet-hours/04
                         Blocked people                        ✓     ✓     P26 blocking-and-filtering/03
        Your data        Your data (export)                    ✓     ✓     P03 account-lifecycle/11  ← MOUNTED
                         Delete account — DIRECTLY BELOW IT    ✓     ✓     account-actions/02         ← MOUNTED
        Help & about     Medical disclaimer                    ✓     ✓     P06 onboarding-infrastructure/03 ← MOUNTED
                         Terms · Privacy Policy                ✓     ✓     P22 legal-and-compliance/01
                         Help → Send diagnostic info           ✓     ✓     P26 support-tooling/04
                         App version (static)                  ✓     ✓     this task                 ← MOUNTED
        (footer)         Sign out                              ✓     ✓     account-actions/01

        The coach's BUSINESS rows are not here. Billing, Branding, Team and
        Gym are More-hub destinations (`settings-shell/02`) — a coach runs
        their practice from More and their account from Settings.
      */}

      <AccountHeader />

      {/* PREFERENCES. `grouped={false}`: `UnitRow` is a card in its own
          right (P03's approved "live comparison" design), `AppearanceRow`
          brings its own for the same reason, and `DESIGN.md` §2 forbids a
          card inside a card at the same level.

          The eyebrow arrives with `settings-shell/03`, as task 01 said it
          would — a group of one unlabelled card needed no heading; a group
          of two does, and it is what lets a screen reader jump the section
          (`accessibility` §2). Appearance sits DIRECTLY below Weight unit,
          per the feature README's section map. */}
      <ListSection title="Preferences" grouped={false} density={density}>
        <UnitRow />
        <AppearanceRow density={density} />
      </ListSection>

      {/* COACHING — client only. Empty until P10; renders nothing. */}
      {isClient ? <ListSection title="Coaching" density={density} /> : null}

      {/* PRIVACY & SAFETY — empty until P15 and P26; renders nothing. */}
      <ListSection title="Privacy & safety" density={density} />

      {/* YOUR DATA. Export above deletion is P03 `account-lifecycle/11`'s
          placement rule, and `CLAUDE.md` §21.4 puts deletion ≤3 taps from
          here — so `account-actions/02` adds its row as the NEXT child of
          this section, not at the foot of the page. */}
      <ListSection title="Your data" density={density}>
        <ListRow
          label="Your data"
          description="Request a copy of everything you have logged"
          icon={Download}
          density={density}
          onPress={() => router.push('/your-data')}
        />
        {/* `account-actions/02`. The NEXT child of this section, not a row
            at the foot of the page: `CLAUDE.md` §21.4 puts deletion ≤3 taps
            from here, and the order — export above deletion — is what makes
            the copy offered before the exit.

            `destructive`, so `ListRow` draws no chevron. It does navigate,
            unlike Sign out above; the component's rule is that a
            destructive row never draws one, and the alternative (a red
            label wearing a chevron) reads as a navigation row that happens
            to be red. The screen it opens is what explains itself. */}
        <ListRow
          label="Delete account"
          icon={Trash2}
          destructive
          density={density}
          onPress={() => router.push('/delete-account')}
          testID="settings-delete-account"
        />
      </ListSection>

      {/* HELP & ABOUT. `CLAUDE.md` §21.3 requires the disclaimer to stay
          reachable from settings forever, in the same words a person
          acknowledged at onboarding. */}
      <ListSection title="Help & about" density={density}>
        <ListRow
          label="Medical disclaimer"
          icon={Info}
          density={density}
          onPress={() => router.push('/medical-disclaimer')}
        />
        <AppVersionRow density={density} />
      </ListSection>

      {/* FOOTER SLOT — `account-actions/01`. Its own untitled `ListSection`
          rather than a bare row: the exit gets the same card every other
          group has, so it reads as the last item of the list instead of a
          stray control floating under the page.

          `destructive`, so the label and glyph take `DESIGN.md` §1.1's
          accent-on-dark and the row draws no chevron — it acts, it does not
          navigate. No confirmation: with an empty outbox this is one tap and
          the sign-in screen (`ui-conventions` §5's undo-not-confirm rule,
          and sign-out is neither of its two typed-confirmation exceptions).
          The only question that can appear is the prompt below, and only
          when the device still holds work nothing has synced. */}
      <ListSection density={density}>
        <ListRow
          label="Sign out"
          icon={LogOut}
          destructive
          density={density}
          disabled={signOutFlow.isSigningOut}
          onPress={signOutFlow.requestSignOut}
          testID="settings-sign-out"
        />
      </ListSection>

      <UnsyncedWorkPrompt
        pendingCount={signOutFlow.pendingCount}
        onKeepSignedIn={signOutFlow.keepSignedIn}
        onDiscard={signOutFlow.discardAndSignOut}
        isDiscarding={signOutFlow.isSigningOut}
        testID="settings-unsynced-work"
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
  },
});
