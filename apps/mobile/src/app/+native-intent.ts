// Placeholder (`phase-05-app-shell/router-skeleton/01`). `deep-linking` owns
// the real rewriting — mapping `coachos://` and universal-link paths in
// CLAUDE.md §9.3's table onto route paths. Until then every system path is
// handed to the router unchanged, which is exactly what expo-router does
// when this file is absent; it exists now so the later task has a file to
// fill in rather than a decision to rediscover.
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  return path;
}
