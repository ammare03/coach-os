import { GlassSurface, createThemedStyles, useTheme } from '@coachos/ui';
import type { ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

import { PulseRingBackground } from './PulseRingBackground.tsx';

// The `(auth)` group's shared chrome, lifted out of `sign-in.tsx` and
// `sign-up.tsx` (`code-conventions` §1 — promote on the second consumer;
// this has five). The structure is the "2 — Conservative" layout Ammar
// approved in `/design` round 2 and is unchanged: nav-bar-only Liquid
// Glass (DS§12.1), the pulse-ring background behind it, 64px bar, 84px
// content offset, `KeyboardAvoidingView` on iOS only.
//
// ⚠️ ONE thing did change in the move, and it is deliberate. Those two
// route files hardcoded the retired `DESIGN-SYSTEM.md` indigo ramp
// (#0A0D12 canvas, #6366F1 mark, #868CF8 links) and were on
// `eslint.react-native.js`'s `no-raw-color` grandfathering list, whose own
// comment reads "migrate on next touch". This is that touch, so the chrome
// now reads `DESIGN.md` §1.1's warm ramp through `useTheme()`. It is not a
// new design decision: `DESIGN.md` supersedes `DESIGN-SYSTEM.md` on
// palette, `packages/ui` already implements it, and the forms inside these
// screens were already drawing warm — `Button`, `Input` and `FormField`
// all come from `packages/ui`. The screens were half-migrated; this
// finishes the half that is in this task's file scope.
//
// Still indigo, and NOT in this task's scope to change:
// `PulseRingBackground`'s stroke and `(auth)/complete-social-signup.tsx`'s
// own inline copy of this chrome. Both are one-line follow-ups.

const NAV_BAR_HEIGHT = 64;
const CONTENT_TOP_OFFSET = 84;

// Same 22px stroked chevron `YourDataScreen` draws for its own glass nav
// bar — hand-drawn rather than an icon package because that is the
// precedent already in the app.
function BackChevron({ color }: { color: string }) {
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
      <Path
        d="M15 5l-7 7 7 7"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export interface AuthScreenShellProps {
  children: ReactNode;
  /** Omit on a group entry point (welcome); supply it wherever the screen was pushed (`UI-UX.md` §UX1.3, "Back, always"). */
  onBack?: (() => void) | undefined;
}

export function AuthScreenShell({ children, onBack }: AuthScreenShellProps) {
  const insets = useSafeAreaInsets();
  const theme = useTheme();
  const themed = useThemedStyles();

  return (
    <View style={[layout.screen, themed.screen]}>
      <PulseRingBackground />

      <GlassSurface
        tier="tier1"
        style={[layout.navBar, { paddingTop: insets.top, height: NAV_BAR_HEIGHT + insets.top }]}
      >
        <View style={layout.navBarContent}>
          {onBack ? (
            <Pressable
              onPress={onBack}
              accessibilityRole="button"
              accessibilityLabel="Back"
              hitSlop={13}
              style={layout.back}
            >
              <BackChevron color={theme.colors.fg.DEFAULT} />
            </Pressable>
          ) : null}
          <View style={[layout.logoMark, themed.logoMark]}>
            <Text style={[layout.logoMarkText, themed.logoMarkText]}>C</Text>
          </View>
          <Text style={[layout.logoText, themed.logoText]}>CoachOS</Text>
        </View>
      </GlassSurface>

      <KeyboardAvoidingView
        style={layout.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={NAV_BAR_HEIGHT + insets.top}
      >
        <ScrollView
          contentContainerStyle={[
            layout.content,
            {
              paddingTop: CONTENT_TOP_OFFSET + insets.top,
              paddingBottom: 28 + insets.bottom,
            },
          ]}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

// Scheme-invariant geometry stays at module scope where it costs nothing
// (`createThemedStyles`' own contract).
const layout = StyleSheet.create({
  flex: { flex: 1 },
  screen: {
    flex: 1,
  },
  navBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 1,
    justifyContent: 'flex-end',
  },
  navBarContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  // 22px glyph + 13px hitSlop on every side = 48, `ui-conventions` §5's
  // floor, without growing the 64px bar.
  back: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 22,
    height: 22,
  },
  logoMark: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoMarkText: {
    fontWeight: '700',
    fontSize: 14,
  },
  logoText: {
    fontWeight: '700',
    fontSize: 14,
  },
  content: {
    paddingHorizontal: 20,
    flexGrow: 1,
  },
});

const useThemedStyles = createThemedStyles((theme) => ({
  screen: { backgroundColor: theme.colors.bg.DEFAULT },
  logoMark: { backgroundColor: theme.colors.brand.DEFAULT },
  // `fg.onBrand` is the dark ink §1.1 pairs with a brand fill; white on
  // peach reads 2.6:1 and is forbidden.
  logoMarkText: { color: theme.colors.fg.onBrand },
  logoText: { color: theme.colors.fg.DEFAULT },
}));
