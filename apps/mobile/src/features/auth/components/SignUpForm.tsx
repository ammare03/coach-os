import { auth as authSchemas } from '@coachos/schemas';
import { Button, createThemedStyles, FormField, Input } from '@coachos/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { StyleSheet, Text, View } from 'react-native';
import { z } from 'zod';

import { DATE_OF_BIRTH_PATTERN } from '../date-of-birth.ts';
import { useSignUp } from '../hooks/useSignUp.ts';

// The user-entered subset of `signUpInput` — device fields and `timezone`
// are filled in by `useSignUp`, and `dateOfBirth` is re-typed here as the
// raw "DD/MM/YYYY" the field displays rather than the ISO shape the server
// schema requires (`useSignUp` converts before the real validation pass).
// No `role` field — `auth.signUp` doesn't have one; sign-up only ever
// creates a coach (`/design` round 2 confirmed no role picker against the
// finalised direction).
const signUpFormSchema = authSchemas.signUpInput
  .omit({
    deviceId: true,
    platform: true,
    appVersion: true,
    osVersion: true,
    timezone: true,
    dateOfBirth: true,
  })
  .extend({
    dateOfBirth: z.string().regex(DATE_OF_BIRTH_PATTERN, 'Use DD/MM/YYYY'),
  });
type SignUpFormValues = z.infer<typeof signUpFormSchema>;

export function SignUpForm() {
  const router = useRouter();
  const themed = useThemedStyles();
  const { signUp, isSubmitting } = useSignUp();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    control,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<SignUpFormValues>({
    resolver: zodResolver(signUpFormSchema),
    defaultValues: { email: '', password: '', name: '', dateOfBirth: '' },
  });

  async function onSubmit(values: SignUpFormValues) {
    setFormError(null);
    const result = await signUp(values);
    if (result.ok) {
      router.replace('/'); // see SignInForm's identical comment
      return;
    }
    setFormError(result.error.formMessage);
    for (const [field, message] of Object.entries(result.error.fieldErrors ?? {})) {
      setError(field as keyof SignUpFormValues, { message });
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.intro}>
        <View style={styles.introRow}>
          <Text style={[styles.heading, themed.heading]}>Create account</Text>
          <View style={[styles.badge, themed.badge]}>
            <Text style={[styles.badgeText, themed.badgeText]}>Coach</Text>
          </View>
        </View>
        <Text style={[styles.subtitle, themed.subtitle]}>Clients join by invite, not here.</Text>
      </View>

      {/*
        Profile-photo upload was requested on the design canvas
        (comment #2) and is deliberately deferred — logged in
        `docs/UNFORGET.md` rather than built into this form now.
      */}

      <Controller
        control={control}
        name="name"
        render={({ field: { onChange, onBlur, value } }) => (
          <FormField label="Full name" error={errors.name?.message}>
            <Input
              value={value}
              onChangeText={onChange}
              onBlur={onBlur}
              placeholder="Full name"
              autoComplete="name"
              textContentType="name"
              returnKeyType="next"
              state={errors.name ? 'error' : 'default'}
            />
          </FormField>
        )}
      />

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
        name="dateOfBirth"
        render={({ field: { onChange, onBlur, value } }) => (
          <FormField
            label="Date of birth"
            hint="DD / MM / YYYY"
            error={errors.dateOfBirth?.message}
          >
            <Input
              value={value}
              onChangeText={onChange}
              onBlur={onBlur}
              placeholder="Date of birth — DD / MM / YYYY"
              keyboardType="number-pad"
              returnKeyType="next"
              maxLength={10}
              state={errors.dateOfBirth ? 'error' : 'default'}
            />
          </FormField>
        )}
      />

      <Controller
        control={control}
        name="password"
        render={({ field: { onChange, onBlur, value } }) => (
          <FormField label="Password" hint="At least 8 characters" error={errors.password?.message}>
            <Input
              value={value}
              onChangeText={onChange}
              onBlur={onBlur}
              placeholder="Password"
              secureTextEntry
              autoComplete="password-new"
              textContentType="newPassword"
              returnKeyType="done"
              onSubmitEditing={handleSubmit(onSubmit)}
              state={errors.password ? 'error' : 'default'}
            />
          </FormField>
        )}
      />

      {formError !== null && (
        <Text style={[styles.formError, themed.formError]} accessibilityRole="alert">
          {formError}
        </Text>
      )}

      <Text style={[styles.terms, themed.terms]}>
        By continuing, you agree to the Terms and Privacy Policy.
      </Text>

      <Button onPress={handleSubmit(onSubmit)} loading={isSubmitting} fullWidth size="lg">
        Create account
      </Button>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 12,
  },
  intro: {
    marginBottom: 4,
  },
  introRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  heading: {
    fontFamily: 'System',
    fontWeight: '700',
    fontSize: 22,
  },
  subtitle: {
    fontSize: 13,
    marginTop: 4,
  },
  badge: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  formError: {
    fontSize: 14,
  },
  terms: {
    fontSize: 11,
    lineHeight: 16,
    textAlign: 'center',
  },
});

// The retired indigo ramp mapped onto `DESIGN.md` §1.1 by role: #F2F5F9 →
// `fg.DEFAULT` (body ink), #5F6C7E → `fg.muted` (the secondary-
// metadata role it held), #868CF8 → `brand` (link/accent).
//
// The "Coach" pill was a hand-composed indigo tint at 12%/30%. That is
// exactly `DESIGN.md` §2's L3 *tinted* surface — "the only way to say
// 'this one is different' without colour-coding it" — so it reads the
// ladder's own tinted stops instead of a second hand-mixed alpha. Flattened
// to the gradient's first stop because a 20px pill is a plain `View`, not a
// `LinearGradient`; `brand.mid` at 16% over the canvas measures 7.21:1
// under `brand` text, against 4.5:1 for 11px.
const useThemedStyles = createThemedStyles((theme) => ({
  heading: { color: theme.colors.fg.DEFAULT },
  subtitle: { color: theme.colors.fg.muted },
  badge: {
    backgroundColor: theme.elevation.tinted.gradient[0],
    borderColor: theme.elevation.tinted.borderColor,
  },
  badgeText: { color: theme.colors.brand.DEFAULT },
  formError: { color: theme.colors.fg.DEFAULT },
  terms: { color: theme.colors.fg.muted },
}));
