import { Redirect } from 'expo-router';

// CLAUDE.md §9.1's tree has no root index, but expo-router needs one: with
// no `/` route the app opens on `+not-found`. So this file survives as the
// tree's entry point and nothing else — composition only, per §9.2.
//
// It replaces P04's temporary scaffold home screen (a ~900-line component
// specimen whose own header said "phase-05-app-shell/ replaces the route");
// the permanent gallery is `src/app/_dev/gallery.tsx`.
//
// The destination is a placeholder decision, not a product one.
// `providers-and-gates/03` replaces this redirect with the real gate:
// session present → the role's group, session absent → (auth).
export default function IndexScreen() {
  return <Redirect href="/(auth)/welcome" />;
}
