import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import type { ProgramTemplate } from '../../api/programs.ts';
import { ProgramTemplatesScreen } from '../ProgramTemplatesScreen.tsx';

// `program-templates/01`, frames A/B: the Programs tab's default view.
// Loading, empty, error and loaded states (`ui-conventions` §4), plus the
// "New program" entry point from both the header and the empty state.

const SAFE_AREA_METRICS = {
  frame: { x: 0, y: 0, width: 393, height: 852 },
  insets: { top: 59, left: 0, right: 0, bottom: 34 },
};

function withSafeArea(children: ReactNode) {
  return <SafeAreaProvider initialMetrics={SAFE_AREA_METRICS}>{children}</SafeAreaProvider>;
}

const TEMPLATE: ProgramTemplate = {
  id: 'template-1',
  name: 'Hypertrophy Block 2',
  durationWeeks: 12,
  daysPerWeek: 4,
  exerciseCount: 18,
  updatedAt: new Date('2026-08-01T00:00:00Z'),
};

const mockFetchNextPage = jest.fn();
const mockRefetch = jest.fn();
const mockCreateMutate = jest.fn(
  (_input: unknown, opts?: { onSuccess?: (result: { id: string }) => void }) => {
    opts?.onSuccess?.({ id: 'new-program-id' });
  },
);

interface MockQueryState {
  data: { pages: { items: ProgramTemplate[]; nextCursor: string | null }[] } | undefined;
  isPending: boolean;
  isError: boolean;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
}

let mockQueryState: MockQueryState = {
  data: { pages: [{ items: [TEMPLATE], nextCursor: null }] },
  isPending: false,
  isError: false,
  hasNextPage: false,
  isFetchingNextPage: false,
};

jest.mock('../../../../lib/trpc.ts', () => ({
  api: {
    programs: {
      listTemplates: {
        useInfiniteQuery: () => ({
          ...mockQueryState,
          refetch: mockRefetch,
          fetchNextPage: mockFetchNextPage,
        }),
      },
      create: {
        useMutation: () => ({ mutate: mockCreateMutate, isPending: false }),
      },
    },
  },
}));

function renderScreen(onOpenProgram = jest.fn()) {
  render(withSafeArea(<ProgramTemplatesScreen onOpenProgram={onOpenProgram} />));
  return { onOpenProgram };
}

describe('ProgramTemplatesScreen — states', () => {
  beforeEach(() => {
    mockFetchNextPage.mockClear();
    mockRefetch.mockClear();
    mockCreateMutate.mockClear();
  });

  it('shows a loading skeleton while the first page is in flight', () => {
    mockQueryState = {
      data: undefined,
      isPending: true,
      isError: false,
      hasNextPage: false,
      isFetchingNextPage: false,
    };
    renderScreen();

    expect(screen.getByLabelText('Loading your programs')).toBeTruthy();
  });

  it('shows a retryable error and calls refetch on tap', () => {
    mockQueryState = {
      data: undefined,
      isPending: false,
      isError: true,
      hasNextPage: false,
      isFetchingNextPage: false,
    };
    renderScreen();

    expect(screen.getByText("We couldn't load your programs")).toBeTruthy();
    fireEvent.press(screen.getByText('Try again'));
    expect(mockRefetch).toHaveBeenCalled();
  });

  it('shows the empty state with no shame and one action, when there are no templates', () => {
    mockQueryState = {
      data: { pages: [{ items: [], nextCursor: null }] },
      isPending: false,
      isError: false,
      hasNextPage: false,
      isFetchingNextPage: false,
    };
    renderScreen();

    expect(screen.getByText('No templates yet')).toBeTruthy();
    expect(
      screen.getByText('Build a program once and reuse it with every client who needs it.'),
    ).toBeTruthy();
  });
});

describe('ProgramTemplatesScreen — the loaded list', () => {
  beforeEach(() => {
    mockQueryState = {
      data: { pages: [{ items: [TEMPLATE], nextCursor: null }] },
      isPending: false,
      isError: false,
      hasNextPage: false,
      isFetchingNextPage: false,
    };
    mockFetchNextPage.mockClear();
    mockRefetch.mockClear();
    mockCreateMutate.mockClear();
  });

  it('renders a row with the name, week badge, and meta line', () => {
    renderScreen();

    expect(screen.getByText('Hypertrophy Block 2')).toBeTruthy();
    expect(screen.getByText(/4 days\/week · 18 exercises · edited/)).toBeTruthy();
    // The week badge is redundant with the row's own accessibilityLabel
    // (below) and hidden from the reading order, so it's asserted through
    // that label rather than a second, competing `getByText`.
    expect(screen.getByTestId('template-row-template-1').props.accessibilityLabel).toContain(
      '12 wk',
    );
  });

  it('opens the tapped program', () => {
    const { onOpenProgram } = renderScreen();

    fireEvent.press(screen.getByTestId('template-row-template-1'));

    expect(onOpenProgram).toHaveBeenCalledWith('template-1');
  });

  it('creates a program from the header "+" and opens the result', async () => {
    const { onOpenProgram } = renderScreen();

    fireEvent.press(screen.getByTestId('new-program-header'));
    expect(screen.getByText('Create program')).toBeTruthy();

    fireEvent.changeText(screen.getByTestId('program-name'), 'New block');
    fireEvent.press(screen.getByText('Create program'));

    expect(mockCreateMutate).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'New block', durationWeeks: 1 }),
      expect.anything(),
    );
    await waitFor(() => expect(onOpenProgram).toHaveBeenCalledWith('new-program-id'));
  });

  it('also opens the create sheet from the trailing ghost button', () => {
    renderScreen();

    fireEvent.press(screen.getByTestId('new-program-ghost'));

    expect(screen.getByText('Create program')).toBeTruthy();
  });
});
