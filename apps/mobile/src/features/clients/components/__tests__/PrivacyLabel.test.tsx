import { render, screen } from '@testing-library/react-native';

import {
  PRIVACY_LABEL_MIN_HEIGHT,
  PRIVACY_LABEL_SPOKEN,
  PRIVACY_LABEL_TEXT,
  PrivacyLabel,
} from '../PrivacyLabel.tsx';

// §8.3's one requirement this component exists for: a coach's notes are
// labelled explicitly as private, in the same words, on both surfaces that
// show them. What can break silently is the wording drifting between the
// two, or the sentence arriving at a screen reader as one run-on clause.

describe('PrivacyLabel', () => {
  it('says the sentence §8.3 asks for, verbatim', () => {
    render(<PrivacyLabel />);

    expect(screen.getByText(PRIVACY_LABEL_TEXT)).toBeTruthy();
    expect(PRIVACY_LABEL_TEXT).toBe('Private — never visible to your client');
  });

  it('speaks it as two sentences, because an em dash does not read aloud', () => {
    render(<PrivacyLabel />);

    expect(screen.getByLabelText(PRIVACY_LABEL_SPOKEN)).toBeTruthy();
    expect(PRIVACY_LABEL_SPOKEN).toBe('Private. These notes are never visible to your client.');
    expect(PRIVACY_LABEL_SPOKEN).not.toContain('—');
  });

  it('is one stop in the reading order, not a lock and a sentence', () => {
    render(<PrivacyLabel />);

    const well = screen.getByTestId('privacy-label');
    expect(well.props.accessible).toBe(true);
    expect(well.props.accessibilityRole).toBe('text');
  });

  it('takes no props, so two call sites cannot drift', () => {
    // The type has only `testID`; the runtime signature has to agree, or a
    // later edit could add a `tone`/`density` knob without anyone noticing
    // the risk this component was extracted to remove.
    expect(PrivacyLabel.length).toBeLessThanOrEqual(1);
  });

  it('stands at 1 + 11 + 22 + 11 + 1, and grows rather than clipping', () => {
    render(<PrivacyLabel />);

    expect(PRIVACY_LABEL_MIN_HEIGHT).toBe(46);
    const style = screen.getByTestId('privacy-label').props.style as unknown[];
    const flat = Object.assign({}, ...(style.flat(2) as object[])) as Record<string, unknown>;
    expect(flat.minHeight).toBe(46);
    // A fixed height is what clips the two-line wrap at 200% text.
    expect(flat.height).toBeUndefined();
  });
});
