// Consumed by apps/mobile and packages/ui. Layers Expo/React Native rules on
// top of the shared base. apps/api must never load this file — it pulls
// React Native rules that make no sense server-side and slows every lint run
// (CLAUDE.md §3.1).
const rawExpoConfig = require('eslint-config-expo/flat');

const base = require('./eslint.base');
const noRawColor = require('./eslint-rules/no-raw-color.js');
const adherenceColorsOnly = require('./eslint-rules/adherence-colors-only.js');
const noArbitraryTailwind = require('./eslint-rules/no-arbitrary-tailwind.js');

// eslint-config-expo bundles its own eslint-plugin-import registration in
// several entries. `base` already registers `import` workspace-wide with no
// `files` restriction, so a second, distinct plugin instance under the same
// key throws "Cannot redefine plugin" — strip expo's duplicate registration
// and let base's supply the plugin for expo's import/* rules too.
const expoConfig = rawExpoConfig.map((entry) => {
  if (!entry.plugins || !('import' in entry.plugins)) return entry;
  const { import: _unused, ...remainingPlugins } = entry.plugins;
  const deduped = { ...entry, plugins: remainingPlugins };
  if (Object.keys(remainingPlugins).length === 0) delete deduped.plugins;
  return deduped;
});

// theme-tokens/05 — the semantic-colour rule, made real. Named `theme`, not
// `local` — `eslint.base.js` already registers a plugin called `local`
// (`no-hand-written-row-type`), and flat config throws "Cannot redefine
// plugin" if two *different* object instances claim the same name across
// configs matching the same file. One object, reused by reference across
// all three rule entries below, so they can still each carry their own
// `ignores` (flat config's `ignores` is per config-object, not per-rule).
const THEME_PLUGIN = {
  theme: {
    rules: {
      'no-raw-color': noRawColor,
      'adherence-colors-only': adherenceColorsOnly,
      'no-arbitrary-tailwind': noArbitraryTailwind,
    },
  },
};

const noArbitraryTailwindRule = {
  files: ['**/*.{ts,tsx}'],
  plugins: THEME_PLUGIN,
  rules: { 'theme/no-arbitrary-tailwind': 'error' },
};

// `no-raw-color` and `adherence-colors-only` each carry their own explicit
// `ignores`/allowlist as rule options here, never as an inline
// `eslint-disable` comment (approach §4: a single array someone can read in
// one screen and challenge in review, the same discipline as CLAUDE.md
// §18.3's authz allowlist).
// `**/`-prefixed patterns throughout — this file is spread into both
// apps/mobile/eslint.config.js and packages/ui/eslint.config.js, and flat
// config resolves `files`/`ignores` relative to whichever one actually
// invoked ESLint (its cwd), not to this file's own location. A repo-root-
// relative path here silently never matches, exactly the trap
// apps/mobile/eslint.config.js's own comment documents for
// `noInlineInputSchemaRules` — verified by deliberately tripping it (§6
// below) before trusting it.
const noRawColorRule = {
  files: ['**/*.{ts,tsx}'],
  ignores: [
    // The theme package itself — this is where a colour is written down.
    '**/theme/tokens.ts',
    '**/theme/schemes.ts',
    // Native config/boot-time files — `app.config.ts`'s splash colour and
    // `_layout.tsx`'s root-background call both run before any
    // `<ThemeProvider>` exists to read a token from (theme-tokens/04).
    '**/app.config.ts',
    '**/app/_layout.tsx',
    // Pre-existing Phase 3 screens, built ahead of this phase
    // (theme-tokens/02's own header comment on packages/ui's original
    // stub components). Out of scope for a theme-tokens PR under
    // CLAUDE.md §0 rule 8 ("one PR, one concern") — migrate on next touch.
    '**/CompleteSocialSignUpForm.tsx',
    '**/GoogleSignInButton.tsx',
    '**/SignInForm.tsx',
    '**/SignUpForm.tsx',
    '**/PulseRingBackground.tsx',
    '**/UnitRow.tsx',
    '**/app/(auth)/sign-in.tsx',
    '**/app/(auth)/sign-up.tsx',
    '**/app/(auth)/complete-social-signup.tsx',
    // Asserts against the real token hex values by design.
    '**/theme/useTheme.test.tsx',
    // The contrast audit (`component-gallery/03`). `contrast.ts` is pure
    // colour arithmetic whose only "literal" is the error message naming
    // the formats it parses; its test has to feed the parser hexes and
    // rgba strings — including invalid ones — that no token can supply.
    // `contrast-audit.test.ts` composites `rgba()` values DESIGN.md states
    // but `tokens.ts` does not name (§8's record scrim), and its
    // exception reasons quote the measured hex so a reader can check the
    // number without leaving the file. Same exemption class as
    // `tokens.test.ts`: this IS the file that audits the colours.
    '**/theme/contrast.ts',
    '**/theme/contrast.test.ts',
    '**/theme/contrast-audit.test.ts',
    // `GlassSurface` composes a white-label tint into an `rgba()` string at
    // the contrast clamp — the alpha is computed, so no token can express
    // the result. Its test supplies a synthetic brand hex for the same
    // reason a brand-ramp test does.
    '**/surfaces/GlassSurface.tsx',
    '**/surfaces/GlassSurface.test.tsx',
  ],
  plugins: THEME_PLUGIN,
  rules: { 'theme/no-raw-color': 'error' },
};

const adherenceColorsOnlyRule = {
  files: ['**/*.{ts,tsx}'],
  ignores: [
    '**/theme/tokens.ts',
    '**/theme/schemes.ts',
    // The adherence family itself (ui-primitives-data/03) — the components
    // DESIGN.md §8's warmth ramp exists for, and the only ones in
    // `packages/ui` allowed to name `colors.state.*`. Each carries §8's
    // second, non-colour channel alongside the hue (filled / hollow /
    // dashed ring), so neither relies on colour alone; `AdherenceDotRow`
    // reaches the ramp only through `AdherenceDot`, but is listed so a
    // future strip-level treatment does not have to touch this file.
    '**/components/AdherenceDot.tsx',
    '**/components/AdherenceDotRow.tsx',
    // Their tests have to NAME the four ramp stops to prove each state maps
    // to the right one and that `not started` is never `off plan` — same
    // exemption class as `tokens.test.ts`.
    '**/components/AdherenceDot.test.tsx',
    '**/components/AdherenceDotRow.test.tsx',
    '**/adherence.ts',
    '**/adherence.test.ts',
    // Assert every token key exists, including the adherence ones — testing
    // the theme module, same exemption class as tokens.ts itself.
    '**/theme/tokens.test.ts',
    '**/theme/useTheme.test.tsx',
    // The contrast audit measures every token against every surface,
    // `state.*` and `urgent-text` included — it renders nothing, so §8's
    // "never hue alone" rule has no consumer here to bind. Leaving the
    // adherence ramp out of the audit would exempt the four colours whose
    // legibility a coach's dashboard depends on most.
    '**/theme/contrast-audit.test.ts',
    // `Button`'s `danger` variant. `DESIGN.md` §1.1 makes `urgent` the
    // destructive colour and §9 makes the variant outlined-and-lettered
    // rather than filled — a filled red rectangle reads as an adherence
    // signal in a scrolled list, an outlined one reads as a warning
    // attached to a specific control. That IS the sanctioned treatment, so
    // this entry is no longer a grandfathering: it is the one component
    // entitled to render a destructive affordance.
    '**/components/Button.tsx',
    '**/components/IconButton.tsx',
    // `Text`'s `tone="urgent"`. `DESIGN.md` §1.1 lists `urgent-text`
    // (#FF8A9B) as a real member of the text ramp — "accent text on dark,
    // for urgent labels" — so a form error, an overdue timestamp, and a
    // "Live" label need a sanctioned way to reach it. Routing them through
    // the one text primitive is strictly better than the alternative: deny
    // it here and the next author writes an inline hex, which
    // `no-raw-color` then catches one layer further from the decision.
    //
    // This widens the rule by exactly one named tone on one component, and
    // §8's real requirement — that state never rides on hue alone — is
    // unaffected: it binds the *consumer*, which must still carry a glyph,
    // an outline, or a shape alongside the colour. `component-gallery/03`
    // audits that by desaturating the gallery.
    '**/components/Text.tsx',
    // The two consumers that render §8's second channel alongside the hue:
    // an error glyph plus a `border-strong` outline, and a pulsing dot
    // beside a "Live" label. Neither uses colour alone.
    '**/components/FormField.tsx',
    '**/components/Badge.tsx',
    // Test files that assert the rule itself — `avatar-fallback.test.ts`
    // proves the fallback palette contains no adherence colour, and
    // `Text`/`Input`'s tests prove the urgent tone reaches its token. Each
    // has to NAME the colours to check they are absent or correctly wired,
    // which is the same exemption class as `tokens.test.ts` above.
    '**/components/avatar-fallback.test.ts',
    '**/components/Text.test.tsx',
    '**/components/Input.test.tsx',
    '**/components/FormField.test.tsx',
    '**/components/Badge.test.tsx',
    // `GlassSurface` names the adherence hues in order to REJECT them as a
    // white-label tint — DS§2.5's rule applied, not broken. The inverse of
    // what this rule guards against, and the only way to enforce it.
    '**/surfaces/GlassSurface.tsx',
    '**/surfaces/GlassSurface.test.tsx',
  ],
  plugins: THEME_PLUGIN,
  rules: { 'theme/adherence-colors-only': 'error' },
};

/** @type {import('eslint').Linter.Config[]} */
module.exports = [
  ...base,
  ...expoConfig,
  noArbitraryTailwindRule,
  noRawColorRule,
  adherenceColorsOnlyRule,
];
