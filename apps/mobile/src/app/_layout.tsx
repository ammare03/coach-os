import { ThemeProvider } from '@coachos/ui';
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
import { QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { useCallback, useEffect, useState } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { queryClient } from '../lib/query/client.ts';
import { TRPCProvider } from '../lib/trpc-provider.tsx';
import '../global.css';

// DS§2.2 `bg.DEFAULT` — matches ThemeProvider's dark default and
// app.config.ts's splash colour (theme-tokens/04). Kept as a plain literal
// here (not a token import) because this call happens before any
// `<ThemeProvider>` mounts and is exempt from the no-raw-colour lint rule
// (theme-tokens/05) for the same reason app.config.ts's splash colour is.
const NATIVE_ROOT_BACKGROUND = '#161E2F';

// Module scope, not an effect: the OS dismisses the splash on its own as
// soon as the first frame is ready, which is before any effect runs. By
// then there is nothing left to hold.
SplashScreen.preventAutoHideAsync().catch(() => {
  // Rejects only when the splash is already gone, which is the state we
  // wanted anyway. Nothing to recover.
});

export default function RootLayout() {
  const [isNativeChromeReady, setIsNativeChromeReady] = useState(false);
  const [hasRootPainted, setHasRootPainted] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function prepareNativeChrome() {
      try {
        // Best-effort — `userInterfaceStyle: 'dark'` and the splash colour
        // (app.config.ts) already cover most of the flash; this narrows the
        // remaining gap between splash hide and first paint on Android, where
        // the window background can otherwise show through as white.
        await SystemUI.setBackgroundColorAsync(NATIVE_ROOT_BACKGROUND);
      } catch {
        // Cosmetic. A failure here must not leave the splash up forever.
      }
      if (!cancelled) {
        setIsNativeChromeReady(true);
      }
    }

    void prepareNativeChrome();
    return () => {
      cancelled = true;
    };
  }, []);

  // Fonts are not a condition: theme-tokens/03 embeds all six faces
  // natively through the `expo-font` config plugin, so they are present on
  // the first frame and there is nothing to await. A runtime `useFonts`
  // here would reintroduce the fallback-face flash that decision removed.
  //
  // `providers-and-gates/03` adds the auth-bootstrap condition to this
  // line — the splash must also outlast the SecureStore read and the one
  // refresh call, or the app shows a route group and then swaps it.
  const isReady = isNativeChromeReady;

  const handleRootPaint = useCallback(() => setHasRootPainted(true), []);

  useEffect(() => {
    if (!isReady || !hasRootPainted) {
      return;
    }
    // Both conditions, never one: hiding before the tree has laid out is
    // the flash of unstyled content this sequence exists to prevent.
    SplashScreen.hideAsync().catch(() => {
      // Already hidden. Not a failure.
    });
  }, [isReady, hasRootPainted]);

  return (
    // Provider order is load-bearing and `ui-primitives-core/04` owns the
    // outer half of it: `GestureHandlerRootView` outermost, WITH `flex: 1` —
    // omitting that one style produces a zero-height root and a blank app,
    // which looks like a crash and is a one-line layout bug. The
    // bottom-sheet provider sits inside it; without that nesting a sheet
    // renders but ignores the drag gesture, and on Android renders behind
    // the navigation bar.
    //
    // The inner half is `providers-and-gates/01`: Query wraps tRPC because
    // tRPC's React integration is a layer over TanStack Query, and Theme is
    // innermost because it is purely presentational and nothing else
    // depends on it.
    <GestureHandlerRootView style={{ flex: 1 }} onLayout={handleRootPaint}>
      {/* Slot — Sentry (`providers-and-gates/05`) and PostHog (`.../04`)
          wrap here, outside everything else, so a failure while any
          provider below initialises is still observed and reported. */}
      <QueryClientProvider client={queryClient}>
        <TRPCProvider>
          {/* Slot — the auth gate (`providers-and-gates/03`) mounts here:
              inside the API providers whose data it needs, outside the
              route tree it redirects. */}
          <ThemeProvider>
            <BottomSheetModalProvider>
              {/* `style="light"` — light content (icons/text) for CoachOS's
                  dark chrome, explicit rather than `"auto"` so it never
                  follows the device's own light/dark setting. */}
              <StatusBar style="light" />
              {/* No screen in this app uses the native header yet — every
                  route builds its own chrome (the (auth) group's glass nav
                  bar, this placeholder's plain body).
                  `phase-05-app-shell/router-skeleton/` revisits this once a
                  screen actually needs one. */}
              <Stack screenOptions={{ headerShown: false }} />
            </BottomSheetModalProvider>
          </ThemeProvider>
        </TRPCProvider>
      </QueryClientProvider>
    </GestureHandlerRootView>
  );
}
