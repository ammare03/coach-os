import { Card, Text } from '@coachos/ui';
import { createThemedStyles, density, spacing, useTheme } from '@coachos/ui/theme';
import { Info } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import type { LocalSessionPayload } from '../../../lib/prefetch/sessions.ts';
import { hasProgramChanged } from '../lib/prescription.ts';
import {
  PROGRAM_CHANGED_FACT,
  PROGRAM_CHANGED_WHEN,
  speakProgramChanged,
} from '../lib/program-change-copy.ts';

// `session-runtime/09` step 4 — the client's one-time note, at the top of
// the session, above the exercise rail.
//
// **It renders only while the two prescriptions actually disagree.** The
// condition is `hasProgramChanged` (`../lib/prescription.ts`), derived from
// the frozen and live copies the device already holds — so it costs no
// request, it is right the moment the prefetch carrying the edit lands, and
// it is correctly absent offline, where no edit can have arrived.
//
// Four decisions:
//
// (a) **Inline and in flow, never a toast and never a modal.** A toast is
//     gone before a client between sets looks up, and it arrives over the
//     thing they are reading. The rule it reports — this session is frozen
//     — is true for the whole session, so the note is true for the whole
//     session too. The pages scroll beneath it.
//
// (b) **Level 3, the tinted card.** `DESIGN.md` §2 makes L3 the one way to
//     say "this item is different" without spending a semantic colour on
//     it. Glass is forbidden here twice over: §4 never nests glass, and the
//     shell header directly above this is a Tier-2 glass surface.
//
// (c) **No dismiss, deliberately.** Every control on this screen is pressed
//     mid-set, so §13's 52px floor would apply — which roughly doubles the
//     note's height for a button the client has no reason to press. A
//     dismissal would also have to survive an app kill, putting a fourth
//     writer on the session-recovery row for no gain. "Once" means one
//     instance, in one place, never repeated — not one that can be closed.
//
// (d) **One accessible element, one announcement.** The fact alone ("your
//     coach updated this workout") reads as something to act on; the
//     sentence that defuses it is the second one, so they are announced
//     together or not at all.
//
// It does not animate. `DESIGN.md` §5 forbids motion on a value the client
// is reading, and this note appears directly above one.

export interface ProgramChangedNoticeProps {
  /** The logger's session payload. `null` while the local read is in flight. */
  payload: LocalSessionPayload | null;
}

export function ProgramChangedNotice({ payload }: ProgramChangedNoticeProps) {
  const theme = useTheme();
  const themed = useThemedStyles();

  if (!hasProgramChanged(payload)) return null;

  return (
    <View style={styles.wrap} testID="program-changed-notice">
      <Card elevation="tinted" density="client">
        <View
          style={styles.row}
          accessible
          accessibilityRole="text"
          accessibilityLabel={speakProgramChanged()}
        >
          <Info
            size={18}
            color={theme.colors.brand.DEFAULT}
            style={styles.icon}
            // The icon repeats the text rather than adding to it, and
            // decision (d) merges the row into one announcement anyway.
            accessibilityElementsHidden
            importantForAccessibility="no"
          />
          {/* Two sentences, one paragraph: a single <Text> so they wrap as
              prose rather than as two blocks that can break apart at 200%
              text. The second is one tone quieter — the fact leads, what
              happens next follows. */}
          <Text size="body-lg" style={styles.said}>
            {PROGRAM_CHANGED_FACT}{' '}
            <Text size="body-lg" tone="warm-muted" style={themed.when}>
              {PROGRAM_CHANGED_WHEN}
            </Text>
          </Text>
        </View>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  // It carries its OWN gutter, because it mounts as a sibling of the
  // logger's body rather than inside it — the body is the pager's scroll
  // box and a note in there would travel with the pages. Same
  // `density.client.gutter` the body uses, so the two edges line up.
  //
  // The gap below it keeps the rail's spacing whether or not this renders.
  // Nothing sets a height: at 200% text the note grows to four lines and
  // pushes the rail down rather than clipping (`accessibility` §3).
  wrap: {
    paddingHorizontal: density.client.gutter,
    paddingBottom: spacing(12),
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    columnGap: spacing(10),
  },
  // Optically aligned to the first line's cap height rather than its box:
  // an 18px glyph against `body-lg`'s 23px line box sits high without it.
  // The smallest step on §1.4's scale, which is the right size of nudge.
  icon: {
    marginTop: spacing(3),
  },
  said: {
    flex: 1,
  },
});

// `tone` on the nested Text is enough on iOS; Android drops the inherited
// colour on a nested span in some RN versions, so the class is reasserted
// here rather than trusted.
const useThemedStyles = createThemedStyles((theme) => ({
  when: { color: theme.colors.fg['warm-muted'] },
}));
