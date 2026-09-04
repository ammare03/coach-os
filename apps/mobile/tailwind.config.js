/** @type {import('tailwindcss').Config} */
// Minimal on purpose. `theme-tokens/02` replaces this with
// `presets: [require('@coachos/config/tailwind')]` and defines no value here —
// this task only proves the pipeline compiles.
module.exports = {
  content: [
    './app/**/*.{js,jsx,ts,tsx}',
    './src/**/*.{js,jsx,ts,tsx}',
    '../../packages/ui/src/**/*.{js,jsx,ts,tsx}',
  ],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {},
  },
  plugins: [],
};
