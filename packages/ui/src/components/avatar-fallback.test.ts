import { colors } from '../theme/tokens.ts';

import { getAvatarFallback, getAvatarInitials } from './avatar-fallback.ts';

describe('getAvatarInitials', () => {
  it('gives one letter for a single word', () => {
    expect(getAvatarInitials('Madonna')).toBe('M');
  });

  it('gives first + last word initials for two words', () => {
    expect(getAvatarInitials('Alex Kim')).toBe('AK');
  });

  it('uses only the first and last word when there are three or more', () => {
    expect(getAvatarInitials('Mary Jane Watson')).toBe('MW');
  });

  it('takes the first grapheme of a hyphenated single word', () => {
    expect(getAvatarInitials('Smith-Jones')).toBe('S');
  });

  it('keeps a combining diacritic attached to its base letter', () => {
    expect(getAvatarInitials('Émile Dubois')).toBe('ÉD');
  });

  it('does not split a Devanagari grapheme cluster', () => {
    // राज -> the grapheme cluster "रा" (base + vowel matra), not "र" alone.
    expect(getAvatarInitials('राज पटेल')).toBe('राप');
  });

  it('handles an Arabic name', () => {
    expect(getAvatarInitials('أحمد علي')).toBe('أع');
  });

  it('handles an emoji-led name without producing a replacement character', () => {
    const initials = getAvatarInitials('😀 Smith');
    expect(initials).not.toContain('�');
    expect(initials.endsWith('S')).toBe(true);
  });

  it('renders a neutral glyph for an empty name, never a blank string', () => {
    expect(getAvatarInitials('')).toBe('•');
  });

  it('renders a neutral glyph for a whitespace-only name', () => {
    expect(getAvatarInitials('   ')).toBe('•');
  });

  it('trims surrounding whitespace before splitting into words', () => {
    expect(getAvatarInitials('  Alex   Kim  ')).toBe('AK');
  });
});

describe('getAvatarFallback', () => {
  it('derives the same gradient for the same userId every time', () => {
    const a = getAvatarFallback('Alex Kim', 'user-123');
    const b = getAvatarFallback('Alex Kim', 'user-123');
    expect(a.gradient).toEqual(b.gradient);
  });

  it('keys the colour on userId, not on name', () => {
    const alex1 = getAvatarFallback('Alex', 'user-1');
    const alex1Again = getAvatarFallback('Alex', 'user-1');
    const priyaSameId = getAvatarFallback('Priya', 'user-1');

    // Same id -> same colour regardless of name...
    expect(alex1Again.gradient).toEqual(alex1.gradient);
    expect(priyaSameId.gradient).toEqual(alex1.gradient);
  });

  it('can give two people with the same name different colours', () => {
    const results = ['user-1', 'user-2', 'user-3', 'user-4', 'user-5', 'user-6'].map(
      (userId) => getAvatarFallback('Alex', userId).gradient,
    );
    const distinct = new Set(results.map((gradient) => gradient.join('|')));
    // A 3-slot palette over 6 ids cannot guarantee all-distinct, but it
    // must not collapse to a single colour for every id.
    expect(distinct.size).toBeGreaterThan(1);
  });

  it('never produces a gradient stop that reads as adherence state', () => {
    const adherenceHues = new Set<string>([
      colors.state.onPlan,
      colors.state.drifting,
      colors.state.offPlan,
      colors.state.notStarted,
      colors.urgent,
    ]);

    for (const userId of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) {
      const { gradient } = getAvatarFallback('Test User', userId);
      for (const stop of gradient) {
        expect(adherenceHues.has(stop)).toBe(false);
      }
    }
  });

  it('still returns a usable fallback for an empty name and id', () => {
    const result = getAvatarFallback('', '');
    expect(result.initials).toBe('•');
    expect(result.gradient).toHaveLength(2);
  });
});
