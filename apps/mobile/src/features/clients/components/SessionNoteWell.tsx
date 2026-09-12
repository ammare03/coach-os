import { Card, Text } from '@coachos/ui';
import { spacing } from '@coachos/ui/theme';
import { StyleSheet, View } from 'react-native';

// `session-review/01` — the client's own words, in an L1 inset well.
//
// Deliberately quieter than a card: it is the client's voice, not the
// product's, and it is not an alert. The screen adds no word to it and
// passes no judgement on it — a coach reads these aloud (`COPY.md` CO§1).
//
// Two consumers, one shape: the session note, and the reason a whole
// session was skipped. Both are the client explaining themselves, so
// neither gets a louder surface than the other.

export const SESSION_NOTE_COPY = {
  clientNote: "Client's note",
  /**
   * The whole-session skip. The same word the per-exercise skip row uses,
   * so a coach meets one vocabulary for one fact.
   */
  skipped: 'Skipped',
} as const;

export interface SessionNoteWellProps {
  label: string;
  body: string;
  testID?: string;
}

export function SessionNoteWell({ label, body, testID }: SessionNoteWellProps) {
  return (
    <Card
      elevation="inset"
      density="coach"
      padded={false}
      // `exactOptionalPropertyTypes` (`code-conventions` §3) — `Card` types
      // `testID` as optional, which is not the same as accepting an explicit
      // `undefined`.
      {...(testID === undefined ? {} : { testID })}
    >
      {/* One accessible element: the eyebrow names what the paragraph is,
          and two stops for one quotation is one too many
          (`accessibility` §2). */}
      <View style={styles.well} accessible accessibilityLabel={`${label}. ${body}`}>
        <Text size="eyebrow" tone="muted">
          {label.toUpperCase()}
        </Text>
        {/* No `numberOfLines` — a client's note is the one thing on this
            screen a coach must read in full. */}
        <Text size="body-sm" tone="warm-muted" style={styles.body}>
          {body}
        </Text>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  well: {
    paddingVertical: spacing(12),
    paddingHorizontal: spacing(13),
  },
  body: {
    marginTop: spacing(6),
  },
});
