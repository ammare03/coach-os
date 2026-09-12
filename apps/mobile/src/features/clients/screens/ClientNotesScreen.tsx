import {
  Button,
  Card,
  EmptyState,
  LoadingState,
  NotFoundState,
  Pressable,
  Text,
  createThemedStyles,
  createThemedValue,
  density,
  fontFamily,
  fontSize,
  radius,
  spacing,
  useUndoToast,
} from '@coachos/ui';
import { FlashList, type ListRenderItemInfo } from '@shopify/flash-list';
import { FileText, Plus, TriangleAlert } from 'lucide-react-native';
import { useState, type ReactElement } from 'react';
import { AccessibilityInfo, StyleSheet, TextInput, View } from 'react-native';

import { getErrorCode } from '../../../lib/error-code.ts';
import {
  useClientIdentity,
  useClientNotes,
  useDeleteNote,
  useSetNotePinned,
  useWriteNote,
  type CoachClientNote,
} from '../api.ts';
import { NoteRow } from '../components/NoteRow.tsx';
import { PrivacyLabel } from '../components/PrivacyLabel.tsx';

// §8.3's seventh tab: every private note this coach has written about this
// client, pinned first, with the pin toggle that decides what Overview
// shows.
//
// A **Scan list** (`UI-UX.md` §UX2) over one keyset-paginated query, with a
// FIXED HEAD above it. Two things never scroll, and both are decisions:
//
//   - the privacy label, because §8.3's requirement is that the tab is
//     *labelled explicitly*, and a label that scrolls away is only true at
//     offset zero;
//   - the compose affordance, because adding a note is this tab's one
//     write and a coach thirty notes deep must not scroll back to reach it
//     — and with the keyboard up, a composer anchored at the top is the
//     only one that stays visible.
//
// **No per-section error boundary, deliberately.** The list IS the tab
// (`screen-composition` §3: only primary content may fail the whole
// screen), and the shell survives regardless — the facet bar and the back
// control live in `_layout.tsx`.

/** Verbatim from the design. The eyebrow says where a pin *sends* a note. */
const PINNED_GROUP_LABEL = 'PINNED · SHOWN ON OVERVIEW';
const OTHER_GROUP_LABEL = 'OTHER NOTES';
const ADD_LABEL = 'Add a note';
const DELETED_MESSAGE = 'Note deleted';

const GUTTER = density.coach.gutter;

/** `.cinput`'s floor: a writing area, not a one-line field. */
const COMPOSER_INPUT_MIN_HEIGHT = 88;

export interface ClientNotesScreenProps {
  clientId: string;
  /** Where "not your client" leads. Never a query-dependent action (`screen-composition` §3). */
  onBack: () => void;
}

/**
 * "Priya Sharma" → "Priya". The composer and the empty state address the
 * client by name because a note is written *about a person*; the fallback
 * is a phrase rather than a blank, so the sentence is never half-formed
 * while the identity is still in flight.
 */
export function firstNameOf(name: string | undefined): string {
  const first = (name ?? '').trim().split(/\s+/u)[0];
  return first === undefined || first === '' ? 'this client' : first;
}

type ComposerTarget = { kind: 'create' } | { kind: 'edit'; note: CoachClientNote };

type NotesListItem =
  | { kind: 'header'; key: string; label: string; spaced: boolean }
  | { kind: 'note'; key: string; note: CoachClientNote };

const EMPTY_NOTES: readonly CoachClientNote[] = [];

export function ClientNotesScreen({ clientId, onBack }: ClientNotesScreenProps) {
  const themed = useThemedStyles();
  // The same cache entry the Overview tab and the facet bar already read,
  // narrowed by `select` — never a second request for a name (`api.ts`).
  const identity = useClientIdentity(clientId);
  const clientFirstName = firstNameOf(identity.data?.name);
  const notes = useClientNotes(clientId);
  const setPinned = useSetNotePinned(clientId);
  const remove = useDeleteNote(clientId);
  const write = useWriteNote(clientId);
  const showUndoToast = useUndoToast();

  const [composer, setComposer] = useState<ComposerTarget | null>(null);
  const [draft, setDraft] = useState('');

  const items = notes.data?.pages.flatMap((page) => page.items) ?? EMPTY_NOTES;

  function closeComposer(): void {
    setComposer(null);
    setDraft('');
    write.create.reset();
    write.update.reset();
  }

  function handleTogglePin(note: CoachClientNote, next: boolean): void {
    setPinned.mutate({ note, isPinned: next });
    // An optimistic change with no announcement is invisible to a screen
    // reader — `accessibility` §2's named failure. One per change.
    AccessibilityInfo.announceForAccessibility(
      next ? 'Pinned. This note now appears on Overview.' : 'Unpinned. Removed from Overview.',
    );
  }

  function handleDelete(note: CoachClientNote): void {
    // Undo, not confirm (`ui-conventions` §5). A note is not one of the two
    // typed-confirmation exceptions — the row goes now and comes back for
    // five seconds. Nothing reaches the server until the window closes, so
    // `Undo` has no delete to reverse.
    void remove.hide(note);
    if (composer?.kind === 'edit' && composer.note.noteId === note.noteId) closeComposer();
    AccessibilityInfo.announceForAccessibility('Note deleted. Undo is available for five seconds.');
    showUndoToast({
      message: DELETED_MESSAGE,
      onUndo: () => {
        void remove.restore(note);
      },
      onCommit: () => {
        remove.commit(note);
      },
    });
  }

  function handleEdit(note: CoachClientNote): void {
    setComposer({ kind: 'edit', note });
    setDraft(note.body);
  }

  function submitComposer(): void {
    const body = draft.trim();
    if (body === '' || composer === null) return;

    if (composer.kind === 'create') {
      write.create.mutate(body, {
        onSuccess: () => {
          closeComposer();
          AccessibilityInfo.announceForAccessibility('Note added.');
        },
      });
      return;
    }

    write.update.mutate(
      { note: composer.note, body },
      {
        onSuccess: () => {
          closeComposer();
          AccessibilityInfo.announceForAccessibility('Note saved.');
        },
      },
    );
  }

  // Deliberately not `useCallback`: every row is handed a closure over its
  // own note, so `NoteRow`'s `memo` is already bypassed and a stable
  // `renderItem` would buy nothing.
  const renderItem = ({ item }: ListRenderItemInfo<NotesListItem>): ReactElement => {
    if (item.kind === 'header') {
      return (
        <Text
          size="eyebrow"
          tone="muted"
          style={[styles.groupHead, item.spaced ? styles.groupHeadSpaced : null]}
        >
          {item.label}
        </Text>
      );
    }

    // The row is swapped for the composer rather than growing an
    // `isEditing` identity — the coach never loses which note they opened
    // because the composer sits at the row's own position.
    if (composer?.kind === 'edit' && composer.note.noteId === item.note.noteId) {
      return (
        <View style={styles.inlineComposer}>
          <NoteComposer
            mode="edit"
            clientFirstName={clientFirstName}
            value={draft}
            onChangeText={setDraft}
            onCancel={closeComposer}
            onSubmit={submitComposer}
            saving={write.update.isPending}
            failed={write.update.isError}
          />
        </View>
      );
    }

    const note = item.note;
    return (
      <NoteRow
        note={note}
        onTogglePin={(next) => {
          handleTogglePin(note, next);
        }}
        onEdit={() => {
          handleEdit(note);
        }}
        onDelete={() => {
          handleDelete(note);
        }}
      />
    );
  };

  return (
    <View style={[styles.flex, themed.screen]} testID="client-notes">
      {/* 12 + 46 + 9 + 48 + 10 = 125px of fixed head, bought deliberately. */}
      <View style={styles.fixed}>
        <PrivacyLabel />

        {composer?.kind === 'create' ? (
          <NoteComposer
            mode="create"
            clientFirstName={clientFirstName}
            value={draft}
            onChangeText={setDraft}
            onCancel={closeComposer}
            onSubmit={submitComposer}
            saving={write.create.isPending}
            failed={write.create.isError}
          />
        ) : (
          <AddNoteGhost
            clientFirstName={clientFirstName}
            onPress={() => {
              setComposer({ kind: 'create' });
              setDraft('');
            }}
          />
        )}
      </View>

      <NotesBody
        clientFirstName={clientFirstName}
        notes={notes}
        items={items}
        renderItem={renderItem}
        onBack={onBack}
      />
    </View>
  );
}

interface NotesBodyProps {
  clientFirstName: string;
  notes: ReturnType<typeof useClientNotes>;
  items: readonly CoachClientNote[];
  renderItem: (info: ListRenderItemInfo<NotesListItem>) => ReactElement;
  onBack: () => void;
}

function NotesBody({ clientFirstName, notes, items, renderItem, onBack }: NotesBodyProps) {
  if (notes.isPending) {
    return (
      <View style={styles.state}>
        <LoadingState
          shape="list"
          rows={6}
          density="coach"
          accessibilityLabel="Loading your notes"
        />
      </View>
    );
  }

  if (notes.isError) {
    return (
      <View style={styles.state}>
        <NotesFailure
          error={notes.error}
          onBack={onBack}
          onRetry={() => {
            void notes.refetch();
          }}
        />
      </View>
    );
  }

  if (items.length === 0) {
    return <NotesEmpty clientFirstName={clientFirstName} />;
  }

  return (
    <FlashList
      data={groupNotes(items)}
      keyExtractor={keyExtractor}
      getItemType={getItemType}
      renderItem={renderItem}
      onEndReachedThreshold={0.7}
      onEndReached={() => {
        // `hasNextPage` alone is not enough: `onEndReached` fires more than
        // once per arrival at the end of a list.
        if (notes.hasNextPage && !notes.isFetchingNextPage) {
          void notes.fetchNextPage();
        }
      }}
      contentContainerStyle={styles.list}
      showsVerticalScrollIndicator={false}
      // `NoteRow` pins its own `minHeight` — v2 has no `estimatedItemSize`
      // and passing one is a type error (`CLAUDE.md` §25.8).
      testID="client-notes-list"
    />
  );
}

/**
 * Pinned first, then reverse-chronological — applied here rather than asked
 * of `notes.listForClient`, which orders by `created_at DESC` alone. That
 * is what makes the optimistic pin free: flipping `isPinned` in the cache
 * moves the row with no refetch.
 *
 * The consequence, on the record: a pinned note that lives on page three is
 * grouped under **Pinned** only once page three has been read. Overview's
 * pinned list is unaffected — it is a separate, unpaginated server query.
 */
export function groupNotes(notes: readonly CoachClientNote[]): NotesListItem[] {
  const pinned = notes.filter((note) => note.isPinned);
  const rest = notes.filter((note) => !note.isPinned);
  const items: NotesListItem[] = [];

  if (pinned.length > 0) {
    items.push({ kind: 'header', key: 'head-pinned', label: PINNED_GROUP_LABEL, spaced: false });
    for (const note of pinned) items.push({ kind: 'note', key: note.noteId, note });
  }
  if (rest.length > 0) {
    items.push({
      kind: 'header',
      key: 'head-other',
      label: OTHER_GROUP_LABEL,
      spaced: pinned.length > 0,
    });
    for (const note of rest) items.push({ kind: 'note', key: note.noteId, note });
  }

  return items;
}

function keyExtractor(item: NotesListItem): string {
  return item.key;
}

function getItemType(item: NotesListItem): string {
  return item.kind;
}

interface AddNoteGhostProps {
  clientFirstName: string;
  onPress: () => void;
}

/** `DESIGN.md` §9's ghost/add: dashed edge, pill radius, warm ink. */
function AddNoteGhost({ clientFirstName, onPress }: AddNoteGhostProps) {
  const themed = useThemedStyles();
  const ghostInk = useGhostInk();

  return (
    <Pressable
      onPress={onPress}
      style={[styles.ghost, themed.ghost]}
      accessibilityRole="button"
      accessibilityLabel={ADD_LABEL}
      accessibilityHint={`Opens a box to write a private note about ${clientFirstName}`}
      testID="notes-add"
    >
      <Plus size={16} strokeWidth={2.2} color={ghostInk} />
      <Text size="label" tone="warm" className="font-sans-semibold">
        {ADD_LABEL}
      </Text>
    </Pressable>
  );
}

interface NoteComposerProps {
  mode: 'create' | 'edit';
  clientFirstName: string;
  value: string;
  onChangeText: (next: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
  saving: boolean;
  failed: boolean;
}

/**
 * Expands in place rather than pushing a route or opening a sheet: a note
 * is a paragraph, not a screen, and the tab's scroll position survives.
 *
 * **Not `Input`, and the reason is named.** That primitive is a 44px
 * control on `control.surface` with no way to ask for a taller box — the
 * one place the component inventory does not reach. This is §9's 88px
 * inset writing well, built from the same tokens `Input` is built from.
 *
 * **Nothing here is optimistic.** The failure copy is the contract: the
 * words stay in the box, the box stays open, and the coach retries or
 * discards. An optimistic insert with a rollback would take the sentence
 * off the screen and put a different screen back.
 */
function NoteComposer({
  mode,
  clientFirstName,
  value,
  onChangeText,
  onCancel,
  onSubmit,
  saving,
  failed,
}: NoteComposerProps) {
  const themed = useThemedStyles();
  const placeholderColor = usePlaceholderColor();

  return (
    <Card elevation="raised" density="coach" padded={false} testID="note-composer">
      <View style={styles.composer}>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          multiline
          autoFocus
          placeholder={`Anything you want to remember about ${clientFirstName}`}
          placeholderTextColor={placeholderColor}
          textAlignVertical="top"
          style={[styles.composerInput, themed.composerInput]}
          accessibilityLabel={`Note about ${clientFirstName}`}
          testID="note-composer-input"
        />

        {failed ? (
          <View style={styles.composerFailure} testID="note-composer-error">
            <Text size="label" className="font-sans-semibold">
              {"We couldn't save that note"}
            </Text>
            <Text size="body-sm" tone="muted" style={styles.composerFailureBody}>
              Your words are still here. Try again when you are back online.
            </Text>
          </View>
        ) : null}

        <View style={styles.composerActions}>
          <Button variant="secondary" size="md" density="coach" onPress={onCancel}>
            {failed && mode === 'create' ? 'Discard' : 'Cancel'}
          </Button>
          <Button
            variant="primary"
            size="md"
            density="coach"
            onPress={onSubmit}
            disabled={value.trim() === ''}
            loading={saving}
          >
            {failed ? 'Try again' : mode === 'create' ? 'Add note' : 'Save changes'}
          </Button>
        </View>
      </View>
    </Card>
  );
}

interface NotesEmptyProps {
  clientFirstName: string;
}

/**
 * **No button, and the deviation is declared.** `DESIGN.md` §9's empty-state
 * recipe asks for one action; `Add a note` is already pinned two inches
 * above in the fixed head, and a second copy in the same viewport is
 * duplication rather than guidance. That is also why this does not use
 * `EmptyState`, whose `primaryAction` is required by type for exactly the
 * opposite reason (`packages/ui`'s own contract).
 *
 * The body explains what a note is *for*, because a coach who has never
 * written one does not know.
 */
function NotesEmpty({ clientFirstName }: NotesEmptyProps) {
  const markColor = useMutedIconColor();

  return (
    <View style={styles.empty} testID="client-notes-empty">
      <FileText size={38} strokeWidth={2} color={markColor} />
      <Text size="title" style={styles.emptyTitle}>
        No notes yet
      </Text>
      <Text size="body" tone="muted" style={styles.emptyBody}>
        {`Anything you want to remember about ${clientFirstName} between sessions — an injury, a preference, something they said.`}
      </Text>
    </View>
  );
}

interface NotesFailureProps {
  error: unknown;
  onBack: () => void;
  onRetry: () => void;
}

/**
 * Two states, not one — the same split the other five tabs make.
 * `ERRORS.md` ER§2.1 makes another coach's client return NOT_FOUND rather
 * than FORBIDDEN, so this renders `NotFoundState` and never
 * `ForbiddenState`: a 403 on a table whose whole point is that it leaks
 * nothing would confirm the row exists.
 */
function NotesFailure({ error, onBack, onRetry }: NotesFailureProps) {
  const iconColor = useMutedIconColor();

  if (getErrorCode(error) === 'NOT_YOUR_CLIENT') {
    return (
      <NotFoundState
        title="We couldn't find that client"
        body="They may have been archived, or the link is out of date."
        onRecover={onBack}
        recoverLabel="Back to clients"
        density="coach"
        testID="client-notes-not-found"
      />
    );
  }

  return (
    <EmptyState
      icon={<TriangleAlert size={22} color={iconColor} />}
      title="We couldn't load your notes"
      // The second line exists because a coach whose notes will not load
      // wants to know whether they still have them.
      body="Check your connection and try again. Nothing you have written is lost."
      primaryAction={{ label: 'Try again', onPress: onRetry }}
      density="coach"
      testID="client-notes-error"
    />
  );
}

const GHOST_MIN_HEIGHT = 48;

const styles = StyleSheet.create({
  flex: { flex: 1 },
  fixed: {
    paddingTop: spacing(12),
    paddingHorizontal: GUTTER,
    paddingBottom: spacing(10),
    gap: spacing(9),
  },
  list: { paddingHorizontal: GUTTER, paddingBottom: spacing(40) },
  state: { flex: 1, paddingHorizontal: GUTTER },
  groupHead: { paddingHorizontal: spacing(3), paddingBottom: spacing(9) },
  groupHeadSpaced: { marginTop: spacing(20) },
  inlineComposer: { paddingBottom: spacing(9) },

  ghost: {
    minHeight: GHOST_MIN_HEIGHT,
    borderRadius: radius.full,
    borderWidth: 1,
    borderStyle: 'dashed',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing(8),
  },

  composer: { paddingVertical: spacing(13), paddingHorizontal: density.coach.cardPadding },
  composerInput: {
    minHeight: COMPOSER_INPUT_MIN_HEIGHT,
    borderRadius: radius.control,
    borderWidth: 1,
    paddingVertical: spacing(11),
    paddingHorizontal: spacing(12),
    fontFamily: fontFamily.sans,
    fontSize: fontSize.body[0],
    lineHeight: 22,
  },
  composerFailure: { marginTop: spacing(11) },
  composerFailureBody: { marginTop: spacing(4) },
  composerActions: {
    marginTop: spacing(11),
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: spacing(10),
  },

  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing(32),
    paddingBottom: spacing(40),
  },
  emptyTitle: { marginTop: spacing(12) },
  emptyBody: { marginTop: spacing(8), maxWidth: 280, textAlign: 'center' },
});

const useThemedStyles = createThemedStyles((t) => ({
  screen: { backgroundColor: t.colors.bg.DEFAULT },
  ghost: { borderColor: t.colors.border.strong },
  composerInput: {
    backgroundColor: t.colors.bg.inset,
    borderColor: t.colors.border.strong,
    color: t.colors.fg.DEFAULT,
  },
}));

const useMutedIconColor = createThemedValue((t) => t.colors.fg.muted);
const usePlaceholderColor = createThemedValue((t) => t.colors.fg.subtle);

/**
 * `brand` is scheme-invariant and unusable as ink on a light surface
 * (`tokens.ts`), so the ghost's warm ink comes off `DESIGN.md` §1.1's text
 * ramp — `fg.warm`, which resolves to the peach in dark and to #7A4530 in
 * light. The label carries the same tone by name.
 */
const useGhostInk = createThemedValue((t) => t.colors.fg.warm);
