// Pure derivation, no React — the fallback an `Avatar` shows before (or
// instead of) a photo. Kept out of `Avatar.tsx` so it can be unit-tested
// exhaustively on its own (`ui-primitives-core/06`'s "Why this exists":
// most clients have no photo, so this is the state a hundred-row coach
// dashboard actually renders most of the time).
import { colors } from '../theme/tokens.ts';

export interface AvatarFallback {
  /** First grapheme of the first word + first grapheme of the last word, uppercased, capped at two. Never blank. */
  initials: string;
  /** A two-stop gradient, stable for a given `userId`. */
  gradient: readonly [string, string];
}

/** Renders when a name is empty or whitespace-only — never a blank circle. */
const NEUTRAL_GLYPH = '•';

// The three warm anchors named in `ui-primitives-core/06`: `deep` ->
// `brand.deep` -> `brand.shade`. Only these three tokens are ever
// combined — no new hex here, per CONTRACT.md's "only tokens.ts holds a
// colour" rule — and none of the three is anywhere near the `state.*` /
// `urgent` adherence hues, so a fallback colour can never be mistaken for
// an adherence signal (DESIGN.md §8).
export type AvatarPalette = readonly (readonly [string, string])[];

/** `deep` is scheme-dependent; the two brand stops are not (DESIGN.md §1.1 gives one ramp). */
export function buildAvatarPalette(
  deep: string,
  brand: { deep: string; shade: string },
): AvatarPalette {
  return [
    [deep, brand.deep],
    [brand.deep, brand.shade],
    [brand.shade, deep],
  ];
}

/** The dark palette, and the default when no scheme is supplied. */
const FALLBACK_PALETTE: AvatarPalette = buildAvatarPalette(colors.deep, colors.brand);

/**
 * First grapheme of `word`, uppercased by the caller. Prefers
 * `Intl.Segmenter` (available in Node — and so in this file's own
 * tests — and in increasingly many JS engines); Hermes on-device does not
 * ship it as of this Expo SDK, so this falls back to `Array.from`, which
 * is *codepoint*-aware (correct for a surrogate-pair emoji or an astral
 * character) but not full grapheme-cluster aware — a base letter plus a
 * separate combining mark can still split on that path. Plain `charAt(0)`
 * would additionally break on any surrogate pair, which is why neither is
 * used alone.
 */
function firstGrapheme(word: string): string {
  if (word.length === 0) return '';
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    const first = segmenter.segment(word)[Symbol.iterator]().next();
    return first.done ? '' : first.value.segment;
  }
  return Array.from(word)[0] ?? '';
}

/**
 * Initials for an avatar fallback: first grapheme of the first word plus
 * first grapheme of the last word, uppercased, capped at two. One word
 * gives one letter. An empty or whitespace-only name gives a neutral
 * glyph, never a blank circle (`ui-primitives-core/06`).
 */
export function getAvatarInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);

  if (words.length === 0) return NEUTRAL_GLYPH;

  if (words.length === 1) {
    const only = words[0];
    return only ? firstGrapheme(only).toUpperCase() : NEUTRAL_GLYPH;
  }

  const first = words[0];
  const last = words[words.length - 1];
  const initials = `${first ? firstGrapheme(first) : ''}${last ? firstGrapheme(last) : ''}`;
  return initials ? initials.toUpperCase() : NEUTRAL_GLYPH;
}

/**
 * A small, non-cryptographic hash (djb2) — it only needs to distribute
 * `userId` strings evenly across `FALLBACK_PALETTE`'s slots.
 */
function hashUserId(userId: string): number {
  let hash = 5381;
  for (let index = 0; index < userId.length; index += 1) {
    hash = (hash * 33) ^ userId.charCodeAt(index);
  }
  return hash >>> 0;
}

/**
 * The avatar fallback for a person: deterministic initials from `name`
 * plus a deterministic gradient keyed on `userId` — **not** on `name`, so
 * two clients both called "Alex" in the same list get different colours
 * (`ui-primitives-core/06`'s "Why this exists").
 */
export function getAvatarFallback(
  name: string,
  userId: string,
  palette: AvatarPalette = FALLBACK_PALETTE,
): AvatarFallback {
  const initials = getAvatarInitials(name);
  const index = hashUserId(userId) % palette.length;
  const gradient = palette[index];

  if (!gradient) {
    // Unreachable: `index` is always in range for a non-empty, fixed-size
    // palette — guarded rather than asserted with `!` (`code-conventions` §3).
    throw new Error('getAvatarFallback: palette index out of range');
  }

  return { initials, gradient };
}
