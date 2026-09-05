import { View } from 'react-native';

import { createThemedStyles } from '../theme/createThemedStyles.ts';
import { density as densityTokens, type Density } from '../theme/tokens.ts';

export interface DividerProps {
  /** Insets to match the card's density padding so the line doesn't run under a card's rounded corners. */
  density?: Density;
  testID?: string;
}

/**
 * A 1px `border.soft` rule (DESIGN.md §9's list-row divider), inset
 * horizontally by the density's card padding — the answer to "these rows
 * need separating" without nesting a second card.
 */
export function Divider({ density: densityProp = 'client', testID }: DividerProps) {
  const styles = useThemedStyles();
  const inset = densityTokens[densityProp].cardPadding;

  return (
    <View
      testID={testID}
      accessible={false}
      importantForAccessibility="no"
      style={[styles.line, { marginHorizontal: inset }]}
    />
  );
}

const useThemedStyles = createThemedStyles((theme) => ({
  line: {
    height: 1,
    backgroundColor: theme.colors.border.soft,
  },
}));
