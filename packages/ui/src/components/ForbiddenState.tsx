import { Lock } from 'lucide-react-native';
import type { ReactNode } from 'react';

import { type Density } from '../theme/tokens.ts';
import { useTheme } from '../theme/useTheme.ts';

import { EmptyState } from './EmptyState.tsx';

export interface ForbiddenStateProps {
  title?: string;
  body?: string;
  /** Overrides the default glyph. Hidden from the reading order either way — `EmptyState` does that. */
  icon?: ReactNode;
  /**
   * The way out, and not optional — same reason as `NotFoundState`. When
   * the block is a tier block, this is the upgrade path and
   * `recoverLabel` names it ("See plans"), which is what `UI-UX.md` §UX4.2
   * means by "explain, offer the path. Never a bare 403".
   */
  onRecover: () => void;
  /** Defaults to "Go back". */
  recoverLabel?: string;
  density?: Density;
  testID?: string | undefined;
}

/**
 * Exported so a consumer can assert it is not the not-found copy.
 *
 * Follows `ERRORS.md`'s `WRONG_ROLE` line. It states the account fact and
 * the next step, and it never suggests the person tried to reach something
 * they should not have — `COPY.md` §CO2's no-shame rule applies to a
 * forbidden screen more than to any other, because this is the one a user
 * is most likely to read as an accusation.
 */
export const FORBIDDEN_COPY = {
  title: 'Not available on this account',
  body: "Your account doesn't have access to this. Whoever manages the account can change that.",
  action: 'Go back',
} as const;

// Same size, and the same gap in the spec, as `NotFoundState`'s glyph.
const GLYPH_SIZE = 28;

/**
 * "This isn't yours to open" — for a block the user's **own account**
 * explains: the wrong role, a tier that does not include the feature, an
 * assistant reaching a root-only surface, a suspended or pending-deletion
 * account.
 *
 * **Never used for another coach's resource.** That case is `NOT_FOUND` by
 * deliberate design (`ERRORS.md` ER§2.1) and renders `NotFoundState`:
 * saying "forbidden" there confirms the resource exists, which is an
 * enumeration oracle. So the two components are distinct in copy, in glyph,
 * and in which failure each answers — and neither is a generic "error"
 * state (`CLAUDE.md` §9.2).
 *
 * The lock is decorative and hidden from the reading order; `fg.subtle`
 * clears the 3:1 floor for a non-text graphic (`accessibility` §1).
 */
export function ForbiddenState({
  title = FORBIDDEN_COPY.title,
  body = FORBIDDEN_COPY.body,
  icon,
  onRecover,
  recoverLabel = FORBIDDEN_COPY.action,
  density = 'client',
  testID,
}: ForbiddenStateProps) {
  const { colors } = useTheme();
  return (
    <EmptyState
      icon={icon ?? <Lock size={GLYPH_SIZE} color={colors.fg.subtle} />}
      title={title}
      body={body}
      primaryAction={{ label: recoverLabel, onPress: onRecover }}
      density={density}
      testID={testID}
    />
  );
}
