import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import { useAuthStore } from '../auth/store.ts';

import { draftStateStorage } from './draft-storage.ts';

// The shared half of both onboarding draft stores. Two consumers, so it
// lives here rather than being copied into each (`code-conventions` §1) —
// and the per-user scoping below is the part that must not be copied,
// because a second, subtly different copy of it is the leak this task
// exists to prevent.

/**
 * What a draft field may hold. Deliberately narrow: every member JSON
 * round-trips by construction, which is the `persist` middleware's only
 * real requirement and cheaper to enforce here than to remember at each
 * call site.
 */
export type OnboardingDraftValue = string | number | boolean | null | readonly string[];

export type OnboardingDraftFields = Record<string, OnboardingDraftValue>;

export type OnboardingDraftState<TFields extends OnboardingDraftFields> = {
  currentStep: number;
  fields: TFields;
  /**
   * Internal bookkeeping, not part of the flow's API: whoever last wrote
   * to this draft. `bindDraftToSignedInUser` compares it against the
   * signed-in user and throws the draft away when they differ.
   */
  draftUserId: string | null;
  setStep: (step: number) => void;
  updateField: <TKey extends keyof TFields>(key: TKey, value: TFields[TKey]) => void;
  reset: () => void;
};

/** Bump to discard every stored draft when the persisted shape changes. */
const DRAFT_SCHEMA_VERSION = 1;

type PersistedDraft<TFields extends OnboardingDraftFields> = {
  currentStep: number;
  draftUserId: string | null;
  fields: Partial<TFields>;
};

function isPersistedDraft<TFields extends OnboardingDraftFields>(
  value: unknown,
): value is PersistedDraft<TFields> {
  if (typeof value !== 'object' || value === null) return false;
  const draft = value as Record<string, unknown>;
  return (
    typeof draft.currentStep === 'number' &&
    (draft.draftUserId === null || typeof draft.draftUserId === 'string') &&
    typeof draft.fields === 'object' &&
    draft.fields !== null
  );
}

/** `null` unless a session is actually established — 'loading' is not "signed in". */
function signedInUserId(): string | null {
  const { status, userId } = useAuthStore.getState();
  return status === 'authenticated' ? userId : null;
}

export function createOnboardingDraftStore<TFields extends OnboardingDraftFields>(
  storageKey: string,
  initialFields: TFields,
) {
  const useStore = create<OnboardingDraftState<TFields>>()(
    persist(
      (set) => ({
        currentStep: 0,
        fields: { ...initialFields },
        draftUserId: null,

        setStep: (step) => set({ currentStep: step, draftUserId: signedInUserId() }),

        updateField: (key, value) =>
          set((state) => {
            const fields = { ...state.fields };
            fields[key] = value;
            return { fields, draftUserId: signedInUserId() };
          }),

        reset: () => {
          set({ currentStep: 0, fields: { ...initialFields }, draftUserId: null });
          // `set` above has already written the empty draft back; drop the
          // row too so a completed or abandoned flow leaves nothing behind.
          draftStateStorage.removeItem(storageKey);
        },
      }),
      {
        name: storageKey,
        version: DRAFT_SCHEMA_VERSION,
        storage: createJSONStorage(() => draftStateStorage),
        partialize: ({ currentStep, fields, draftUserId }) => ({
          currentStep,
          fields,
          draftUserId,
        }),
        // The default merge is shallow, which would replace `fields`
        // wholesale — a draft written before a later step added a field
        // would then rehydrate that field as `undefined` while its type
        // says otherwise. Merging over the initial fields keeps the shape
        // whole, and the guard means an unreadable row starts clean
        // instead of throwing on the first frame of the flow.
        merge: (persisted, current) => {
          if (!isPersistedDraft<TFields>(persisted)) return current;
          return {
            ...current,
            currentStep: persisted.currentStep,
            draftUserId: persisted.draftUserId,
            fields: { ...current.fields, ...persisted.fields },
          };
        },
      },
    ),
  );

  bindDraftToSignedInUser(useStore);
  return useStore;
}

/**
 * The rule the task's stated risk turns on: a draft belongs to exactly one
 * user, and the moment the signed-in user is anyone else — including nobody,
 * i.e. signed out — it is discarded. `draftUserId` is stamped on every
 * write, so this holds without a per-user storage key, which `persist`
 * cannot give us anyway: the key is fixed at store creation, and at that
 * point auth is still `loading` and has no user to key on.
 *
 * Checked once immediately (the flow may be entered long after auth
 * resolved, so the subscription alone would never fire) and on every
 * subsequent auth change.
 */
function bindDraftToSignedInUser<TFields extends OnboardingDraftFields>(store: {
  getState: () => OnboardingDraftState<TFields>;
}): void {
  const enforce = (auth: ReturnType<typeof useAuthStore.getState>): void => {
    // Cold start: nothing is known yet, and discarding here would throw
    // away the draft this task exists to resume.
    if (auth.status === 'loading') return;

    const userId = auth.status === 'authenticated' ? auth.userId : null;
    const draft = store.getState();
    if (draft.draftUserId === userId) return;

    draft.reset();
  };

  enforce(useAuthStore.getState());
  useAuthStore.subscribe(enforce);
}
