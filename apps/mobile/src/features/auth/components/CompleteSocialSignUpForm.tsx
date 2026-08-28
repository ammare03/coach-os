import { auth as authSchemas } from '@coachos/schemas';
import { Button, FormField, Input } from '@coachos/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { StyleSheet, Text, View } from 'react-native';
import { Circle, Path, Svg } from 'react-native-svg';
import { z } from 'zod';

import { DATE_OF_BIRTH_PATTERN } from '../date-of-birth.ts';
import { useCompleteSocialSignUp } from '../hooks/useCompleteSocialSignUp.ts';

// Derived from the shared server schema, same pattern as `SignUpForm`'s
// own `signUpFormSchema` — `dateOfBirth` re-typed as the raw "DD/MM/YYYY"
// this field displays rather than the ISO shape the server requires
// (`useCompleteSocialSignUp` converts before the real validation pass).
// Everything else on `completeSocialSignUpInput` (`pendingSignupToken`,
// `timezone`, device fields) is filled in by the hook, never typed here.
const dobFormSchema = authSchemas.completeSocialSignUpInput
  .omit({
    pendingSignupToken: true,
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
type DobFormValues = z.infer<typeof dobFormSchema>;

interface CompleteSocialSignUpFormProps {
  pendingSignupToken: string;
  email: string;
}

/**
 * `social-sign-in/03` + Ammar's DOB-gate decision. No name field — the
 * approved `/design` canvas has none; the name travels server-side with
 * the pending signup record instead (`packages/schemas/src/auth.ts`'s own
 * comment on `completeSocialSignUpInput`). The identity row is a plain
 * opaque card (`GlassSurface`'s own DS§10 fallback tokens — `bg.raised` +
 * `border.subtle`), not real liquid glass: DS§12 restricts that to chrome,
 * and Ammar's review confirmed only the nav bar carries it on this screen,
 * same as sign-in/sign-up.
 */
export function CompleteSocialSignUpForm({
  pendingSignupToken,
  email,
}: CompleteSocialSignUpFormProps) {
  const router = useRouter();
  const { completeSocialSignUp, isSubmitting } = useCompleteSocialSignUp();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    control,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<DobFormValues>({
    resolver: zodResolver(dobFormSchema),
    defaultValues: { dateOfBirth: '' },
  });

  async function onSubmit(values: DobFormValues) {
    setFormError(null);
    const result = await completeSocialSignUp({ pendingSignupToken, ...values });
    if (result.ok) {
      router.replace('/'); // see SignInForm's identical comment
      return;
    }
    setFormError(result.error.formMessage);
    for (const [field, message] of Object.entries(result.error.fieldErrors ?? {})) {
      setError(field as keyof DobFormValues, { message });
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.intro}>
        <Text style={styles.heading}>Confirm your date of birth</Text>
        <Text style={styles.subtitle}>Coach accounts are for adults 18 and over.</Text>
      </View>

      <View style={styles.identityRow}>
        <View style={styles.identityAvatar}>
          <Svg
            width={16}
            height={16}
            viewBox="0 0 24 24"
            fill="none"
            stroke="#97A2B4"
            strokeWidth={2}
          >
            <Path
              d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <Circle cx={12} cy={7} r={4} />
          </Svg>
        </View>
        <View style={styles.identityTextCol}>
          <Text style={styles.identityLabel}>Continuing as</Text>
          <Text style={styles.identityEmail} numberOfLines={1}>
            {email}
          </Text>
        </View>
      </View>

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
              returnKeyType="done"
              maxLength={10}
              onSubmitEditing={handleSubmit(onSubmit)}
              state={errors.dateOfBirth ? 'error' : 'default'}
            />
          </FormField>
        )}
      />

      {formError !== null && (
        <Text style={styles.formError} accessibilityRole="alert">
          {formError}
        </Text>
      )}

      <Button onPress={handleSubmit(onSubmit)} loading={isSubmitting} fullWidth size="lg">
        Continue
      </Button>

      {/*
        Styled as links per the design review, not yet wired — there is no
        Terms/Privacy Policy page to point at. Tracked in docs/UNFORGET.md
        (S4); comes back here once real pages exist.
      */}
      <Text style={styles.terms}>
        By continuing, you agree to the <Text style={styles.termsLink}>Terms</Text> and{' '}
        <Text style={styles.termsLink}>Privacy Policy</Text>.
      </Text>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Wrong account?{' '}
          <Text
            style={styles.footerLink}
            accessibilityRole="link"
            onPress={() => router.replace('/sign-in')}
          >
            Sign in again
          </Text>
        </Text>
      </View>
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
  heading: {
    fontWeight: '700',
    fontSize: 24,
    color: '#F2F5F9',
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 20,
    color: '#97A2B4',
    marginTop: 4,
  },
  identityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1E242E',
    backgroundColor: '#12161D',
    marginBottom: 4,
  },
  identityAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  identityTextCol: {
    flexShrink: 1,
  },
  identityLabel: {
    fontSize: 12,
    color: '#5F6C7E',
  },
  identityEmail: {
    fontSize: 14,
    fontWeight: '500',
    color: '#F2F5F9',
  },
  formError: {
    fontSize: 14,
    color: '#F2F5F9',
  },
  terms: {
    fontSize: 11,
    lineHeight: 16,
    color: '#5F6C7E',
    textAlign: 'center',
  },
  termsLink: {
    color: '#868CF8',
    fontWeight: '500',
  },
  footer: {
    alignItems: 'center',
    paddingTop: 8,
  },
  footerText: {
    fontSize: 14,
    color: '#97A2B4',
  },
  footerLink: {
    fontWeight: '500',
    color: '#868CF8',
  },
});
