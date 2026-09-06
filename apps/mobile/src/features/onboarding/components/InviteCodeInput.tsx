import { createThemedStyles, radius, spacing, tapTarget, Text } from '@coachos/ui';
import { useRef } from 'react';
import { Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';

// `client-onboarding/01`, Approach step 3 — the eight-character code, one
// character per box.
//
// One real `TextInput`, held transparent and stretched over the row, with
// eight views drawn under it. That is what gives the caret a place to be
// while still showing the person where they are in a code they are copying
// off another screen — a single 8-character field is the same data and a
// worse read at arm's length in a gym doorway.
//
// It lives here rather than in `packages/ui` because it has exactly one
// consumer and it knows the invite code's alphabet, which is product
// knowledge a UI primitive may not carry (`code-conventions` §1).

/** `invites/03`'s unambiguous alphabet: 2-9 and A-Z minus I and O. */
const ALLOWED = /[^2-9A-HJ-NP-Z]/g;

export const INVITE_CODE_LENGTH = 8;

export interface InviteCodeInputProps {
  value: string;
  onChangeText: (value: string) => void;
  onSubmit?: (() => void) | undefined;
  editable?: boolean;
}

/** Upper-cases and drops anything outside the alphabet, so a pasted code with spaces still lands. */
export function normaliseInviteCode(raw: string): string {
  return raw.toUpperCase().replace(ALLOWED, '').slice(0, INVITE_CODE_LENGTH);
}

export function InviteCodeInput({
  value,
  onChangeText,
  onSubmit,
  editable = true,
}: InviteCodeInputProps) {
  const input = useRef<TextInput>(null);
  const themed = useThemedStyles();
  const filled = value.length;

  return (
    <Pressable onPress={() => input.current?.focus()} accessibilityRole="none" style={styles.wrap}>
      <View style={styles.row} importantForAccessibility="no-hide-descendants">
        {Array.from({ length: INVITE_CODE_LENGTH }, (_, index) => (
          <View
            key={index}
            style={[styles.box, themed.box, index === filled && editable ? themed.boxActive : null]}
          >
            <Text size="h2" style={styles.char}>
              {value[index] ?? ''}
            </Text>
          </View>
        ))}
      </View>

      {/* The caret's actual home. Transparent rather than hidden: a
          zero-size or `display:none` input cannot hold focus on Android. */}
      <TextInput
        ref={input}
        value={value}
        onChangeText={(raw) => onChangeText(normaliseInviteCode(raw))}
        onSubmitEditing={onSubmit}
        editable={editable}
        maxLength={INVITE_CODE_LENGTH}
        autoCapitalize="characters"
        autoCorrect={false}
        autoComplete="one-time-code"
        textContentType="oneTimeCode"
        keyboardType={Platform.OS === 'ios' ? 'ascii-capable' : 'visible-password'}
        returnKeyType="go"
        accessibilityLabel="Invite code"
        accessibilityHint="Eight characters, from the email your coach sent"
        style={styles.field}
      />
    </Pressable>
  );
}

const BOX_HEIGHT = 60;

const styles = StyleSheet.create({
  wrap: { position: 'relative', minHeight: tapTarget.MIN },
  row: { flexDirection: 'row', gap: spacing(6) },
  box: {
    flex: 1,
    height: BOX_HEIGHT,
    borderRadius: radius.card,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  char: { fontVariant: ['tabular-nums'] },
  field: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    // Both the text and the caret are invisible; the boxes below are what
    // the person reads. `opacity: 0` would take the caret with it on iOS
    // but also stop VoiceOver reaching the field, hence the colour route.
    color: 'transparent',
    // Letter-spacing keeps the (invisible) selection roughly over the box
    // being typed into, so a long-press "select all" lands where expected.
    letterSpacing: 28,
    fontSize: 22,
    textAlign: 'center',
  },
});

const useThemedStyles = createThemedStyles((theme) => ({
  box: {
    backgroundColor: theme.colors.bg.inset,
    borderColor: theme.colors.border.DEFAULT,
  },
  boxActive: { borderColor: theme.colors.brand.DEFAULT },
}));
