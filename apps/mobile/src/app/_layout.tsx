import { ThemeProvider } from '@coachos/ui';
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
import { QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { useCallback, useEffect, useState } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { bootstrap } from '../features/auth/bootstrap.ts';
import { useAuthStore } from '../features/auth/store.ts';
import { AnalyticsProvider } from '../lib/analytics/index.ts';
import { queryClient, queryPersistence } from '../lib/query/client.ts';
import { initSentry } from '../lib/sentry.ts';
import { TRPCProvider } from '../lib/trpc-provider.tsx';
import '../global.css';

// DS§2.2 `bg.DEFAULT` — matches ThemeProvider's dark default and
// app.config.ts's splash colour (theme-tokens/04). Kept as a plain literal
// here (not a token import) because this call happens before any
// `<ThemeProvider>` mounts and is exempt from the no-raw-colour lint rule
// (theme-tokens/05) for the same reason app.config.ts's splash colour is.
const NATIVE_ROOT_BACKGROUND = '#161E2F';

// Sentry (`providers-and-gates/05`) — the outermost thing in the app, and
// therefore not a provider at all. `initSentry()` installs the global error
// and unhandled-rejection handlers synchronously, at module scope, so a crash
// while any provider below is still initialising is caught. A component would
// have to render first, which is exactly the window this needs to cover.
initSentry();

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
  const [isCacheRestored, setIsCacheRestored] = useState(false);
  const authStatus = useAuthStore((state) => state.status);

  // `auth-client/04`'s cold-start sequence, kicked off from the one place
  // that knows the app has mounted. It is not re-implemented here — this is
  // its only caller, and without it `status` never leaves `'loading'` and
  // the splash below never lifts.
  useEffect(() => {
    void bootstrap();
  }, []);

  // `providers-and-gates/02` starts the persisted-cache restore at module
  // scope and exports the promise for exactly this. Waiting on it is the
  // same decision as waiting on the auth bootstrap: the first authenticated
  // screen would otherwise mount before its cache exists, paint empty, and
  // swap — the flash this file's whole sequence is here to prevent, and the
  // reason a cached dashboard is allowed a 200ms budget (CLAUDE.md §19).
  // The promise never rejects; an unavailable cache resolves as such.
  useEffect(() => {
    let cancelled = false;
    void queryPersistence.finally(() => {
      if (!cancelled) {
        setIsCacheRestored(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

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
  // `providers-and-gates/03` added the last two conditions. The splash has
  // to outlast the SecureStore read and the one refresh call, or the app
  // shows a route group and then swaps it; and it has to outlast the cache
  // restore for the same reason one level down.
  const isReady = isNativeChromeReady && isCacheRestored && authStatus !== 'loading';

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
      {/* No Sentry wrapper here — it is initialised at module scope above,
          which is strictly earlier than any component this slot could have
          held. `Sentry.wrap()` was the alternative and was rejected: the only
          things it adds are the touch-event boundary, which breadcrumbs
          whatever text is under the user's thumb, and the render profiler,
          which needs the tracing this app leaves off (see `lib/sentry.ts`).

          PostHog (`providers-and-gates/04`) is therefore the outermost
          provider, and sits outside the API providers: it depends on none of
          them, and an event fired during the auth bootstrap should still be
          captured. It is our own provider, never PostHog's — see the file's
          own comment for why that matters. */}
      <AnalyticsProvider>
        <QueryClientProvider client={queryClient}>
          <TRPCProvider>
            {/* The auth gate (`providers-and-gates/03`) was slotted here and
                is NOT here. It renders a `<Redirect>` instead of its children
                — that substitution is what makes it flash-free — so wrapping
                `<Stack>` with it unmounts the only navigator in expo-router's
                internal slot while the redirect is in flight. That changes the
                slot's route key and remounts this layout and every provider
                under it: a second `bootstrap()` and its refresh round trip, a
                second analytics init, a restarted splash sequence. Measured,
                not assumed (`features/auth/AuthGate.tsx`).

                So the gate guards each group from inside instead —
                `(auth)`, `(coach)`, and `(client)`'s own layouts — and this
                layout keeps the two halves of the handoff that do belong at
                the root: it starts the bootstrap, and it holds the splash
                until the bootstrap has answered. */}
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
      </AnalyticsProvider>
    </GestureHandlerRootView>
  );
}
