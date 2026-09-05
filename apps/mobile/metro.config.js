// Metro config for a pnpm + Turborepo monorepo.
//
// Metro's defaults assume a single-package repo. Without watchFolders,
// editing a file inside packages/ never triggers a reload. Without both
// nodeModulesPaths, importing a workspace package (e.g. @coachos/utils)
// fails with a module-not-found error that names the package but gives
// no hint the resolver never looked outside apps/mobile/node_modules.
// See CLAUDE.md §3.1 and
// .claude/plan/phase-00-repository-foundation/workspace-scaffold/02-relocate-expo-app.md.
const path = require('node:path');

const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const { isDevGalleryEnabled } = require('./dev-gallery.js');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
// .npmrc pins node-linker=hoisted so node_modules stays flat. Without
// this, Metro can still walk up and resolve a phantom hoisted copy of a
// package instead of the pinned version inside a workspace package.
config.resolver.disableHierarchicalLookup = true;

// The component gallery is dev tooling and must not reach a store build
// (`component-gallery/01`). Naming the directory `_dev` does NOT hide it:
// expo-router's `require.context` glob (`expo-router/_ctx.js`) matches every
// `.tsx` under the app root and only `+`-prefixed files are filtered, so
// `src/app/_dev/gallery.tsx` would otherwise be a perfectly ordinary route.
//
// `blockList` is applied by metro-file-map while it crawls, so a blocked file
// is absent from the file map the context module is generated from — the
// route does not exist, rather than existing and being unlinked.
if (!isDevGalleryEnabled()) {
  const galleryDirs = [
    path.join(projectRoot, 'src', 'app', '_dev'),
    path.join(projectRoot, 'src', 'dev'),
  ];
  const existing = config.resolver.blockList;
  config.resolver.blockList = [
    ...(Array.isArray(existing) ? existing : existing ? [existing] : []),
    ...galleryDirs.map((dir) => new RegExp(`^${escapeForRegExp(dir)}[\\\\/].*`)),
  ];
}

/** Absolute paths carry `\` on Windows and `.` everywhere — both are regex syntax. */
function escapeForRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// withNativeWind must wrap the config last — it compiles src/global.css and
// injects the CSS transform Metro needs to turn `className` into styles
// (theme-tokens/01).
module.exports = withNativeWind(config, { input: './src/global.css' });
