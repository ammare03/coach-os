import { Text } from 'react-native';

// What every coach/client tab placeholder renders verbatim
// (`CoachTabPlaceholder`/`ClientTabPlaceholder`'s own doc comment: "the
// route's own path, rendered verbatim so navigation can be checked by eye
// and by `route-tree.test.tsx`"). A shell/navigation test — the dock, the
// stack, a focus mode's return tab — cares which route resolved, not what a
// *real* screen renders once one replaces the placeholder; and a real
// screen that reads through TanStack Query needs the tRPC provider these
// bare-`Stack` test trees deliberately don't mount.
//
// `route-tree.test.tsx` solves the identical problem with its own
// `SubstitutedScreen` + `SUBSTITUTED` set, scoped to that file because it
// builds its route map from the real directory listing. The tests that
// import specific route modules by name (`coach-tabs-route.test.tsx`,
// `focus-modes.test.tsx`) have no such listing to key off, so they use this
// shared stub instead — swap a tab's real import for
// `<RouteStub route="…" />` here rather than re-deriving the same handful
// of JSX in every file that hits this.
//
// Lives outside any `__tests__` directory on purpose: Jest's default
// `testMatch` treats every file under one as a test suite, and this one has
// no tests of its own.
export function RouteStub({ route }: { route: string }) {
  return <Text>{route}</Text>;
}
