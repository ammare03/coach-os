// `apps/web`'s first tests (`guardian-consent/05`). The shared
// @coachos/config/jest.node preset already transpiles `.tsx` with
// `jsx: 'react-jsx'` for apps/api's React Email templates — the same
// arrangement applies here: these components are rendered to a string with
// `react-dom/server`, so there is no DOM and no jsdom, just a Node
// environment (`testing` skill).
//
// `.mjs`, not `.js`: apps/web is a CommonJS package (no `"type": "module"`)
// but the preset is imported as an ES module, matching apps/api's config.
import nodePreset from '@coachos/config/jest.node';

const TS_FILES = '^.+\\.tsx?$';
const [, tsJestOptions] = nodePreset.transform[TS_FILES];

/** @type {import('jest').Config} */
export default {
  ...nodePreset,
  transform: {
    [TS_FILES]: [
      'ts-jest',
      {
        ...tsJestOptions,
        tsconfig: {
          ...tsJestOptions.tsconfig,
          // Next's tsconfig sets `incremental`, which under TS 6 makes the
          // build-info path ambiguous unless the root is pinned — ts-jest
          // otherwise infers it from whichever files a given run touches
          // and fails with TS5011. Test-transpile only; the real build
          // still uses tsconfig.json untouched.
          rootDir: '.',
          incremental: false,
        },
      },
    ],
  },
  testPathIgnorePatterns: [...nodePreset.testPathIgnorePatterns, '/\\.next/'],
};
