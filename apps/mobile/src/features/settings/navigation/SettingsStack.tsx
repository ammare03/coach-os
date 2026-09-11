import { useTheme } from '@coachos/ui';
import { Stack } from 'expo-router';

/**
 * The chrome every `settings/*` route gets for free.
 *
 * `UI-UX.md` §UX1.3 — a settings sub-screen is a Stack screen with a title
 * and a working back, and both route groups' `_layout.tsx` render this so
 * the two cannot drift. Later phases add `notifications`, `privacy`,
 * `billing`, `branding`, and `gym/` under one or both groups and inherit
 * this without writing any of it; P25 `team-seats-and-roles/05` branches
 * its billing entry on which group it is in, which is exactly why there are
 * two route groups and one component.
 *
 * `headerShown` is declared here and not inherited: a nested navigator
 * resolves its own `screenOptions`, and both parent groups set
 * `headerShown: false` because every route in them draws its own chrome.
 * Settings is the exception — it is a stack of ordinary pushes, and a
 * native header is what gives them a back gesture, a back label, and the
 * title announcement a hand-drawn bar would have to reimplement.
 *
 * **Opaque, not glass, and that is a decision rather than an omission.**
 * `DESIGN.md` §4 puts a screen header on Tier-2 glass, and `YourDataScreen`
 * draws one by hand. Reaching it here needs `headerTransparent`, a
 * `GlassSurface` `headerBackground`, a content-inset choice, and the
 * runtime Reduce-Transparency collapse `accessibility` §5 requires — none
 * of which is verifiable without hardware. Shipping the opaque header keeps
 * every sub-screen's back action correct today; whoever adds the glass
 * should do it here, once, and check it on a device.
 */
export function SettingsStack() {
  const theme = useTheme();

  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerStyle: { backgroundColor: theme.colors.bg.DEFAULT },
        headerTintColor: theme.colors.brand.DEFAULT,
        headerTitleStyle: { color: theme.colors.fg.DEFAULT },
        // The hairline under a native header is a platform grey. `DESIGN.md`
        // §2's canvas has its own border token, and the two do not match.
        headerShadowVisible: false,
        contentStyle: { backgroundColor: theme.colors.bg.DEFAULT },
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Settings' }} />
    </Stack>
  );
}
