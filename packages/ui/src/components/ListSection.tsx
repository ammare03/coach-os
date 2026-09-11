import { Children, Fragment, isValidElement, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { density as densityTokens, spacing, type Density } from '../theme/tokens.ts';

import { Card } from './Card.tsx';
import { Divider } from './Divider.tsx';
import { Text } from './Text.tsx';

export interface ListSectionProps {
  /**
   * The section eyebrow. Written in sentence case and rendered uppercase —
   * the casing is a style, so a screen reader still says "Your data".
   * Omit it for a section whose single child carries its own label.
   */
  title?: string | undefined;
  /**
   * Off for a section whose children are not `ListRow`s and bring their own
   * surface — the weight-unit control is its own card, and `DESIGN.md` §2
   * forbids a card inside a card at the same level.
   */
  grouped?: boolean;
  density?: Density;
  children?: ReactNode;
  testID?: string | undefined;
}

/**
 * The eyebrow-plus-grouped-rows unit the settings section map is written
 * in. Two behaviours carry the weight:
 *
 * 1. **A section with no rows renders nothing at all.** Every name in the
 *    feature README's map is reserved in code from day one, and the ones a
 *    later phase owns cost no pixels and set no expectation until that
 *    phase arrives. A placeholder row that opens nothing is worse than an
 *    absent section (`settings-shell/01`, Risks).
 * 2. **The eyebrow is a heading.** `accessibilityRole="header"` is what
 *    lets VoiceOver and TalkBack jump section to section instead of walking
 *    every row (`accessibility` §2).
 */
export function ListSection({
  title,
  grouped = true,
  density: densityProp = 'client',
  children,
  testID,
}: ListSectionProps) {
  // `Children.toArray` already drops `null`, `undefined`, and booleans, so
  // `{role === 'client' && <ListRow />}` on a coach contributes nothing and
  // the whole section disappears — which is the point.
  const rows = Children.toArray(children).filter(isValidElement);
  if (rows.length === 0) {
    return null;
  }

  return (
    <View testID={testID} style={styles.section}>
      {title ? (
        <Text
          size="eyebrow"
          tone="muted"
          accessibilityRole="header"
          style={[styles.eyebrow, { paddingHorizontal: spacing(4) }]}
        >
          {title}
        </Text>
      ) : null}
      {grouped ? (
        <Card elevation="raised" density={densityProp} padded={false}>
          {rows.map((row, index) => (
            // Index keys: the caller's own children already carry stable
            // identity, and this fragment exists only to pair each row with
            // the rule above it.
            <Fragment key={index}>
              {index > 0 ? <Divider density={densityProp} /> : null}
              {row}
            </Fragment>
          ))}
        </Card>
      ) : (
        <View style={{ gap: densityTokens[densityProp].sectionGap }}>{rows}</View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: spacing(8),
  },
  eyebrow: {
    textTransform: 'uppercase',
  },
});
