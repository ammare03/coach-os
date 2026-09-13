import { Chip, createThemedValue } from '@coachos/ui';
import { formatLocalDate } from '@coachos/utils';
import { Archive, Pause } from 'lucide-react-native';

// The paused / archived mark, on the detail header and on a dashboard row.
//
// **Narrowed to the two statuses that render something.** `active` and
// `invited` have no chip — an active client is the unmarked case, and a
// marked one would put a badge on every row in the roster, which says
// nothing. Typing the prop as the two rather than as the whole
// `client_status` enum is what makes that unforgettable: neither of the
// other two can be passed, so no caller has to remember to guard.
//
// **A tag, not a control.** `Chip` with no `onPress` renders an
// `accessible` View; with one it renders a `Pressable` announcing as a
// button with a selection state. Paused is a fact about a person, not a
// choice a coach is being offered here — the choices are the rows in
// `ClientStatusActions`. For the same reason it is never `selected`: the
// selection pill means "you picked this".

export type MarkableClientStatus = 'paused' | 'archived';

export interface ClientStatusChipProps {
  status: MarkableClientStatus;
  /**
   * `paused_at` / `archived_at`. Only the SPOKEN label uses it — the
   * visible chip is one word at every text size, which is what keeps the
   * dashboard row's furniture from setting the row height.
   */
  since: Date | null;
  /** The coach's own zone. Injected only so a test has a fixed answer. */
  timeZone?: string;
  testID?: string;
}

const STATUS_LABEL: Record<MarkableClientStatus, string> = {
  paused: 'Paused',
  archived: 'Archived',
};

/**
 * The coach paused or archived this client on this device, so the device's
 * zone is their zone — unlike a client's training day, which is read from
 * the client's stored `users.timezone` because the reader is somewhere else
 * (`CLAUDE.md` §25.5, and `NoteRow`'s own note on the same distinction).
 */
function deviceTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/**
 * "Paused since 11 September" · "Archived on 4 September", and the bare
 * word when the timestamp is not known.
 *
 * Two prepositions, not one: a pause is a state that is still running and
 * a client is *since* a date; an archive is an act that finished and
 * happened *on* one. Built as whole sentences rather than a word plus a
 * date fragment, so a translation can reorder them (`product-copy` §6).
 */
export function describeClientStatus(
  status: MarkableClientStatus,
  since: Date | null,
  timeZone = deviceTimeZone(),
): string {
  if (since === null) return STATUS_LABEL[status];
  const on = formatLocalDate(since, timeZone, 'd MMMM');
  return status === 'paused' ? `Paused since ${on}` : `Archived on ${on}`;
}

export function ClientStatusChip({ status, since, timeZone, testID }: ClientStatusChipProps) {
  const iconColor = useIconColor();
  const Glyph = status === 'paused' ? Pause : Archive;

  return (
    <Chip
      label={STATUS_LABEL[status]}
      iconLeft={<Glyph size={CHIP_GLYPH} color={iconColor} />}
      accessibilityLabel={describeClientStatus(status, since, timeZone)}
      testID={testID ?? `client-status-chip-${status}`}
    />
  );
}

/** §9's chip glyph, one step under the label so it reads as furniture. */
const CHIP_GLYPH = 13;

const useIconColor = createThemedValue((t) => t.colors.fg.muted);
