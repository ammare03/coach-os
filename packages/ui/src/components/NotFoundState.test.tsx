import { fireEvent, render, screen } from '@testing-library/react-native';
import { View } from 'react-native';

import { NOT_FOUND_COPY, NotFoundState } from './NotFoundState.tsx';

describe('NotFoundState', () => {
  it('offers a recovery action rather than a dead end', () => {
    const onRecover = jest.fn();
    render(<NotFoundState onRecover={onRecover} />);

    fireEvent.press(screen.getByLabelText(NOT_FOUND_COPY.action));

    expect(onRecover).toHaveBeenCalledTimes(1);
  });

  it('states what happened and what may have caused it', () => {
    render(<NotFoundState onRecover={() => {}} />);

    expect(screen.getByText(NOT_FOUND_COPY.title)).toBeTruthy();
    expect(screen.getByText(NOT_FOUND_COPY.body)).toBeTruthy();
  });

  it('announces the heading as a header', () => {
    render(<NotFoundState onRecover={() => {}} />);

    expect(screen.getByText(NOT_FOUND_COPY.title).props.accessibilityRole).toBe('header');
  });

  // The glyph carries nothing the heading does not already carry.
  it('hides its glyph from the reading order', () => {
    render(<NotFoundState icon={<View testID="glyph" />} onRecover={() => {}} />);

    expect(screen.queryByTestId('glyph')).toBeNull();
    expect(screen.getByTestId('glyph', { includeHiddenElements: true })).toBeTruthy();
  });

  it('lets a route replace every default string', () => {
    render(
      <NotFoundState
        title="That program is gone"
        body="Your coach may have unassigned it."
        recoverLabel="Back to today"
        onRecover={() => {}}
      />,
    );

    expect(screen.getByText('That program is gone')).toBeTruthy();
    expect(screen.getByText('Your coach may have unassigned it.')).toBeTruthy();
    expect(screen.getByLabelText('Back to today')).toBeTruthy();
    expect(screen.queryByText(NOT_FOUND_COPY.title)).toBeNull();
  });
});
