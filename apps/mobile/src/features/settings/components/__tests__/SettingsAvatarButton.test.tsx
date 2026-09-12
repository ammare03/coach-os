import { fireEvent, render, screen } from '@testing-library/react-native';

import { SettingsAvatarButton } from '../SettingsAvatarButton.tsx';

type MeQuery = {
  data: { id: string; name: string; email: string; weightUnit: 'kg' | 'lb' } | undefined;
  isPending: boolean;
  isError: boolean;
};

const LOADED: MeQuery = {
  data: { id: 'user-1', name: 'Priya Raman', email: 'priya@example.com', weightUnit: 'kg' },
  isPending: false,
  isError: false,
};

/** No cached profile and no network — a cold start in a basement. */
const UNRESOLVED: MeQuery = { data: undefined, isPending: true, isError: false };

/** The request failed outright, and the button still has to work. */
const FAILED: MeQuery = { data: undefined, isPending: false, isError: true };

let mockMeQuery: MeQuery = LOADED;

jest.mock('../../../../lib/trpc.ts', () => ({
  api: {
    me: {
      get: { useQuery: () => mockMeQuery },
    },
  },
}));

beforeEach(() => {
  mockMeQuery = LOADED;
});

describe('SettingsAvatarButton', () => {
  it('is announced as "Settings", never as the person in the picture', () => {
    render(<SettingsAvatarButton onPress={jest.fn()} />);

    const button = screen.getByLabelText('Settings');

    expect(button).toBeTruthy();
    expect(button.props.accessibilityRole).toBe('button');
    // The name is drawn (as initials) and must not be spoken: the avatar
    // hides itself from the reading order and this is the only label.
    expect(screen.queryByLabelText('Priya Raman')).toBeNull();
  });

  it('opens settings on press', () => {
    const onPress = jest.fn();
    render(<SettingsAvatarButton onPress={onPress} />);

    fireEvent.press(screen.getByLabelText('Settings'));

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('clears the 48x48 tap floor', () => {
    render(<SettingsAvatarButton onPress={jest.fn()} />);

    const style = StyleSheetFlatten(screen.getByLabelText('Settings').props.style);

    expect(style.minWidth).toBeGreaterThanOrEqual(48);
    expect(style.minHeight).toBeGreaterThanOrEqual(48);
  });

  it('shows initials from the cached profile', () => {
    render(<SettingsAvatarButton onPress={jest.fn()} />);

    // `includeHiddenElements` because the initials are DRAWN and not SPOKEN
    // — the avatar hides itself from the reading order, which is the
    // previous test's assertion seen from the other side.
    expect(screen.getByText('PR', { includeHiddenElements: true })).toBeTruthy();
  });

  it.each([
    ['the profile has not resolved yet', UNRESOLVED],
    ['the profile request failed', FAILED],
  ])('still renders a pressable circle when %s', (_case, query) => {
    mockMeQuery = query;
    const onPress = jest.fn();
    render(<SettingsAvatarButton onPress={onPress} />);

    fireEvent.press(screen.getByLabelText('Settings'));

    expect(onPress).toHaveBeenCalledTimes(1);
    // Never an empty circle: `avatar-fallback.ts` substitutes a neutral
    // glyph for a name it does not have (`ui-primitives-core/06`).
    expect(screen.getByText('•', { includeHiddenElements: true })).toBeTruthy();
    expect(screen.queryByText('PR', { includeHiddenElements: true })).toBeNull();
  });
});

/** RN flattens style arrays at render; the test needs the same resolved object. */
function StyleSheetFlatten(style: unknown): { minWidth?: number; minHeight?: number } {
  const flattened = Array.isArray(style) ? Object.assign({}, ...style.flat(9)) : (style ?? {});
  return flattened as { minWidth?: number; minHeight?: number };
}
