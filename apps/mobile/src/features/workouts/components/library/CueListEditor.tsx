import {
  Card,
  createThemedStyles,
  Input,
  Pressable,
  radius,
  spacing,
  tapTarget,
  Text,
  useTheme,
} from '@coachos/ui';
import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react-native';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

// `cues` is `text[]`, and this is the editor that keeps it that way
// (`exercise-library/03`, Approach step 3).
//
// **Not a multiline textarea.** A textarea splits on newlines, which loses
// the distinction between a cue and a paragraph break the first time
// somebody pastes, and produces a one-element array containing a wall of
// text that the logger then renders as one very long line
// (`phase-09-workout-logger/session-runtime/04` draws these one per line at
// 16pt). Discrete rows are more work and are the right shape.

export interface CueListEditorProps {
  cues: readonly string[];
  onChange: (cues: string[]) => void;
  /** Matches the `MAX_CUES` cap on the shared Zod schema. */
  maxCues?: number;
  testID?: string;
}

const DEFAULT_MAX_CUES = 8;
const ROW_HEIGHT = 48;
const GUTTER = spacing(11);

export function CueListEditor({
  cues,
  onChange,
  maxCues = DEFAULT_MAX_CUES,
  testID,
}: CueListEditorProps) {
  const theme = useTheme();
  const themed = useThemedStyles();
  const [draft, setDraft] = useState('');

  function addDraft() {
    const trimmed = draft.trim();
    if (trimmed.length === 0 || cues.length >= maxCues) return;
    onChange([...cues, trimmed]);
    setDraft('');
  }

  function removeAt(index: number) {
    onChange(cues.filter((_, i) => i !== index));
  }

  // Move rather than drag: a drag handle inside a scrolling form fights the
  // scroll gesture, and a cue list is three or four items — two buttons are
  // both cheaper and reachable by a screen reader, which a drag is not
  // (`accessibility` §3).
  function move(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= cues.length) return;
    const next = [...cues];
    const [moved] = next.splice(index, 1);
    if (moved === undefined) return;
    next.splice(target, 0, moved);
    onChange(next);
  }

  return (
    <Card elevation="raised" {...(testID === undefined ? {} : { testID })}>
      {cues.map((cue, index) => (
        <View
          key={`${cue}-${String(index)}`}
          style={[styles.row, index < cues.length ? themed.divider : null]}
        >
          <Text size="body-sm" style={styles.cueText}>
            {cue}
          </Text>

          <Pressable
            onPress={() => {
              move(index, -1);
            }}
            disabled={index === 0}
            accessibilityRole="button"
            accessibilityLabel={`Move cue ${String(index + 1)} up`}
            style={styles.iconTarget}
            testID={`cue-up-${String(index)}`}
          >
            <ArrowUp
              size={16}
              color={index === 0 ? theme.colors.fg.faint : theme.colors.fg.muted}
            />
          </Pressable>

          <Pressable
            onPress={() => {
              move(index, 1);
            }}
            disabled={index === cues.length - 1}
            accessibilityRole="button"
            accessibilityLabel={`Move cue ${String(index + 1)} down`}
            style={styles.iconTarget}
            testID={`cue-down-${String(index)}`}
          >
            <ArrowDown
              size={16}
              color={index === cues.length - 1 ? theme.colors.fg.faint : theme.colors.fg.muted}
            />
          </Pressable>

          <Pressable
            onPress={() => {
              removeAt(index);
            }}
            accessibilityRole="button"
            accessibilityLabel={`Remove cue ${String(index + 1)}`}
            style={styles.iconTarget}
            testID={`cue-remove-${String(index)}`}
          >
            <X size={16} color={theme.colors.fg.muted} />
          </Pressable>
        </View>
      ))}

      {cues.length < maxCues ? (
        <View style={styles.addRow}>
          <View style={styles.addInput}>
            <Input
              value={draft}
              onChangeText={setDraft}
              onSubmitEditing={addDraft}
              placeholder="Add a cue"
              accessibilityLabel="New cue"
              returnKeyType="done"
              density="coach"
              testID="cue-draft"
            />
          </View>
          <Pressable
            onPress={addDraft}
            disabled={draft.trim().length === 0}
            accessibilityRole="button"
            accessibilityLabel="Add cue"
            style={styles.iconTarget}
            testID="cue-add"
          >
            <Plus
              size={18}
              color={draft.trim().length === 0 ? theme.colors.fg.faint : theme.colors.brand.DEFAULT}
            />
          </Pressable>
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: ROW_HEIGHT,
    paddingHorizontal: GUTTER,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(4),
  },
  cueText: { flex: 1, paddingVertical: spacing(9) },
  iconTarget: {
    width: tapTarget.MIN,
    height: tapTarget.MIN,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.control,
  },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(6),
    paddingHorizontal: GUTTER,
    paddingVertical: spacing(8),
  },
  addInput: { flex: 1 },
});

const useThemedStyles = createThemedStyles((t) => ({
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.colors.border.soft },
}));
