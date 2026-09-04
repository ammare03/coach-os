import { ThemeProvider } from '@coachos/ui';
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { TRPCProvider } from '../lib/trpc-provider.tsx';
import '../global.css';

// DS§2.2 `bg.DEFAULT` — matches ThemeProvider's dark default and
// app.config.ts's splash colour (theme-tokens/04). Kept as a plain literal
// here (not a token import) because this call happens before any
// `<ThemeProvider>` mounts and is exempt from the no-raw-colour lint rule
// (theme-tokens/05) for the same reason app.config.ts's splash colour is.
const NATIVE_ROOT_BACKGROUND = '#161E2F';

export default function RootLayout() {
  useEffect(() => {
    // Best-effort — `userInterfaceStyle: 'dark'` and the splash colour
    // (app.config.ts) already cover most of the flash; this narrows the
    // remaining gap between splash hide and first paint on Android, where
    // the window background can otherwise show through as white.
    void SystemUI.setBackgroundColorAsync(NATIVE_ROOT_BACKGROUND);
  }, []);

  return (
    // Provider order is load-bearing and `ui-primitives-core/04` owns it:
    // `GestureHandlerRootView` outermost, WITH `flex: 1` — omitting that
    // one style produces a zero-height root and a blank app, which looks
    // like a crash and is a one-line layout bug. The bottom-sheet provider
    // sits inside it; without that nesting a sheet renders but ignores the
    // drag gesture, and on Android renders behind the navigation bar.
    //
    // `phase-05-app-shell/providers-and-gates/01` rewrites this file
    // wholesale. It must preserve this ordering.
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider>
        <TRPCProvider>
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
        </TRPCProvider>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
