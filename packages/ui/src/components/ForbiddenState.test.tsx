import { fireEvent, render, screen } from '@testing-library/react-native';
import { View } from 'react-native';

import { FORBIDDEN_COPY, ForbiddenState } from './ForbiddenState.tsx';
import { NOT_FOUND_COPY, NotFoundState } from './NotFoundState.tsx';

describe('ForbiddenState', () => {
  it('offers a recovery action rather than a dead end', () => {
    const onRecover = jest.fn();
    render(<ForbiddenState onRecover={onRecover} />);

    fireEvent.press(screen.getByLabelText(FORBIDDEN_COPY.action));

    expect(onRecover).toHaveBeenCalledTimes(1);
  });

  it('states the account fact and the next step', () => {
    render(<ForbiddenState onRecover={() => {}} />);

    expect(screen.getByText(FORBIDDEN_COPY.title)).toBeTruthy();
    expect(screen.getByText(FORBIDDEN_COPY.body)).toBeTruthy();
  });

  it('announces the heading as a header', () => {
    render(<ForbiddenState onRecover={() => {}} />);

    expect(screen.getByText(FORBIDDEN_COPY.title).props.accessibilityRole).toBe('header');
  });

  it('hides its glyph from the reading order', () => {
    render(<ForbiddenState icon={<View testID="glyph" />} onRecover={() => {}} />);

    expect(screen.queryByTestId('glyph')).toBeNull();
    expect(screen.getByTestId('glyph', { includeHiddenElements: true })).toBeTruthy();
  });

  // `UI-UX.md` §UX4.2 — "explain, offer the path (upgrade, request access).
  // Never a bare 403." A tier block relabels the same required action.
  it('carries the tier path when a route names one', () => {
    const onRecover = jest.fn();
    render(
      <ForbiddenState
        title="Group live rooms are part of Pro"
        recoverLabel="See plans"
        onRecover={onRecover}
      />,
    );

    fireEvent.press(screen.getByLabelText('See plans'));

    expect(onRecover).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(FORBIDDEN_COPY.title)).toBeNull();
  });

  // `CLAUDE.md` §9.2 — the two states are never conflated into one generic
  // "error". This is the task's named risk, asserted rather than reviewed.
  describe('is never the same state as not-found', () => {
    it('shares no default string with it', () => {
      expect(FORBIDDEN_COPY.title).not.toBe(NOT_FOUND_COPY.title);
      expect(FORBIDDEN_COPY.body).not.toBe(NOT_FOUND_COPY.body);
    });

    it('never renders the not-found copy, and vice versa', () => {
      render(<ForbiddenState onRecover={() => {}} />);
      expect(screen.queryByText(NOT_FOUND_COPY.title)).toBeNull();
      expect(screen.queryByText(NOT_FOUND_COPY.body)).toBeNull();

      screen.unmount();

      render(<NotFoundState onRecover={() => {}} />);
      expect(screen.queryByText(FORBIDDEN_COPY.title)).toBeNull();
      expect(screen.queryByText(FORBIDDEN_COPY.body)).toBeNull();
    });

    it('draws a different glyph', () => {
      render(<ForbiddenState onRecover={() => {}} testID="forbidden" />);
      const forbidden = glyphPath('forbidden');

      screen.unmount();

      render(<NotFoundState onRecover={() => {}} testID="not-found" />);

      expect(forbidden).not.toBe(glyphPath('not-found'));
    });
  });
});

/**
 * Lucide renders an `Svg` whose `Path` children carry the shape — reading
 * the first `d` is the cheapest way to prove the two glyphs differ without
 * asserting on a specific icon name.
 */
function glyphPath(testID: string): unknown {
  const path = screen
    .getByTestId(testID, { includeHiddenElements: true })
    .findAll((node) => typeof node.props?.d === 'string')[0];

  if (!path) throw new Error(`no glyph path under ${testID}`);
  return path.props.d;
}
