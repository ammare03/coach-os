// Whether the component gallery (`component-gallery/01`) ships in the bundle
// Metro is about to build. Read by BOTH `metro.config.js` (which blocks the
// gallery's files outright) and `app.config.ts` (which records the same answer
// in `extra` so the route can refuse to render if it ever survives the block).
//
// Both of those run in Node at build time, which is why this is a plain
// CommonJS file and why it may read `process.env` dynamically: inside the
// bundle it could not — Metro inlines `process.env.EXPO_PUBLIC_*` only at
// literal member accesses, so `env[name]` would be `undefined` on device.
//
// `configuration` skill §4: `expo start` and a development build bundle with
// NODE_ENV=development, every release bundle (`expo export`, an EAS preview or
// production build) with NODE_ENV=production. The default is therefore "dev
// only", and a preview build that wants the gallery opts in explicitly. The
// production profile must never set that variable.
'use strict';

const OPT_IN = 'EXPO_PUBLIC_DEV_GALLERY';

/**
 * @param {Record<string, string | undefined>} [env]
 * @returns {boolean}
 */
function isDevGalleryEnabled(env = process.env) {
  if (env[OPT_IN] === '1') return true;
  return env.NODE_ENV !== 'production';
}

module.exports = { isDevGalleryEnabled, DEV_GALLERY_OPT_IN: OPT_IN };
