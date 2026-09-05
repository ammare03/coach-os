import { SearchX } from 'lucide-react-native';
import type { ReactNode } from 'react';

import { type Density } from '../theme/tokens.ts';
import { useTheme } from '../theme/useTheme.ts';

import { EmptyState } from './EmptyState.tsx';

export interface NotFoundStateProps {
  title?: string;
  body?: string;
  /** Overrides the default glyph. Hidden from the reading order either way — `EmptyState` does that. */
  icon?: ReactNode;
  /**
   * The way out, and not optional: `CLAUDE.md` §9.2 requires an id-route's
   * not-found state to be a recoverable screen rather than a dead end, and
   * a required handler is what makes that true at the type level instead of
   * by review.
   */
  onRecover: () => void;
  /** Defaults to "Go back". */
  recoverLabel?: string;
  density?: Density;
  testID?: string | undefined;
}

/**
 * Exported so a consumer can assert it is not the forbidden copy, and so
 * the two default strings live one import apart rather than being retyped
 * per route.
 *
 * `ERRORS.md` names this exact line for `EXPORT_NOT_FOUND` and
 * `NOT_YOUR_CLIENT` ("We couldn't find that"). The explanation is the next
 * step, not an apology, and it never blames the person who followed the
 * link (`COPY.md` §CO4.1, `product-copy` §5).
 */
export const NOT_FOUND_COPY = {
  title: "We couldn't find that",
  body: 'It may have been deleted, or the link may be out of date.',
  action: 'Go back',
} as const;

// `DESIGN.md` pins no size for a state glyph — §9 gives 20–21px for a dock
// icon and 15px for a chevron, and this sits above a 21px heading. 28px is
// the one number here neither the spec nor the prototypes supply.
const GLYPH_SIZE = 28;

/**
 * "This isn't here" — for an id-route whose resource does not exist, or no
 * longer does.
 *
 * **Never interchangeable with `ForbiddenState`.** `CLAUDE.md` §9.2
 * requires the two states distinct, and collapsing them is the shortcut a
 * rushed feature takes. The one sanctioned overlap runs the other way and
 * is decided at the API, not here: `ERRORS.md` ER§2.1 makes a resource
 * belonging to *another coach* return `NOT_FOUND`, so it renders **this**
 * component — returning forbidden there would confirm the resource exists
 * and turn id-walking into an enumeration oracle.
 *
 * `fg.subtle` on the glyph clears the 3:1 floor for a non-text graphic
 * (`accessibility` §1); it carries no meaning the heading does not already
 * carry, so it is hidden from the reading order.
 */
export function NotFoundState({
  title = NOT_FOUND_COPY.title,
  body = NOT_FOUND_COPY.body,
  icon,
  onRecover,
  recoverLabel = NOT_FOUND_COPY.action,
  density = 'client',
  testID,
}: NotFoundStateProps) {
  const { colors } = useTheme();
  return (
    <EmptyState
      icon={icon ?? <SearchX size={GLYPH_SIZE} color={colors.fg.subtle} />}
      title={title}
      body={body}
      primaryAction={{ label: recoverLabel, onPress: onRecover }}
      density={density}
      testID={testID}
    />
  );
}
