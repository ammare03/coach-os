import { Input, Text } from '@coachos/ui';
import { createThemedStyles, radius, spacing } from '@coachos/ui/theme';
import { StyleSheet, View } from 'react-native';

// `phase-09-workout-logger/session-summary/03` — the free-text half of the
// capture. Design: `rpe-and-notes.html`, frames B and C.
//
// Four decisions, in the order they matter:
//
// (a) **The session's own record is shown and is NOT editable.** Task 03's
//     first acceptance criterion is that the field is never presented empty
//     when `client_notes` already holds something, and its Risks section
//     names what a literal pre-fill costs: bind the input to the column and
//     the first character the client types destroys
//     `session-modifications/03`'s skip record. Both are satisfied by
//     putting the record ABOVE the input rather than inside it — the client
//     sees every character the note will carry and can reach none of it.
//     `composeSessionNotes` then appends their words beneath it. There is no
//     code path in which the input is the whole column.
//
// (b) **The record is a borderless tinted block directly above the field,
//     not a second bordered box.** `Input` draws its own 1px edge and
//     exposes no way to suppress it, so a bordered wrapper around both would
//     put a rounded rectangle inside a rounded rectangle — and two bordered
//     boxes side by side would read as two fields and send the client
//     looking for the edit affordance on the first. One border on the screen,
//     belonging to the one thing that is editable, and a tinted ground plus
//     a tight gap to say the two belong together. (The mock drew a single
//     bordered well containing both; that shape is not reachable without
//     forking the primitive.)
//
// (c) **The record is labelled, not silent.** Text the client did not type
//     appearing in their note needs one line saying where it came from, or
//     it reads as the app having written something on their behalf.
//
// (d) **The field is optional and says so once.** The placeholder carries
//     it; the helper states where the words go rather than what the client
//     ought to write (`COPY.md` CO§2 — nothing here asks them to justify
//     their session).

export const SESSION_NOTE_COPY = {
  label: 'Note for your coach',
  placeholder: 'Anything you want them to know',
  /** The spoken name of a field whose visible label sits above it. */
  accessibilityLabel: 'Note for your coach, optional',
  /** Decision (c). Names the source; never apologises for it. */
  priorLabel: 'From this session',
  /** Where the words end up. A fact, not an instruction — decision (d). */
  helper: 'Your coach reads this with your session.',
} as const;

/** A note is a few sentences to a coach, not an essay. The composed column allows 4,000. */
const NOTE_MAX_LENGTH = 500;

export interface SessionNoteFieldProps {
  /**
   * The session's own record — every skip, as `composeSkipNotes` words them.
   * `''` hides the block entirely; an empty labelled box would be a section
   * about nothing.
   */
  priorNotes: string;
  /** The client's own words, and only those — never the composed column. */
  value: string;
  onChangeText: (value: string) => void;
}

export function SessionNoteField({ priorNotes, value, onChangeText }: SessionNoteFieldProps) {
  const themed = useThemedStyles();
  const hasPrior = priorNotes.trim().length > 0;

  return (
    <View style={styles.block}>
      <Text size="title">{SESSION_NOTE_COPY.label}</Text>

      <View style={styles.well} testID="session-note-well">
        {hasPrior ? (
          // Reads as one item rather than two fragments (`accessibility` §2),
          // and carries its own label so a screen-reader client hears where
          // the words came from before hearing them.
          <View
            style={[styles.prior, themed.prior]}
            accessible
            accessibilityLabel={`${SESSION_NOTE_COPY.priorLabel}. ${priorNotes}`}
            testID="session-note-prior"
          >
            <Text size="eyebrow" tone="subtle" style={styles.priorLabel}>
              {SESSION_NOTE_COPY.priorLabel}
            </Text>
            {/* No `numberOfLines`: a skip the client explained in their own
                words is theirs, and this screen does not cut it. */}
            <Text size="body-sm" tone="warm-muted">
              {priorNotes}
            </Text>
          </View>
        ) : null}

        <Input
          value={value}
          onChangeText={onChangeText}
          placeholder={SESSION_NOTE_COPY.placeholder}
          density="client"
          multiline
          maxLength={NOTE_MAX_LENGTH}
          autoCapitalize="sentences"
          accessibilityLabel={SESSION_NOTE_COPY.accessibilityLabel}
          testID="session-note-input"
        />
      </View>

      <Text size="body-sm" tone="subtle">
        {SESSION_NOTE_COPY.helper}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    gap: spacing(6),
  },
  well: {
    // Tight, so the record and the field read as one unit — the block's own
    // `gap` is what separates that unit from the label and the helper.
    gap: spacing(4),
    marginTop: spacing(4),
  },
  prior: {
    borderRadius: radius.control,
    paddingHorizontal: spacing(14),
    paddingVertical: spacing(12),
    gap: spacing(5),
  },
  priorLabel: {
    textTransform: 'uppercase',
  },
});

const useThemedStyles = createThemedStyles(({ colors }) => ({
  prior: {
    // Decision (b): a tinted ground and no border at all, so the one edge on
    // this surface belongs to the one thing the client can type into.
    backgroundColor: colors.bg.raised,
  },
}));
