import { ConfirmModal, ListRow, useToast, type Density } from '@coachos/ui';
import { DoorOpen } from 'lucide-react-native';
import { useState } from 'react';

import { useConnectivity } from '../../../lib/connectivity/useConnectivity.ts';
import { getErrorCode } from '../../../lib/error-code.ts';
import { api } from '../../../lib/trpc.ts';

// `relationship-controls/02`. Design: `leave-coach.html`, frames A, C, D, E.
//
// Four decisions this file holds:
//
// 1. **`ConfirmModal`, not an undo toast.** Leaving releases a seat and
//    starts a 30-day clock on somebody else's access; five seconds cannot
//    honestly cover either. This is the third sanctioned typed confirmation
//    in the product, after account deletion and client archival — the
//    review that component's doc comment asks for is this task.
//
// 2. **`DoorOpen`, not `LogOut` or `UserMinus`.** Sign out already owns
//    `LogOut` on this screen and two destructive rows must not share a
//    glyph. `UserMinus` inverts who is acting — it reads as "remove
//    someone", and the client is the one leaving.
//
// 3. **Never an outbox mutation.** A queued copy of this could fire days
//    later against a relationship that has since changed. The action is
//    gated on `useConnectivity()` and says so rather than queueing.
//
// 4. **The row takes the coach, it does not fetch one.** `CoachingSection`
//    resolves the name once for both its rows (task 03's included), so no
//    row on this screen runs a query (`screen-composition` §2).

/**
 * The word. Uppercase, matched case-sensitively and untrimmed by
 * `ConfirmModal` — the friction is the feature, and a token autocorrect
 * completes for you is not friction. Sibling of
 * `DELETE_CONFIRMATION_WORD`, for the same reason.
 */
export const LEAVE_CONFIRMATION_WORD = 'LEAVE';

/**
 * `product-copy` §5 — what happened, then what to do, and never a queued
 * promise this path deliberately does not make.
 */
const OFFLINE_MESSAGE = "Leaving a coach needs a connection. Try again when you're back online.";

/** The same generic the invite flow uses, so one failure never wears two voices. */
const GENERIC_MESSAGE = 'Something went wrong. Check your connection and try again.';

export interface LeaveCoachRowProps {
  /** Non-null here: the coachless branch is the section's, not the row's. */
  coach: { id: string; name: string };
  density?: Density;
}

/**
 * The three lines are `account-lifecycle/06`'s transition table said
 * plainly, and they are ONE string so a screen reader hears one statement
 * rather than three list items.
 *
 * Singular *they* after the named singular in line 1 — CoachOS collects no
 * gender. Line 3 states the seat release in the terms the client
 * experiences it; "the seat is released" is billing vocabulary aimed at
 * somebody who is not in this room.
 */
export function leaveCoachDialogBody(coachFirstName: string, message?: string | undefined): string {
  const lines = [
    `${coachFirstName} keeps read-only access to your sessions, check-ins, videos, comments and messages for 30 days. After that, nothing.`,
    'They lose access to your meals, measurements and photos straight away.',
    'You keep everything, forever. Your place on their client list is freed now.',
  ];
  // Appended rather than given its own slot: `ConfirmModal` is deliberately
  // narrow and this task may not widen its API. A failure therefore lands
  // directly above the field the client is about to retype into, which is
  // where they are already looking.
  if (message !== undefined) lines.push(message);
  return lines.join('\n\n');
}

/** The one place a coach's first name is derived — the dialog's only interpolation. */
export function coachFirstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? fullName;
}

export function LeaveCoachRow({ coach, density }: LeaveCoachRowProps) {
  const { showToast } = useToast();
  const { isConnected } = useConnectivity();
  const utils = api.useUtils();
  const leaveCoach = api.clientApp.leaveCoach.useMutation();

  const [isOpen, setIsOpen] = useState(false);
  const [message, setMessage] = useState<string | undefined>(undefined);

  function close() {
    setIsOpen(false);
    setMessage(undefined);
  }

  /**
   * `announce` is false for the race below. The toast's second sentence
   * claims the other party was told, and on that path they are the one who
   * told us.
   */
  function land(announce: boolean) {
    close();
    // The `clientApp` router, not `invalidate()` with no key: every read
    // whose answer the relationship changes lives under it — `coach` and
    // the cached `history` that carries the coach's feedback.
    void utils.clientApp.invalidate();
    if (announce) {
      showToast({ message: `You've left ${coach.name}. We've let them know.` });
    }
  }

  function handleConfirm() {
    if (!isConnected) {
      setMessage(OFFLINE_MESSAGE);
      return;
    }
    setMessage(undefined);
    leaveCoach.mutate(undefined, {
      onSuccess: () => land(true),
      onError: (error) => {
        // The coach released this client from their side while the dialog
        // was open. The outcome the client wanted is the outcome they got,
        // so this is a race rather than a failure (`ERRORS.md` ER§1.1).
        if (getErrorCode(error) === 'CLIENT_HAS_NO_COACH') {
          land(false);
          return;
        }
        // The dialog stays open and the typed word stays typed, so
        // retrying is one tap rather than the whole word again.
        setMessage(GENERIC_MESSAGE);
      },
    });
  }

  return (
    <>
      <ListRow
        label="Leave coach"
        // The full name, and the one place a client sees exactly who they
        // are about to leave. Task 03's row uses the first name.
        description={`Your coach is ${coach.name}`}
        icon={DoorOpen}
        // Acts rather than navigates, so `ListRow` draws no chevron.
        destructive
        accessibilityHint="Opens a confirmation you must type into"
        onPress={() => setIsOpen(true)}
        testID="settings-leave-coach"
        {...(density ? { density } : {})}
      />
      <ConfirmModal
        isOpen={isOpen}
        onCancel={close}
        onConfirm={handleConfirm}
        title={`Leave ${coach.name}`}
        body={leaveCoachDialogBody(coachFirstName(coach.name), message)}
        confirmationText={LEAVE_CONFIRMATION_WORD}
        actionLabel="Leave coach"
        isConfirming={leaveCoach.isPending}
        testID="leave-coach-confirm"
      />
    </>
  );
}
