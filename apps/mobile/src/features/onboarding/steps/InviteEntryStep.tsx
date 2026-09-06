import { invites as invitesSchemas } from '@coachos/schemas';
import { Button, FormField, Input, spacing, Text } from '@coachos/ui';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { parseDateOfBirthInput } from '../../auth/date-of-birth.ts';
import { InviteCodeInput, INVITE_CODE_LENGTH } from '../components/InviteCodeInput.tsx';
import { useAcceptInvite, type AcceptInviteValues } from '../hooks/useAcceptInvite.ts';

// `client-onboarding/01` — the signed-out arrival, and the only way into a
// client account (`CLAUDE.md` §8.1: clients cannot self-register).
//
// Two phases on one screen rather than two routes: the code, then the
// three fields `invites.accept` needs to create the account. A route per
// phase would be a back-stack a person can end up behind with a code they
// have already burned, and the code is the whole state either phase
// carries.
//
// The email is deliberately not asked for. `invites.accept` uses the
// invite's own address, so the account and the invite can never disagree
// (`packages/schemas/src/invites.ts`).

type Phase = 'code' | 'account';

export interface InviteEntryStepProps {
  /**
   * Pre-filled by a `coachos://invite/{code}` arrival, empty for manual
   * entry. The two converge here — same phase, same call, no second path.
   */
  initialCode?: string;
  /**
   * The code arrived from a link rather than being typed, so the entry
   * phase is skipped and the person lands straight on the account fields.
   * `invites.accept` cannot be submitted from the code alone — it is
   * where the account is created — so "auto-submit" is auto-ADVANCE, and
   * both paths still converge on the one call.
   */
  autoSubmit?: boolean;
}

export function InviteEntryStep({ initialCode = '', autoSubmit = false }: InviteEntryStepProps) {
  const [code, setCode] = useState(initialCode.toUpperCase());
  const [phase, setPhase] = useState<Phase>(
    autoSubmit && isWellFormed(initialCode) ? 'account' : 'code',
  );
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [guardianEmail, setGuardianEmail] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  const accept = useAcceptInvite();

  function submitAccount() {
    setLocalError(null);
    const parsedDob = parseDateOfBirthInput(dateOfBirth);
    if (parsedDob === null) {
      setLocalError('Enter your date of birth as DD/MM/YYYY.');
      return;
    }
    const values: AcceptInviteValues = {
      code,
      name: name.trim(),
      password,
      dateOfBirth: parsedDob,
      ...(accept.needsGuardianEmail ? { guardianEmail: guardianEmail.trim() } : {}),
    };
    void accept.acceptInvite(values);
  }

  const error = localError ?? accept.error;

  if (phase === 'code') {
    return (
      <View style={styles.block}>
        <InviteCodeInput
          value={code}
          onChangeText={setCode}
          onSubmit={() => {
            if (isWellFormed(code)) setPhase('account');
          }}
        />
        <Text size="body-sm" tone="subtle">
          Eight characters. It never contains I, O, 0 or 1.
        </Text>

        {error !== null ? (
          <Text size="body-sm" tone="urgent" accessibilityRole="alert">
            {error}
          </Text>
        ) : null}

        <Button
          size="lg"
          fullWidth
          disabled={!isWellFormed(code)}
          onPress={() => setPhase('account')}
        >
          Continue
        </Button>
      </View>
    );
  }

  return (
    <View style={styles.block}>
      <FormField label="Your name" isRequired>
        <Input
          value={name}
          onChangeText={setName}
          placeholder="Your name"
          autoCapitalize="words"
          autoComplete="name"
          returnKeyType="next"
        />
      </FormField>

      <FormField label="Date of birth" hint="DD / MM / YYYY" isRequired>
        <Input
          value={dateOfBirth}
          onChangeText={setDateOfBirth}
          placeholder="DD / MM / YYYY"
          keyboardType="number-pad"
          autoComplete="birthdate-full"
          returnKeyType="next"
        />
      </FormField>

      <FormField label="Password" hint="At least 8 characters." isRequired>
        <Input
          value={password}
          onChangeText={setPassword}
          placeholder="Password"
          secureTextEntry
          autoCapitalize="none"
          autoComplete="new-password"
          textContentType="newPassword"
          returnKeyType="go"
          onSubmitEditing={submitAccount}
        />
      </FormField>

      {/* Shown only once the server has said it is needed — the app never
          asks a birthdate's age question for itself, and `phase-06-
          onboarding/guardian-consent/` owns everything downstream of this
          address (the token, the email, the gate, the pending screen). */}
      {accept.needsGuardianEmail ? (
        <FormField
          label="A parent or guardian's email"
          hint="They'll get one email asking them to confirm. You can start once they do."
          isRequired
        >
          <Input
            value={guardianEmail}
            onChangeText={setGuardianEmail}
            placeholder="parent@example.com"
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            returnKeyType="go"
            onSubmitEditing={submitAccount}
          />
        </FormField>
      ) : null}

      {error !== null ? (
        <Text size="body-sm" tone="urgent" accessibilityRole="alert">
          {error}
        </Text>
      ) : null}

      <Button
        size="lg"
        fullWidth
        loading={accept.isAccepting}
        disabled={!isComplete()}
        onPress={submitAccount}
      >
        Create my account
      </Button>

      <Button
        variant="secondary"
        size="lg"
        fullWidth
        disabled={accept.isAccepting}
        onPress={() => {
          setLocalError(null);
          setPhase('code');
        }}
      >
        Change the code
      </Button>
    </View>
  );

  function isComplete(): boolean {
    return (
      name.trim().length > 0 &&
      password.length >= 8 &&
      parseDateOfBirthInput(dateOfBirth) !== null &&
      (!accept.needsGuardianEmail || guardianEmail.trim().length > 0)
    );
  }
}

/** Format only — whether the code resolves to a live invite is the server's answer, never this screen's. */
function isWellFormed(value: string): boolean {
  return value.length === INVITE_CODE_LENGTH && invitesSchemas.inviteCode.safeParse(value).success;
}

const styles = StyleSheet.create({
  block: { gap: spacing(16) },
});
