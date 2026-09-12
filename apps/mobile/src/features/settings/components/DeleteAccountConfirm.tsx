import { ConfirmModal } from '@coachos/ui';

/**
 * The word. Uppercase, matched case-sensitively and untrimmed by
 * `ConfirmModal` — the friction is the feature, and a token that
 * autocorrect completes for you is not friction.
 *
 * It is the one uppercase string in the product that is not an eyebrow
 * (`COPY.md` §CO6's sentence-case rule governs sentences; this is typed,
 * not read).
 */
export const DELETE_CONFIRMATION_WORD = 'DELETE';

export interface DeleteAccountConfirmProps {
  isOpen: boolean;
  /** A coach's consequences reach other people; a client's do not. */
  isCoach: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  isConfirming?: boolean;
}

/**
 * Account deletion is one of the two actions `ui-conventions` §5 exempts
 * from undo-not-confirm, so it gets `packages/ui`'s typed confirmation
 * rather than a five-second toast. Five seconds cannot honestly cover a
 * seven-day grace period that ends in a purge.
 *
 * This wrapper exists only to own the words. `ConfirmModal` is deliberately
 * narrow — no variant, no untyped mode, no "don't ask again" — and nothing
 * here widens it.
 *
 * **The body states the consequence, never asks a question** (`COPY.md`
 * §CO5): "Are you sure?" asks something the product already knows the
 * answer to, and trains people to tap past it.
 */
export function DeleteAccountConfirm({
  isOpen,
  isCoach,
  onCancel,
  onConfirm,
  isConfirming = false,
}: DeleteAccountConfirmProps) {
  return (
    <ConfirmModal
      isOpen={isOpen}
      onCancel={onCancel}
      onConfirm={onConfirm}
      title="Delete your account"
      body={
        isCoach
          ? 'Your account is scheduled for deletion in 7 days. Your clients are then told and have 30 days to export their history before they are detached.'
          : 'Your account is scheduled for deletion in 7 days. Everything you have logged is removed then, and your coach loses access to it.'
      }
      confirmationText={DELETE_CONFIRMATION_WORD}
      actionLabel="Delete account"
      isConfirming={isConfirming}
      testID="delete-account-confirm"
    />
  );
}
