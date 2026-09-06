import { LoadingState, spacing, Text } from '@coachos/ui';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { getErrorCode } from '../../../lib/error-code.ts';
import { api } from '../../../lib/trpc.ts';
import { InviteEntryStep } from '../../onboarding/steps/InviteEntryStep.tsx';
import { AuthScreenShell } from '../components/AuthScreenShell.tsx';
import { useSignOut } from '../hooks/useSignOut.ts';
import { useAuthStore } from '../store.ts';

import { InviteRefusedScreen } from './InviteRefusedScreen.tsx';
import {
  ReturningClientInviteScreen,
  type HistorySharing,
} from './ReturningClientInviteScreen.tsx';

// `client-onboarding/01`, Approach step 2 — the branch, in one place.
//
// | Caller                        | Screen                                    |
// | ----------------------------- | ----------------------------------------- |
// | Signed out                    | `InviteEntryStep` → `invites.accept`      |
// | Client who has a coach        | `InviteRefusedScreen`, no switch control  |
// | Client with no coach          | `ReturningClientInviteScreen`             |
// | Coach or assistant            | `InviteRefusedScreen`, its own copy       |
//
// Role comes from the auth store; coach state comes from `clientApp.coach`,
// the read `client-onboarding/01` added for exactly this fork. There is no
// fallback that calls and refuses on `CLIENT_ALREADY_HAS_COACH` — that
// asks a returning client for three sharing decisions before telling them
// the answer was no.

const PREVIEW_ERROR_COPY: Record<string, string> = {
  // Deliberately identical for "no such code" and "a code addressed to
  // someone else" — distinguishing them would let any signed-in caller
  // test whose invite a code is (`security-and-privacy` §1).
  INVITE_NOT_FOUND: 'This invite code isn’t valid for your account.',
  INVITE_EXPIRED: 'This invite has expired. Ask your coach for a new one.',
  INVITE_ALREADY_ACCEPTED: 'This invite has already been used.',
  INVITE_REVOKED: 'This invite was cancelled. Ask your coach for a new one.',
};

const ACCEPT_ERROR_COPY: Record<string, string> = {
  ...PREVIEW_ERROR_COPY,
  CLIENT_ALREADY_HAS_COACH:
    'You already have a coach. Leave them in Settings first, then open this invite again.',
  SEAT_LIMIT_REACHED:
    'Your coach’s plan is full right now. Let them know — they can make room for you.',
  RATE_LIMITED: 'Too many tries just now. Wait a minute and try again.',
};

const GENERIC = 'Something went wrong. Check your connection and try again.';

function copyFor(error: unknown, table: Record<string, string>): string {
  const code = getErrorCode(error);
  return (code === null ? undefined : table[code]) ?? GENERIC;
}

export interface InviteArrivalProps {
  code: string;
}

export function InviteArrival({ code }: InviteArrivalProps) {
  const status = useAuthStore((state) => state.status);
  const role = useAuthStore((state) => state.role);

  // The gate already holds the splash for a loading session
  // (`AuthGate.tsx`), but this screen is reachable while auth resolves on
  // an exempt route, so it says so rather than guessing a branch.
  if (status === 'loading') {
    return (
      <AuthScreenShell>
        <LoadingState accessibilityLabel="Opening your invite" shape="detail" />
      </AuthScreenShell>
    );
  }

  if (status === 'unauthenticated') {
    return (
      <AuthScreenShell>
        <View style={styles.block}>
          <Text size="h1-client" accessibilityRole="header">
            You’ve been invited
          </Text>
          <Text size="body" tone="muted">
            Enter the eight-character code from your coach’s email. Tapping the link in that email
            fills it in for you.
          </Text>
          <InviteEntryStep initialCode={code} autoSubmit={code.length > 0} />
        </View>
      </AuthScreenShell>
    );
  }

  if (role === 'coach' || role === 'assistant') {
    return <RefusedAsCoach />;
  }

  return <SignedInClientArrival code={code} />;
}

function RefusedAsCoach() {
  const email = useSignedInEmail();
  const { signOut, isSigningOut } = useSignOut();

  return (
    <InviteRefusedScreen
      reason="signed-in-as-coach"
      email={email}
      onSignOut={() => void signOut()}
      isSigningOut={isSigningOut}
    />
  );
}

function SignedInClientArrival({ code }: { code: string }) {
  const router = useRouter();
  const email = useSignedInEmail();
  const { signOut, isSigningOut } = useSignOut();
  const coach = api.clientApp.coach.useQuery();

  if (coach.isPending) {
    return (
      <AuthScreenShell>
        <LoadingState accessibilityLabel="Opening your invite" shape="detail" />
      </AuthScreenShell>
    );
  }

  // Case 1 — refuse and explain. No switch control, by decision.
  if (coach.data) {
    return (
      <InviteRefusedScreen
        reason="client-has-coach"
        coachName={coach.data.name}
        email={email}
        onOpenSettings={() => router.push('/(client)/settings')}
        onSignOut={() => void signOut()}
        isSigningOut={isSigningOut}
      />
    );
  }

  // Case 2 — the returning client, who gets a real choice.
  return (
    <ReturningClientAcceptance
      code={code}
      onSignOut={() => void signOut()}
      isSigningOut={isSigningOut}
    />
  );
}

function ReturningClientAcceptance({
  code,
  onSignOut,
  isSigningOut,
}: {
  code: string;
  onSignOut: () => void;
  isSigningOut: boolean;
}) {
  const router = useRouter();
  const utils = api.useUtils();
  const [historySharing, setHistorySharing] = useState<HistorySharing>('twelve_weeks');
  const [shareMetrics, setShareMetrics] = useState(false);
  const [shareNutrition, setShareNutrition] = useState(false);
  const [acceptError, setAcceptError] = useState<string | undefined>(undefined);

  const preview = api.invites.preview.useQuery({ code }, { enabled: code.length === 8, retry: 0 });
  const accept = api.invites.acceptAsExistingClient.useMutation();

  function onAccept() {
    setAcceptError(undefined);
    accept.mutate(
      { code, historySharing, shareMetrics, shareNutrition },
      {
        onSuccess: () => {
          // Approach step 7 — hand off to the completion gate rather than
          // walking an already-onboarded client back through goals. `/`
          // has no group of its own; `AuthHomeRedirect` resolves it against
          // role and `isOnboarded`, which is exactly the decision needed.
          void utils.clientApp.coach.invalidate();
          router.replace('/');
        },
        onError: (error) => setAcceptError(copyFor(error, ACCEPT_ERROR_COPY)),
      },
    );
  }

  return (
    <ReturningClientInviteScreen
      coachName={preview.data?.coachName}
      isLoadingCoach={preview.isPending && code.length === 8}
      previewError={
        preview.error === null
          ? code.length === 8
            ? undefined
            : 'This invite code isn’t valid for your account.'
          : copyFor(preview.error, PREVIEW_ERROR_COPY)
      }
      historySharing={historySharing}
      onHistorySharingChange={setHistorySharing}
      shareMetrics={shareMetrics}
      onShareMetricsChange={setShareMetrics}
      shareNutrition={shareNutrition}
      onShareNutritionChange={setShareNutrition}
      onAccept={onAccept}
      isAccepting={accept.isPending}
      acceptError={acceptError}
      onSignOut={onSignOut}
      isSigningOut={isSigningOut}
    />
  );
}

/**
 * The address a wrong-account sign-out affordance has to show to be worth
 * offering. `me.get` rather than the token: the store carries `userId` and
 * `role` only, deliberately (`store.ts`).
 */
function useSignedInEmail(): string {
  const me = api.me.get.useQuery();
  return me.data?.email ?? '';
}

const styles = StyleSheet.create({
  block: { gap: spacing(16), paddingTop: spacing(8) },
});
