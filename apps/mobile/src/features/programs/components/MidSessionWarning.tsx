import { Card, IconButton, Text } from '@coachos/ui';
import { spacing, useTheme } from '@coachos/ui/theme';
import { Info, X } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import { midSessionWarning } from '../mid-session.ts';

// `session-runtime/09` step 5 — what a coach sees the moment they save a
// change to a day a client is currently inside.
//
// Four decisions:
//
// (a) **It stacks directly on the action bar, not at the top of the
//     scroll.** A coach who has just saved is looking at the block they
//     edited, which may be anywhere in a long day. A notice at the top of
//     the list is a notice they will not see. This sits immediately above
//     the publish bar, beside the bar's own "sees this Tuesday morning"
//     line — which is precisely the line it qualifies.
//
// (b) **Level 3, the tinted card**, the same treatment
//     `AssignProgramSheet`'s conflict card uses for the same job: "this one
//     is different", said without spending a semantic colour (`DESIGN.md`
//     §2). Not urgent red — nothing has failed. Not glass — the action bar
//     beneath it is Tier-1, and §4 never nests glass.
//
// (c) **Nothing is blocked, and the copy says so.** The save landed. There
//     is no confirm, no "are you sure", no disabled button, and no retry:
//     this is a sequencing rule, not a locking one. The second sentence is
//     the one the coach acts on, so `../mid-session.ts` never omits it.
//
// (d) **Dismissible, at 44px.** `DESIGN.md` §13's 52px floor is for
//     controls used mid-set; a coach is at a desk, and the notice covers
//     their work. It returns on the next save that is still true, which is
//     the behaviour a coach expects from something that reports a live
//     fact rather than an event.

export interface MidSessionWarningProps {
  /** `users.name` of each client with an `in_progress` session on this day. */
  names: string[];
  onDismiss: () => void;
}

export function MidSessionWarning({ names, onDismiss }: MidSessionWarningProps) {
  const theme = useTheme();
  const message = midSessionWarning(names);

  // `null` is the overwhelmingly common case. A permanent "0 clients are
  // training" would train a coach to stop reading the row that matters.
  if (message === null) return null;

  return (
    <Card elevation="tinted" density="coach" testID="mid-session-warning">
      <View style={styles.row}>
        <Info
          size={18}
          color={theme.colors.brand.DEFAULT}
          accessibilityElementsHidden
          importantForAccessibility="no"
        />
        {/* `alert`, not `text`: a coach who has just pressed Save has their
            attention on the sheet that closed, and this is the one thing on
            the screen that contradicts what they think just happened. */}
        <Text size="body-sm" style={styles.said} accessibilityRole="alert">
          {message}
        </Text>
        {/* `md` (44) — decision (d). `sm` would clear the same floor with
            hit-slop, but this control sits flush against the card's edge
            and an invisible slop there overlaps the text. */}
        <IconButton
          icon={<X size={16} color={theme.colors.fg['warm-muted']} />}
          size="md"
          variant="ghost"
          accessibilityLabel="Dismiss"
          onPress={onDismiss}
          testID="mid-session-warning-dismiss"
        />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: spacing(10),
  },
  // No `numberOfLines`: at 200% text the line grows and the card grows with
  // it. Truncating the name, or the sentence that says when the change
  // lands, would leave a coach with exactly the wrong half.
  said: {
    flex: 1,
  },
});
