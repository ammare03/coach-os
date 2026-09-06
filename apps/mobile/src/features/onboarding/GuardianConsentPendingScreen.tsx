// `guardian-consent/06` — the explanation half of `auth-server/07` step 4:
// *"a minor account without consent can sign in, see an explanation, and
// nothing else."* `guardian-consent/03` built the "nothing else". This is
// the explanation, and without it a fifteen-year-old who has just typed a
// password and a birthday lands in `client-onboarding/02`, where every
// query fails `GUARDIAN_CONSENT_PENDING` and they get a generic error with
// a Retry that can never work.
//
// **The copy is the feature.** `COPY.md` §CO1/§CO2. The client did nothing
// wrong and cannot fix this alone, so the party being waited on is named in
// the first line and it is not them. The words *blocked*, *restricted*,
// *suspended*, *under review*, *not allowed* and *verify* appear nowhere —
// each of them turns a two-minute wait into a suspension notice, and this
// is the first screen a young client ever sees.
//
// **Two actions and no more** (Approach step 3): send again, and use a
// different email. Sign out is the way out that always works and sits in
// the ghost row. `me.requestDeletion` stays reachable server-side
// (`guardian-consent/03` leaves it ungated, and §21.4 requires it) and is
// deliberately NOT surfaced here — a frustrated teenager one tap from
// deleting their account is bad design.
import { email as emailSchema } from '@coachos/schemas';
import {
  Button,
  Card,
  createThemedStyles,
  density,
  FormField,
  GlassSurface,
  Input,
  Skeleton,
  SkeletonText,
  spacing,
  Text,
  useTheme,
} from '@coachos/ui';
import { useRouter } from 'expo-router';
import { Check, Clock, Lock, Mail, User, WifiOff } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { trackEvent } from '../../lib/analytics/index.ts';
import { useSignOut } from '../auth/hooks/useSignOut.ts';

import { cooldownLabel, useGuardianConsentResend } from './useGuardianConsentResend.ts';
import { useGuardianConsentStatus } from './useGuardianConsentStatus.ts';

const GUTTER = density.client.gutter;

// Client density, and the client body floor: 16pt (`DESIGN.md` §1.3).
// Everything on this screen is read once, carefully, by someone who is
// probably a bit worried — nothing here is scanned.

export function GuardianConsentPendingScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const themed = useThemedStyles();

  const status = useGuardianConsentStatus();
  const resend = useGuardianConsentResend();
  const { signOut, isSigningOut } = useSignOut();

  const [isCorrecting, setIsCorrecting] = useState(false);
  const [draftEmail, setDraftEmail] = useState('');
  const [hasBlurredEmail, setHasBlurredEmail] = useState(false);
  const hasTrackedView = useRef(false);

  // Once per mount, and only once the state is actually known — firing on
  // the loading state would count every cold start as an arrival and make
  // the drop-off number this event exists to measure meaningless.
  useEffect(() => {
    if (status.state === 'pending' && !hasTrackedView.current) {
      hasTrackedView.current = true;
      trackEvent('guardian_consent_pending_viewed', {});
    }
  }, [status.state]);

  // Approach step 4 — the exit. `guardian-consent/03` guarantees the very
  // next request succeeds on the SAME access token once consent lands, so
  // there is no sign-out, no refresh, and no restart between here and the
  // goals step. The group root rather than a step number: the persisted
  // `currentStep` owns where in the flow they resume, exactly as
  // `useAcceptInvite` leaves it.
  useEffect(() => {
    if (status.state === 'resolved') {
      router.replace('/(client-onboarding)');
    }
  }, [status.state, router]);

  const isEmailValid = emailSchema.safeParse(draftEmail).success;
  const isCoolingDown = resend.cooldownMs > 0;

  function submitCorrection() {
    if (!isEmailValid) {
      return;
    }
    resend.resend(draftEmail.trim());
    setIsCorrecting(false);
    setDraftEmail('');
    setHasBlurredEmail(false);
  }

  const isError = status.state === 'error';
  const isLoading = status.state === 'loading';

  // `DESIGN.md` §5 — a skeleton, never a spinner, and shaped like what it
  // stands in for so nothing shifts when `me.get` lands. Its own screen
  // rather than a branch inside the one below: the populated screen reads
  // as one piece, and interleaving six ternaries through it to describe an
  // absence is how the real layout stops being legible.
  //
  // `resolved` renders it too, and that is the same lesson `AuthGate`
  // learned: the redirect above runs in an effect, so a component that went
  // on rendering its populated body would paint "we've emailed your parent"
  // for a frame at the exact moment the parent has already confirmed. A
  // blank screen is not one of `ui-conventions` §4's four states either —
  // the skeleton is the honest thing to show for the frame in between.
  if (isLoading || status.state === 'resolved') {
    return (
      <View style={[styles.screen, themed.screen]} testID="guardian-consent-pending">
        <View
          style={[
            styles.content,
            { paddingTop: insets.top + spacing(32), paddingBottom: spacing(8) },
          ]}
        >
          <GlassSurface tier="tier2" style={styles.hero}>
            <Skeleton
              width={56}
              height={56}
              radius="section"
              accessibilityLabel="Checking with your parent or guardian"
            />
            <View style={styles.skeletonGap}>
              <SkeletonText size="h1-client" lines={2} lastLineWidth="72%" />
            </View>
            <View style={styles.skeletonGap}>
              <SkeletonText size="body-lg" lines={2} lastLineWidth="88%" />
            </View>
            <View style={styles.skeletonGap}>
              <Skeleton width={186} height={40} radius="control" />
            </View>
          </GlassSurface>
          <Card>
            <View style={styles.fact}>
              <Skeleton width={22} height={22} radius="chip" />
              <View style={styles.flex}>
                <SkeletonText size="label" lines={1} lastLineWidth="60%" />
                <View style={styles.factBody}>
                  <SkeletonText size="body-sm" lines={2} lastLineWidth="80%" />
                </View>
              </View>
            </View>
          </Card>
        </View>
        <View style={[styles.actions, { paddingBottom: insets.bottom + spacing(20) }]}>
          <Skeleton height={56} radius="full" />
          <Skeleton height={56} radius="full" />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.screen, themed.screen]} testID="guardian-consent-pending">
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + spacing(32), paddingBottom: spacing(8) },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={status.isRefreshing}
            onRefresh={status.refresh}
            tintColor={theme.colors.fg.muted}
            // The affordance is silent otherwise: a screen that updates by
            // itself gives no clue that pulling does anything.
            title="Checking"
            titleColor={theme.colors.fg.muted}
          />
        }
      >
        <GlassSurface tier="tier2" style={styles.hero}>
          <View style={[styles.statusGlyph, isError ? themed.statusCalm : themed.statusWarm]}>
            {isError ? (
              <WifiOff size={24} color={theme.colors.fg.muted} />
            ) : (
              <Mail size={24} color={theme.colors.primary.from} />
            )}
          </View>
          <Text size="eyebrow" tone="warm-muted" style={styles.eyebrow}>
            Parent or guardian
          </Text>
          <Text size="h1-client" tone="bright" accessibilityRole="header">
            {isError ? 'We can’t check on this right now' : 'We’ve emailed your parent or guardian'}
          </Text>
          <Text size="body-lg" tone="glass" style={styles.lede}>
            {isError
              ? 'Your connection dropped, so we can’t tell whether your parent or guardian has confirmed yet. Nothing has been lost.'
              : 'They need to confirm before your coach can start you off. It takes them one tap — no app, no account.'}
          </Text>
          {!isError && !isLoading && status.guardianEmailMasked !== null ? (
            <View style={[styles.address, themed.inset]}>
              <Mail size={14} color={theme.colors.fg.warm} />
              <Text size="label" tone="warm">
                {status.guardianEmailMasked}
              </Text>
            </View>
          ) : null}
        </GlassSurface>

        {isError ? (
          <Card>
            <Fact
              icon={<Mail size={12} color={theme.colors.brand.DEFAULT} />}
              title="Try again when you have signal"
              body="Pulling down on this screen checks again too."
              theme={theme}
            />
          </Card>
        ) : isCorrecting ? (
          <View>
            <Text size="title" style={styles.sectionTitle}>
              A different email
            </Text>
            <Card>
              <FormField
                label="Your parent or guardian’s email"
                hint={
                  status.guardianEmailMasked === null
                    ? 'We’ll send a new link there.'
                    : `We’ll send a new link there. The one we sent to ${status.guardianEmailMasked} stops working.`
                }
                error={
                  hasBlurredEmail && !isEmailValid
                    ? 'That doesn’t look like a full email address yet.'
                    : undefined
                }
              >
                <Input
                  value={draftEmail}
                  onChangeText={setDraftEmail}
                  onBlur={() => setHasBlurredEmail(true)}
                  onSubmitEditing={submitCorrection}
                  placeholder="name@example.com"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="email"
                  textContentType="emailAddress"
                  returnKeyType="send"
                  state={hasBlurredEmail && !isEmailValid ? 'error' : 'default'}
                  accessibilityLabel="Your parent or guardian’s email"
                />
              </FormField>
            </Card>
          </View>
        ) : (
          <>
            {resend.hasJustSent ? (
              <Card elevation="tinted">
                <View
                  style={styles.sent}
                  accessibilityLiveRegion="polite"
                  accessibilityRole="alert"
                >
                  <Check size={18} color={theme.colors.brand.lift} />
                  <Text size="body-sm" style={styles.flex}>
                    {status.guardianEmailMasked === null
                      ? 'Sent again. It can take a couple of minutes to arrive — the spam folder is worth a look.'
                      : `Sent again to ${status.guardianEmailMasked}. It can take a couple of minutes to arrive — the spam folder is worth a look.`}
                  </Text>
                </View>
              </Card>
            ) : null}

            <View>
              <Text size="title" style={styles.sectionTitle}>
                While you wait
              </Text>
              <Card>
                {isCoolingDown ? (
                  <>
                    <Fact
                      icon={<Clock size={12} color={theme.colors.brand.DEFAULT} />}
                      title="Three sent in the last quarter hour"
                      body="That’s the limit for now, so nobody’s inbox can be flooded. The last one still works — it’s good for seven days."
                      theme={theme}
                    />
                    <Fact
                      icon={<Mail size={12} color={theme.colors.brand.DEFAULT} />}
                      title="Wrong address?"
                      body="You don’t have to wait for that. Use a different email works right away."
                      theme={theme}
                      isSubsequent
                    />
                  </>
                ) : (
                  <>
                    <Fact
                      icon={<Check size={12} color={theme.colors.brand.DEFAULT} />}
                      title="Nothing to do here"
                      body="The moment they confirm, this screen moves you on by itself. You can close the app and come back."
                      theme={theme}
                    />
                    <Fact
                      icon={<User size={12} color={theme.colors.brand.DEFAULT} />}
                      title="Your coach knows"
                      body="They were told you’re under 18 and that a guardian confirms first. They were not told your date of birth."
                      theme={theme}
                      isSubsequent
                    />
                    <Fact
                      icon={<Lock size={12} color={theme.colors.brand.DEFAULT} />}
                      title="Your account is yours"
                      body="Everything you enter stays yours. Nothing is shared with anyone but the coach who invited you."
                      theme={theme}
                      isSubsequent
                    />
                  </>
                )}
              </Card>
            </View>
          </>
        )}
      </ScrollView>

      {/* The action stack is pinned rather than scrolled, and it never
          depends on a query resolving (`screen-composition` §3.3): sign out
          is reachable in every state, including the one where `me.get`
          could not be reached at all. */}
      <View style={[styles.actions, { paddingBottom: insets.bottom + spacing(20) }]}>
        {isError ? (
          <Button size="lg" fullWidth onPress={status.refresh} loading={status.isRefreshing}>
            Try again
          </Button>
        ) : isCorrecting ? (
          <>
            <Button size="lg" fullWidth onPress={submitCorrection} disabled={!isEmailValid}>
              Send to this email
            </Button>
            <Button
              variant="ghost"
              size="lg"
              fullWidth
              onPress={() => {
                setIsCorrecting(false);
                setDraftEmail('');
                setHasBlurredEmail(false);
              }}
            >
              Cancel
            </Button>
          </>
        ) : (
          <>
            {/* Approach step 3 — the rate limit is a DISABLED action
                carrying its own wait, never an error after the tap.
                
                The wait is a line BENEATH the control rather than its
                label, and that is a contrast decision, not a layout one:
                `Button` renders a disabled label at `fg.faint`, which is
                2.0:1 and which `DESIGN.md` §13 forbids from carrying
                meaning. The only statement of when a send becomes possible
                again may not be the least legible text on the screen. The
                same sentence rides on `accessibilityLabel`, so the control
                and its constraint are announced together rather than as two
                unrelated things a screen reader meets in sequence. */}
            <Button
              size="lg"
              fullWidth
              onPress={() => resend.resend()}
              disabled={isCoolingDown || isLoading}
              loading={resend.isSending}
              accessibilityLabel={
                isCoolingDown
                  ? `Send the email again. ${cooldownLabel(resend.cooldownMs)}.`
                  : 'Send the email again'
              }
            >
              Send the email again
            </Button>
            {isCoolingDown ? (
              <View style={styles.wait}>
                <Clock size={14} color={theme.colors.fg.muted} />
                <Text size="body-sm" tone="muted">
                  {cooldownLabel(resend.cooldownMs)}
                </Text>
              </View>
            ) : null}
            <Button
              variant="secondary"
              size="lg"
              fullWidth
              onPress={() => setIsCorrecting(true)}
              disabled={isLoading}
            >
              Use a different email
            </Button>
          </>
        )}
        {isCorrecting ? null : (
          <Button
            variant="ghost"
            size="lg"
            fullWidth
            onPress={() => void signOut()}
            loading={isSigningOut}
          >
            Sign out
          </Button>
        )}
      </View>
    </View>
  );
}

/**
 * One row of the "while you wait" card. A local component rather than a
 * `packages/ui` promotion: it has exactly one consumer, and
 * `code-conventions` §1 promotes on the second.
 */
function Fact({
  icon,
  title,
  body,
  theme,
  isSubsequent = false,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  theme: ReturnType<typeof useTheme>;
  isSubsequent?: boolean;
}) {
  return (
    <View
      style={[
        styles.fact,
        isSubsequent
          ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.colors.border.soft }
          : null,
      ]}
    >
      <View style={[styles.factGlyph, { borderColor: theme.colors.border.strong }]}>{icon}</View>
      <View style={styles.flex}>
        <Text size="label">{title}</Text>
        <Text size="body-sm" tone="muted" style={styles.factBody}>
          {body}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  screen: { flex: 1 },
  content: { paddingHorizontal: GUTTER, gap: spacing(22), flexGrow: 1 },
  // §4 tier 2, §1.4's 22px section radius.
  hero: { borderRadius: 22, padding: spacing(20), paddingVertical: spacing(22) },
  statusGlyph: {
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
  lede: { marginTop: spacing(12) },
  address: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing(7),
    marginTop: spacing(14),
    paddingVertical: spacing(9),
    paddingHorizontal: spacing(13),
    borderRadius: 12,
    borderWidth: 1,
  },
  sectionTitle: { marginBottom: spacing(12) },
  sent: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing(10) },
  fact: { flexDirection: 'row', gap: spacing(12), paddingVertical: spacing(16) },
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
  skeletonGap: { marginTop: spacing(14) },
  actions: { paddingHorizontal: GUTTER, paddingTop: spacing(8), gap: spacing(10) },
  wait: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing(6) },
});

const useThemedStyles = createThemedStyles((theme) => ({
  screen: { backgroundColor: theme.colors.bg.DEFAULT },
  statusWarm: { backgroundColor: theme.colors.bg.raised, borderColor: theme.colors.border.tinted },
  statusCalm: { backgroundColor: theme.colors.bg.inset, borderColor: theme.colors.border.strong },
  inset: { backgroundColor: theme.colors.bg.inset, borderColor: theme.colors.border.strong },
}));
