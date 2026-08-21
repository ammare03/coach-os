// Conventional Commits (git-workflow skill §3). The scope list below is the
// union of every top-level app/package folder that exists today, plus the
// feature-slice and cross-cutting scopes named in the git-workflow skill's
// own examples — most of those folders don't exist yet (apps/mobile's
// src/features/workouts/ arrives in phase-09, for instance) but the scope
// word is already the agreed name for that slice, so it's listed here ahead
// of the folder. Extend this list in the same PR that adds a new top-level
// package/app.
/** @type {import('@commitlint/types').UserConfig} */
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'scope-enum': [
      2,
      'always',
      [
        // apps/
        'api',
        'mobile',
        'web',
        // packages/
        'config',
        'db',
        'schemas',
        'ui',
        'utils',
        // feature slices — apps/mobile/src/features/* (code-conventions skill §1)
        'auth',
        'billing',
        'checkins',
        'clients',
        'formcheck',
        'live',
        'messaging',
        'nutrition',
        'offline',
        'workouts',
        // cross-cutting
        'claude',
        'deps',
        'docs',
        'infra',
      ],
    ],
  },
};
