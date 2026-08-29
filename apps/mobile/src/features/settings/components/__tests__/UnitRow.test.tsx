import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { UnitRow } from '../UnitRow.tsx';

const mockMutate = jest.fn();
const mockSetData = jest.fn();
let mockMeData: { weightUnit: 'kg' | 'lb' } | undefined = { weightUnit: 'kg' };

jest.mock('../../../../lib/trpc.ts', () => ({
  api: {
    me: {
      get: {
        useQuery: () => ({ data: mockMeData }),
      },
      updatePreferences: {
        useMutation: (opts: { onMutate?: (input: unknown) => void }) => ({
          mutate: (input: unknown) => {
            opts.onMutate?.(input);
            mockMutate(input);
          },
        }),
      },
    },
    useUtils: () => ({
      me: {
        get: {
          cancel: jest.fn(),
          getData: () => mockMeData,
          setData: mockSetData,
          invalidate: jest.fn(),
        },
      },
    }),
  },
}));

describe('UnitRow', () => {
  beforeEach(() => {
    mockMutate.mockClear();
    mockSetData.mockClear();
    mockMeData = { weightUnit: 'kg' };
  });

  it('shows the example weight converted into both units', () => {
    render(<UnitRow />);

    expect(screen.getByText('100.0')).toBeTruthy(); // kg tile
    expect(screen.getByText('220')).toBeTruthy(); // lb tile
  });

  it('marks the unit matching the current preference as selected', () => {
    render(<UnitRow />);

    const kgTile = screen.getByLabelText(/Kilograms/);
    const lbTile = screen.getByLabelText(/Pounds/);
    expect(kgTile.props.accessibilityState.selected).toBe(true);
    expect(lbTile.props.accessibilityState.selected).toBe(false);
  });

  it('does nothing when tapping the already-selected unit', () => {
    render(<UnitRow />);

    fireEvent.press(screen.getByLabelText(/Kilograms/));

    expect(mockMutate).not.toHaveBeenCalled();
  });

  it('switches instantly — mutates and optimistically updates the cache on tap', async () => {
    render(<UnitRow />);

    fireEvent.press(screen.getByLabelText(/Pounds/));

    expect(mockMutate).toHaveBeenCalledWith({ weightUnit: 'lb' });
    await waitFor(() => expect(mockSetData).toHaveBeenCalledWith(undefined, { weightUnit: 'lb' }));
  });
});
