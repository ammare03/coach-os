import { auth as authSchemas } from '@coachos/schemas';
import { Button, createThemedStyles, FormField, Input } from '@coachos/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useRouter } from 'expo-router';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { StyleSheet, Text, View } from 'react-native';
import type { z } from 'zod';

import { useSignIn } from '../hooks/useSignIn.ts';

// The user-entered subset of the shared server schema — device fields are
// merged in by `useSignIn`, never typed by the person signing in
// (`auth-client/05`'s Interfaces section: "sharing validation with the
// server via the same schema").
const signInFormSchema = authSchemas.signInInput.omit({
  deviceId: true,
  platform: true,
  appVersion: true,
  osVersion: true,
});
type SignInFormValues = z.infer<typeof signInFormSchema>;

export function SignInForm() {
  const router = useRouter();
  const themed = useThemedStyles();
  const { signIn, isSubmitting } = useSignIn();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    control,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<SignInFormValues>({
    resolver: zodResolver(signInFormSchema),
    defaultValues: { email: '', password: '' },
  });

  async function onSubmit(values: SignInFormValues) {
    setFormError(null);
    const result = await signIn(values);
    if (result.ok) {
      // Role-based home routing is `phase-05-app-shell/providers-and-
      // gates/`'s job; `/` is the current temporary placeholder screen
      // (`apps/mobile/src/app/index.tsx`'s own comment says the same).
      router.replace('/');
      return;
    }
    setFormError(result.error.formMessage);
    for (const [field, message] of Object.entries(result.error.fieldErrors ?? {})) {
      setError(field as keyof SignInFormValues, { message });
    }
  }

  return (
    <View style={styles.container}>
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
              returnKeyType="next"
              state={errors.email ? 'error' : 'default'}
            />
          </FormField>
        )}
      />

      <Controller
        control={control}
        name="password"
        render={({ field: { onChange, onBlur, value } }) => (
          <FormField label="Password" error={errors.password?.message}>
            <Input
              value={value}
              onChangeText={onChange}
              onBlur={onBlur}
              placeholder="Password"
              secureTextEntry
              autoComplete="password"
              textContentType="password"
              returnKeyType="done"
              onSubmitEditing={handleSubmit(onSubmit)}
              state={errors.password ? 'error' : 'default'}
            />
          </FormField>
        )}
      />

      {/* Live as of `router-skeleton/02`, which builds the screen this
          points at. It was drawn but inert in `auth-client/05` because
          `(auth)/forgot-password` was still a placeholder then; the
          treatment is unchanged, only the destination is real. */}
      <Link href="/forgot-password" style={[styles.forgotLink, themed.forgotLink]}>
        Forgot?
      </Link>

      {formError !== null && (
        <Text style={[styles.formError, themed.formError]} accessibilityRole="alert">
          {formError}
        </Text>
      )}

      <Button onPress={handleSubmit(onSubmit)} loading={isSubmitting} fullWidth size="lg">
        Sign in
      </Button>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 12,
  },
  forgotLink: {
    alignSelf: 'flex-end',
    fontSize: 13,
    fontWeight: '500',
    marginTop: -6,
  },
  formError: {
    fontSize: 14,
  },
});

// The retired `DESIGN-SYSTEM.md` indigo, mapped onto `DESIGN.md` §1.1 by
// ROLE, not by hue: #868CF8 was the link tint, which is `brand` here (§1.1,
// "accent, active state"), and #F2F5F9 was the body ink, which is
// `fg.DEFAULT`. Same mapping `SignInScreen` already uses for its own
// footer link and social-error text, so the two halves of this screen
// cannot drift apart.
const useThemedStyles = createThemedStyles((theme) => ({
  forgotLink: { color: theme.colors.brand.DEFAULT },
  formError: { color: theme.colors.fg.DEFAULT },
}));
