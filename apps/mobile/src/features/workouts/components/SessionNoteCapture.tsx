import { Button, Text } from '@coachos/ui';
import { spacing, tapTarget, useTheme } from '@coachos/ui/theme';
import { Check } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, StyleSheet, View } from 'react-native';

import { useUpdateSessionNotes } from '../hooks/useUpdateSessionNotes.ts';

import { PerceivedExertionPicker } from './PerceivedExertionPicker.tsx';
import { SessionNoteField } from './SessionNoteField.tsx';

// `phase-09-workout-logger/session-summary/03` — the capture, whole.
// Design: `rpe-and-notes.html` in the P09 session-summary project.
//
// Six decisions, in the order they matter:
//
// (a) **Self-contained, and it does not know where it is mounted.**
//     `session-summary/02` puts it behind a dismissible "Add a note" prompt;
//     until then `SessionSummaryScreen` renders it inline. It takes a session
//     id and nothing else, holds its own draft, and has no opinion about
//     whether something above it decided to show it.
//
// (b) **Nothing here is required, and nothing here gates Done.** Task 03's
//     fourth criterion. The screen's primary action sits below this in a
//     foot that never reads this component's state, so a client who ignores
//     both fields leaves with a fully valid, fully queued session — which is
//     also why a failed save is reported inline rather than as a screen
//     state (`screen-composition` §3).
//
// (c) **An explicit Save, inert until something changed.** Saving on blur
//     would make a tap outside the field a write and would leave the client
//     no moment that says their words are kept; and the comparison is
//     against what is STORED, not against empty, so re-opening a saved
//     capture does not offer to save it again.
//
// (d) **It is a secondary button, never the gradient.** Done is this
//     screen's one primary action, and two peach buttons would ask the
//     client which of them finishes the workout (`DESIGN.md` §9).
//
// (e) **The result is announced, not only drawn.** An optimistic write with
//     no announcement is invisible to a screen-reader client, who would have
//     no way to know whether the tap landed (`accessibility` §2).
//
// (f) **A failed save says the session is safe first.** The one thing a
//     client fears at this moment is having lost the workout, and they have
//     not: the completion is a separate outbox entry queued before this
//     screen ever opened (`ERRORS.md` ER§1.4's ordering — what happened,
//     then the reassurance, then the retry).

export const NOTE_CAPTURE_COPY = {
  save: 'Save',
  saved: 'Saved',
  /** Announced, so an optimistic write is not silent — decision (e). */
  savedAnnouncement: 'Note saved',
  /** Decision (f). */
  error: 'Couldn’t save that. Your session is saved — try again.',
} as const;

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface SessionNoteCaptureProps {
  /** `local_workout_sessions.client_local_id` — the id the summary route carries. */
  sessionLocalId: string;
}

export function SessionNoteCapture({ sessionLocalId }: SessionNoteCaptureProps) {
  const { colors } = useTheme();
  const { priorNotes, stored, save } = useUpdateSessionNotes(sessionLocalId);

  const [exertion, setExertion] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [status, setStatus] = useState<SaveStatus>('idle');

  // Seeded once, from the local read, and **never over anything the client
  // has already done**. The read is local and lands in a millisecond or two,
  // but a tap inside that window is a real tap: without the second guard the
  // effect arrives afterwards and quietly puts the field back the way it
  // was, which reads as the app having ignored them.
  const isSeeded = useRef(false);
  const hasEdited = useRef(false);
  useEffect(() => {
    if (isSeeded.current || hasEdited.current || stored === null) return;
    isSeeded.current = true;
    setExertion(stored.perceivedExertion);
    setNote(stored.clientNote);
  }, [stored]);

  // Decision (c) — against what is stored, so nothing is offered twice.
  const isDirty =
    stored === null
      ? exertion !== null || note.trim().length > 0
      : exertion !== stored.perceivedExertion || note.trim() !== stored.clientNote.trim();

  async function handleSave() {
    setStatus('saving');
    try {
      await save({ perceivedExertion: exertion, clientNote: note });
      setStatus('saved');
      AccessibilityInfo.announceForAccessibility(NOTE_CAPTURE_COPY.savedAnnouncement);
    } catch {
      // The error itself carries the session's contents, so it is never
      // logged and never reported (`observability-ops` §1). The client is
      // told what to do, and the completion is untouched either way.
      setStatus('error');
    }
  }

  return (
    <View style={styles.block} testID="session-note-capture">
      <PerceivedExertionPicker
        value={exertion}
        onChange={(next) => {
          hasEdited.current = true;
          setExertion(next);
          if (status !== 'idle') setStatus('idle');
        }}
      />

      <SessionNoteField
        priorNotes={priorNotes}
        value={note}
        onChangeText={(next) => {
          hasEdited.current = true;
          setNote(next);
          if (status !== 'idle') setStatus('idle');
        }}
      />

      {status === 'error' ? (
        <Text size="body-sm" tone="urgent" testID="session-note-error">
          {NOTE_CAPTURE_COPY.error}
        </Text>
      ) : null}

      {status === 'saved' && !isDirty ? (
        <View style={styles.saved} accessible accessibilityLabel={NOTE_CAPTURE_COPY.saved}>
          <Check size={16} color={colors.fg.warm} />
          <Text size="body-sm" tone="warm">
            {NOTE_CAPTURE_COPY.saved}
          </Text>
        </View>
      ) : (
        <Button
          variant="secondary"
          size="md"
          density="client"
          fullWidth
          disabled={!isDirty || status === 'saving'}
          loading={status === 'saving'}
          onPress={() => {
            void handleSave();
          }}
          accessibilityLabel={NOTE_CAPTURE_COPY.save}
          testID="session-note-save"
        >
          {NOTE_CAPTURE_COPY.save}
        </Button>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    gap: spacing(18),
  },
  saved: {
    // The button's own footprint, so confirming a save does not move the
    // screen under a thumb already reaching for Done.
    minHeight: tapTarget.MID_SET,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing(8),
  },
});
