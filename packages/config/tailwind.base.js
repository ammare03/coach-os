// Shared Tailwind preset consumed by apps/mobile (NativeWind) and, later,
// apps/web — the shared token vocabulary CLAUDE.md §3.1 calls for. Theme
// extension points are declared and left empty so P04 `theme-tokens/02` has
// an obvious target to fill in. DESIGN-SYSTEM.md owns the actual values;
// this file never invents a colour, a radius, or a spacing step.
/** @type {import('tailwindcss').Config} */
module.exports = {
  theme: {
    extend: {
      colors: {},
      borderRadius: {},
      spacing: {},
      fontFamily: {},
      fontSize: {},
    },
  },
  plugins: [],
};
