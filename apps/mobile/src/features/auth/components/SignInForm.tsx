import { auth as authSchemas } from '@coachos/schemas';
import { Button, FormField, Input } from '@coachos/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'expo-router';
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

      {/* Visual only for now — out of scope per `05`'s Scope section:
          the reset flow (`auth-server/06`) this links to doesn't exist yet. */}
      <Text style={styles.forgotLink} accessibilityRole="none">
        Forgot?
      </Text>

      {formError !== null && (
        <Text style={styles.formError} accessibilityRole="alert">
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
    color: '#868CF8',
    marginTop: -6,
  },
  formError: {
    fontSize: 14,
    color: '#F2F5F9',
  },
});
