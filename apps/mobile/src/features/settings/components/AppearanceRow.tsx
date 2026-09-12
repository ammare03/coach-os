import {
  Card,
  LIGHT_SCHEME_AVAILABLE,
  ListRow,
  SegmentedControl,
  Text,
  spacing,
  type Density,
  type Scheme,
  type SegmentedOptions,
} from '@coachos/ui';
import { StyleSheet, View } from 'react-native';

import { useAppearance } from '../hooks/useAppearance.ts';

// `settings-shell/03`. Design: `AppearanceRow.dc.html` (6b/6c in context,
// 6d for every state) in the same Claude Design project as
// `SettingsShell.dc.html`. Replaces the static row of this name that has
// sat on `main` since a `/design` round asked for a second Preferences row
// as visual context — that one rendered "System" and did nothing on press,
// which is the one thing a settings row may never do.
//
// Three decisions this file holds:
//
// 1. **The row does not navigate, so it draws no chevron.** `ListRow`'s
//    `value` shape always pairs the value with one, and a chevron promises
//    a detail screen that does not exist. The value rides in a `custom`
//    trailing instead; the control below announces the same answer to a
//    screen reader, so nothing is lost by the trailing text being
//    decorative.
//
// 2. **Light is drawn, dimmed, and explained.** Hiding it answers nobody's
//    question about whether the app has a light mode; enabling it ships
//    `schemes.ts`'s undesigned role-inverted fallback to a real user. The
//    disabled segment is the honest third option, and the line beneath it
//    is what actually carries the reason — `fg.faint` is `DESIGN.md` §1.1's
//    "never carries meaning" tone, so the copy has to (`accessibility` §4).
//
// 3. **The refusal is not here.** `useAppearance`'s setter checks
//    `LIGHT_SCHEME_AVAILABLE` itself. This component only has to stop
//    fingers; the store stops everything else.
//
// `light-scheme/02` changes exactly two things in this file: the flag it
// reads goes `true`, which enables the segment and drops the note. No
// restructuring.

const SCHEME_LABEL: Record<Scheme, string> = {
  dark: 'Dark',
  light: 'Light',
};

/**
 * `product-copy` §2/§6 — states the fact, promises nothing, no exclamation
 * mark, sentence case. "Coming soon" was the obvious phrasing and is a
 * commitment to a date nobody has made.
 */
const LIGHT_UNAVAILABLE_NOTE = "Light mode isn't ready yet — CoachOS is dark everywhere for now.";

export interface AppearanceRowProps {
  density?: Density;
}

export function AppearanceRow({ density }: AppearanceRowProps) {
  const { scheme, setScheme } = useAppearance();

  const options: SegmentedOptions<Scheme> = [
    { value: 'dark', label: SCHEME_LABEL.dark },
    { value: 'light', label: SCHEME_LABEL.light, disabled: !LIGHT_SCHEME_AVAILABLE },
  ];

  return (
    // Its own card because the Preferences section is `grouped={false}` —
    // the weight-unit control above is a card in its own right, and
    // `DESIGN.md` §2 forbids a card inside a card at the same level.
    <Card elevation="raised" padded={false} {...(density ? { density } : {})}>
      <ListRow
        label="Appearance"
        trailing={{
          kind: 'custom',
          render: () => (
            <Text size="body-sm" tone="muted">
              {SCHEME_LABEL[scheme]}
            </Text>
          ),
        }}
        {...(density ? { density } : {})}
      />
      <View style={styles.control}>
        <SegmentedControl
          options={options}
          value={scheme}
          onChange={setScheme}
          testID="appearance-scheme"
        />
        {LIGHT_SCHEME_AVAILABLE ? null : (
          <Text size="caption" tone="muted">
            {LIGHT_UNAVAILABLE_NOTE}
          </Text>
        )}
      </View>
    </Card>
  );
}

// Scheme-invariant geometry only — every colour comes through `Card`,
// `Text`'s tone, and `SegmentedControl` (`createThemedStyles`' contract: a
// sheet with no colour in it does not need the hook).
const styles = StyleSheet.create({
  control: {
    // No top padding: `ListRow`'s own vertical padding already separates it.
    paddingHorizontal: spacing(16),
    paddingBottom: spacing(16),
    gap: spacing(10),
  },
});
