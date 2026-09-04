import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { useRef } from 'react';

import { Button } from '../components/Button.tsx';
import { duration } from '../theme/tokens.ts';

import {
  MAX_VISIBLE_TOASTS,
  TOAST_DEFAULT_DURATION_MS,
  ToastProvider,
  useToast,
} from './ToastProvider.tsx';
import { UNDO_WINDOW_MS, useUndoToast, type UndoToastOptions } from './useUndoToast.ts';

// The undo toast is the product's replacement for the confirm dialog
// (`CLAUDE.md` §7.5), so what is tested here is the promise it makes: the
// window is real, it is honoured exactly once, and a toast that has not
// been seen has not started counting.

function UndoTrigger({ options, label = 'Delete' }: { options: UndoToastOptions; label?: string }) {
  const showUndoToast = useUndoToast();
  return <Button onPress={() => showUndoToast(options)}>{label}</Button>;
}

/** Presses `n` times to queue `n` distinct undo toasts. */
function MultiUndoTrigger({ onCommit }: { onCommit: (index: number) => void }) {
  const showUndoToast = useUndoToast();
  const count = useRef(0);
  return (
    <Button
      onPress={() => {
        count.current += 1;
        const index = count.current;
        showUndoToast({
          message: `Set ${index} deleted`,
          onUndo: () => undefined,
          onCommit: () => onCommit(index),
        });
      }}
    >
      Delete
    </Button>
  );
}

function advance(ms: number) {
  act(() => {
    jest.advanceTimersByTime(ms);
  });
}

/** Runs the exit animation out so a leaving toast releases its slot. */
function settleExit() {
  advance(duration.state);
}

describe('useUndoToast', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('shows the message, an undo action, and a five-second countdown', () => {
    render(
      <ToastProvider>
        <UndoTrigger options={{ message: 'Set deleted', onUndo: jest.fn() }} />
      </ToastProvider>,
    );

    fireEvent.press(screen.getByText('Delete'));

    expect(screen.getByText('Set deleted')).toBeTruthy();
    expect(screen.getByText('Undo')).toBeTruthy();
    expect(UNDO_WINDOW_MS).toBe(5000);
    // `includeHiddenElements` because the countdown is deliberately out of
    // the reading order — a numeral that re-announced four times a second
    // would talk over the message it belongs to.
    expect(screen.getByText('5', { includeHiddenElements: true })).toBeTruthy();

    advance(1000);
    expect(screen.getByText('4', { includeHiddenElements: true })).toBeTruthy();

    advance(3000);
    expect(screen.getByText('1', { includeHiddenElements: true })).toBeTruthy();
  });

  it('reverses the optimistic change and never commits when undo is tapped inside the window', () => {
    const onUndo = jest.fn();
    const onCommit = jest.fn();
    render(
      <ToastProvider>
        <UndoTrigger options={{ message: 'Set deleted', onUndo, onCommit }} />
      </ToastProvider>,
    );

    fireEvent.press(screen.getByText('Delete'));
    advance(UNDO_WINDOW_MS - 1000);
    fireEvent.press(screen.getByText('Undo'));

    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(onCommit).not.toHaveBeenCalled();

    // The window must not fire behind an undo that already happened.
    advance(UNDO_WINDOW_MS);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('defers the server mutation until the window elapses, then commits once', () => {
    const onUndo = jest.fn();
    const onCommit = jest.fn();
    render(
      <ToastProvider>
        <UndoTrigger options={{ message: 'Set deleted', onUndo, onCommit }} />
      </ToastProvider>,
    );

    fireEvent.press(screen.getByText('Delete'));
    advance(UNDO_WINDOW_MS - 1);
    expect(onCommit).not.toHaveBeenCalled();

    advance(1);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onUndo).not.toHaveBeenCalled();

    settleExit();
    expect(screen.queryByText('Set deleted')).toBeNull();
  });

  it('resolves exactly once when undo is tapped twice', () => {
    const onUndo = jest.fn();
    const onCommit = jest.fn();
    render(
      <ToastProvider>
        <UndoTrigger options={{ message: 'Set deleted', onUndo, onCommit }} />
      </ToastProvider>,
    );

    fireEvent.press(screen.getByText('Delete'));
    const undo = screen.getByText('Undo');
    fireEvent.press(undo);
    fireEvent.press(undo);

    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('stops the timer when the provider unmounts', () => {
    const onCommit = jest.fn();
    const { unmount } = render(
      <ToastProvider>
        <UndoTrigger options={{ message: 'Set deleted', onUndo: jest.fn(), onCommit }} />
      </ToastProvider>,
    );

    fireEvent.press(screen.getByText('Delete'));
    unmount();
    advance(UNDO_WINDOW_MS * 2);

    expect(onCommit).not.toHaveBeenCalled();
  });
});

describe('ToastProvider queue', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('stacks up to the cap and queues the rest, so nothing overlaps', () => {
    render(
      <ToastProvider>
        <MultiUndoTrigger onCommit={jest.fn()} />
      </ToastProvider>,
    );

    const trigger = screen.getByText('Delete');
    for (let i = 0; i < MAX_VISIBLE_TOASTS + 1; i += 1) fireEvent.press(trigger);

    expect(screen.getAllByTestId('toast')).toHaveLength(MAX_VISIBLE_TOASTS);
    expect(screen.getByText('Set 1 deleted')).toBeTruthy();
    expect(screen.queryByText(`Set ${MAX_VISIBLE_TOASTS + 1} deleted`)).toBeNull();
  });

  it('starts a queued toast’s window only once it becomes visible', () => {
    const onCommit = jest.fn();
    render(
      <ToastProvider>
        <MultiUndoTrigger onCommit={onCommit} />
      </ToastProvider>,
    );

    const trigger = screen.getByText('Delete');
    for (let i = 0; i < MAX_VISIBLE_TOASTS + 1; i += 1) fireEvent.press(trigger);

    // The three visible windows close together; the queued one has not
    // started, because an undo window nobody could see is not an offer.
    advance(UNDO_WINDOW_MS);
    expect(onCommit).toHaveBeenCalledTimes(MAX_VISIBLE_TOASTS);
    expect(onCommit).not.toHaveBeenCalledWith(MAX_VISIBLE_TOASTS + 1);

    settleExit();
    expect(screen.getByText(`Set ${MAX_VISIBLE_TOASTS + 1} deleted`)).toBeTruthy();
    expect(onCommit).toHaveBeenCalledTimes(MAX_VISIBLE_TOASTS);

    advance(UNDO_WINDOW_MS);
    expect(onCommit).toHaveBeenCalledWith(MAX_VISIBLE_TOASTS + 1);
  });

  it('does not restart an open window when a second toast appears', () => {
    const onCommit = jest.fn();
    render(
      <ToastProvider>
        <MultiUndoTrigger onCommit={onCommit} />
      </ToastProvider>,
    );

    const trigger = screen.getByText('Delete');
    fireEvent.press(trigger);
    advance(UNDO_WINDOW_MS - 1000);
    fireEvent.press(trigger);

    // The first toast has 1s of its own window left, and a re-render of the
    // host is not an extension of it.
    advance(1000);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(1);
  });

  it('auto-dismisses a plain toast with no action after the default window', () => {
    function PlainTrigger() {
      const { showToast } = useToast();
      return <Button onPress={() => showToast({ message: 'Program published' })}>Publish</Button>;
    }

    render(
      <ToastProvider>
        <PlainTrigger />
      </ToastProvider>,
    );

    fireEvent.press(screen.getByText('Publish'));
    expect(screen.getByText('Program published')).toBeTruthy();
    // No action, no countdown — a plain toast reports, it does not offer.
    expect(screen.queryByText('Undo')).toBeNull();

    advance(TOAST_DEFAULT_DURATION_MS);
    settleExit();
    expect(screen.queryByText('Program published')).toBeNull();
  });

  it('commits when a toast is dismissed early, because dismissing is not undoing', () => {
    const onUndo = jest.fn();
    const onCommit = jest.fn();

    function DismissTrigger() {
      const { dismissToast } = useToast();
      const showUndoToast = useUndoToast();
      const id = useRef<string | null>(null);
      return (
        <>
          <Button
            onPress={() => {
              id.current = showUndoToast({ message: 'Set deleted', onUndo, onCommit });
            }}
          >
            Delete
          </Button>
          <Button onPress={() => id.current && dismissToast(id.current)}>Close</Button>
        </>
      );
    }

    render(
      <ToastProvider>
        <DismissTrigger />
      </ToastProvider>,
    );

    fireEvent.press(screen.getByText('Delete'));
    fireEvent.press(screen.getByText('Close'));

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onUndo).not.toHaveBeenCalled();
  });
});
