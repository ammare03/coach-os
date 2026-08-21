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

module.exports = config;
