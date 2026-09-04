// No value of its own — presets and content globs only (theme-tokens/02
// approach §5). A colour, radius, or spacing step belongs in
// `packages/ui/src/theme/tokens.ts`, never in an `extend` block here.
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,jsx,ts,tsx}',
    './src/**/*.{js,jsx,ts,tsx}',
    '../../packages/ui/src/**/*.{js,jsx,ts,tsx}',
  ],
  presets: [require('nativewind/preset'), require('@coachos/config/tailwind')],
  theme: {
    extend: {},
  },
  plugins: [],
};
