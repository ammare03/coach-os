import { Card, createThemedStyles, radius, spacing, Text, useTheme } from '@coachos/ui';
import { CalendarCheck, Clock, MessageCircle } from 'lucide-react-native';
import type { ComponentType } from 'react';
import { StyleSheet, View } from 'react-native';

// `phase-06-onboarding/client-onboarding/05` — the rationale, and only the
// rationale.
//
// The OS prompt is fired by the flow's primary action AFTER this screen has
// been read and acted on, never before. `CLAUDE.md` §7.5 restricts native
// alerts to a short list and an OS permission prompt with no context is
// exactly the pattern that rule exists to prevent: a person who declines a
// prompt they did not understand cannot be asked again by the app, only by
// Settings, so the one chance to explain has to come first.
//
// This component requests nothing and writes nothing. Requesting is
// `useNotificationPermission`'s and completing is
// `useFinishClientOnboarding`'s — this is the screen that earns the tap.

interface Reason {
  Icon: ComponentType<{ size?: number; color?: string }>;
  title: string;
  description: string;
}

const REASONS: readonly Reason[] = [
  {
    Icon: MessageCircle,
    title: 'When your coach replies',
    description: 'Feedback on a set, a video, or a message.',
  },
  {
    Icon: Clock,
    title: 'Today’s session',
    description: 'One reminder on the days you’re training.',
  },
  {
    Icon: CalendarCheck,
    title: 'Check-ins that are due',
    description: 'So a week doesn’t pass without your coach hearing from you.',
  },
];

export interface NotificationPermissionStepProps {
  /** Present only after the final write came back failed. */
  error?: string | undefined;
}

export function NotificationPermissionStep({ error }: NotificationPermissionStepProps) {
  const theme = useTheme();
  const themed = useThemedStyles();

  return (
    <View style={styles.block}>
      {REASONS.map(({ Icon, title, description }) => (
        <Card key={title}>
          <View style={styles.row}>
            <View style={[styles.glyph, themed.glyph]}>
              <Icon size={18} color={theme.colors.brand.DEFAULT} />
            </View>
            <View style={styles.text}>
              <Text size="body-lg">{title}</Text>
              <Text size="body-sm" tone="muted" style={styles.description}>
                {description}
              </Text>
            </View>
          </View>
        </Card>
      ))}

      <Card elevation="tinted">
        <Text size="body" tone="muted">
          Your phone will ask next. Whichever you choose, you’re done after this — notifications
          aren’t part of finishing setup.
        </Text>
      </Card>

      {error === undefined ? null : (
        <Text size="body-sm" tone="urgent" accessibilityRole="alert">
          {error}
        </Text>
      )}
    </View>
  );
}

const GLYPH_SIZE = 36;

const styles = StyleSheet.create({
  block: { gap: spacing(10) },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing(13) },
  text: { flex: 1 },
  description: { marginTop: spacing(3) },
  glyph: {
    width: GLYPH_SIZE,
    height: GLYPH_SIZE,
    borderRadius: radius.control,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

const useThemedStyles = createThemedStyles((theme) => ({
  glyph: {
    backgroundColor: theme.colors.bg.inset,
    borderColor: theme.colors.border.strong,
  },
}));
