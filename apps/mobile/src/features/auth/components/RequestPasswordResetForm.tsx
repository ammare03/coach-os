import { auth as authSchemas } from '@coachos/schemas';
import { Button, FormField, Input, createThemedStyles } from '@coachos/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { AccessibilityInfo, StyleSheet, Text, View } from 'react-native';
import type { z } from 'zod';

import { useRequestPasswordReset } from '../hooks/useRequestPasswordReset.ts';

// The shared server schema, used unchanged — `requestResetInput` has one
// field and no device fields to strip, unlike `signInInput`.
const requestResetFormSchema = authSchemas.requestResetInput;
type RequestResetFormValues = z.infer<typeof requestResetFormSchema>;

// `keys.pwreset`'s TTL in `apps/api/src/lib/redis-keys.ts` — 60 minutes.
const LINK_LIFETIME = '1 hour';

export interface RequestPasswordResetFormProps {
  /** Where "Back to sign in" goes once the request is away. Navigation belongs to the route (`CLAUDE.md` §9.2). */
  onDone: () => void;
}

/**
 * Password reset, request half (`auth-server/06`). All of this screen's
 * logic is here rather than in the route file, per §9.2.
 *
 * The confirmation is deliberately conditional-on-nothing: `auth.requestReset`
 * resolves the same way for an email with an account and one without, so
 * this form has exactly one success state and its copy never confirms that
 * an account exists.
 */
export function RequestPasswordResetForm({ onDone }: RequestPasswordResetFormProps) {
  const themed = useThemedStyles();
  const { requestPasswordReset, isSubmitting } = useRequestPasswordReset();
  const [formError, setFormError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const {
    control,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<RequestResetFormValues>({
    resolver: zodResolver(requestResetFormSchema),
    defaultValues: { email: '' },
  });

  async function onSubmit(values: RequestResetFormValues) {
    setFormError(null);
    const result = await requestPasswordReset(values);
    if (result.ok) {
      setSentTo(values.email);
      // The whole screen swaps out; a silent swap is invisible to a screen
      // reader (`accessibility` skill §2).
      AccessibilityInfo.announceForAccessibility('Check your email');
      return;
    }
    setFormError(result.error.formMessage);
    for (const [field, message] of Object.entries(result.error.fieldErrors ?? {})) {
      setError(field as keyof RequestResetFormValues, { message });
    }
  }

  if (sentTo !== null) {
    return (
      <View style={styles.container}>
        <Text style={[styles.heading, themed.heading]}>Check your email</Text>
        <Text style={[styles.body, themed.body]}>
          If there is an account for {sentTo}, a link to set a new password is on its way. The link
          works for {LINK_LIFETIME}.
        </Text>
        <Button variant="secondary" size="lg" fullWidth onPress={onDone}>
          Back to sign in
        </Button>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={[styles.heading, themed.heading]}>Reset your password</Text>
      <Text style={[styles.body, themed.body]}>
        Enter the email you signed up with and we will send a link to set a new password.
      </Text>

      <Controller
        control={control}
        name="email"
        render={({ field: { onChange, onBlur, value } }) => (
          <FormField label="Email" error={errors.email?.message}>
            <Input
              value={value}
              onChangeText={onChange}
              onBlur={onBlur}
              placeholder="Email"
              keyboardType="email-address"
              autoComplete="email"
              textContentType="username"
              returnKeyType="done"
              onSubmitEditing={handleSubmit(onSubmit)}
              state={errors.email ? 'error' : 'default'}
            />
          </FormField>
        )}
      />

      {formError !== null && (
        <Text style={[styles.formError, themed.formError]} accessibilityRole="alert">
          {formError}
        </Text>
      )}

      <Button onPress={handleSubmit(onSubmit)} loading={isSubmitting} fullWidth size="lg">
        Send reset link
      </Button>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 12,
  },
  // 24/700 — the same heading `SignInScreen` uses, since this screen is
  // reached from it and sits at the same level of the flow.
  heading: {
    fontWeight: '700',
    fontSize: 24,
  },
  // `DESIGN.md` §1.2 `body-lg` (400 16/24); §9's ≤280px measure.
  body: {
    fontSize: 16,
    lineHeight: 24,
    maxWidth: 280,
    marginBottom: 4,
  },
  formError: {
    fontSize: 14,
  },
});

const useThemedStyles = createThemedStyles((theme) => ({
  heading: { color: theme.colors.fg.DEFAULT },
  body: { color: theme.colors.fg.muted },
  formError: { color: theme.colors.fg.DEFAULT },
}));
