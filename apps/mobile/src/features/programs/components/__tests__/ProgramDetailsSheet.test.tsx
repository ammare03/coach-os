import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ProgramDetailsSheet, type ProgramDetailsValues } from '../ProgramDetailsSheet.tsx';

// `program-templates/01`'s toggle, and the resolution it carries
// (`program-templates/04`, live-reference): the sub-label states the
// consequence as fact, never a warning, and toggling never asks for
// confirmation — both asserted here rather than trusted to a screenshot.

const SAFE_AREA_METRICS = {
  frame: { x: 0, y: 0, width: 393, height: 852 },
  insets: { top: 59, left: 0, right: 0, bottom: 34 },
};

function withSafeArea(children: ReactNode) {
  return <SafeAreaProvider initialMetrics={SAFE_AREA_METRICS}>{children}</SafeAreaProvider>;
}

const EDIT_VALUES: ProgramDetailsValues = {
  name: 'Hypertrophy Block 2',
  description: '',
  durationWeeks: 12,
  isTemplate: true,
};

function renderSheet(overrides: Partial<Parameters<typeof ProgramDetailsSheet>[0]> = {}) {
  const onSave = jest.fn();
  const onDismiss = jest.fn();
  render(
    withSafeArea(
      <ProgramDetailsSheet
        isOpen
        mode="edit"
        initialValues={EDIT_VALUES}
        onSave={onSave}
        onDismiss={onDismiss}
        {...overrides}
      />,
    ),
  );
  return { onSave, onDismiss };
}

describe('ProgramDetailsSheet — the template toggle', () => {
  it('is absent in create mode — a fresh program is already a template', () => {
    render(
      withSafeArea(
        <ProgramDetailsSheet isOpen mode="create" onSave={jest.fn()} onDismiss={jest.fn()} />,
      ),
    );

    expect(screen.queryByTestId('program-is-template')).toBeNull();
  });

  it('shows in edit mode, reflecting the current value', () => {
    renderSheet();

    const toggle = screen.getByTestId('program-is-template');
    expect(toggle.props.value).toBe(true);
    expect(screen.getByText('Reusable template')).toBeTruthy();
    // States the live-reference consequence as fact, not a warning
    // (`program-templates/04`).
    expect(
      screen.getByText(
        'Shows in Programs, ready to assign to any client. Edits you make here reach everyone currently on it.',
      ),
    ).toBeTruthy();
  });

  it('toggling off requires no confirmation, and saves the new value', () => {
    const { onSave } = renderSheet();

    fireEvent(screen.getByTestId('program-is-template'), 'valueChange', false);
    // No confirm dialog to dismiss — the toggle itself is the only control.
    fireEvent.press(screen.getByText('Save'));

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ isTemplate: false, name: 'Hypertrophy Block 2' }),
    );
  });

  it('leaves isTemplate untouched when the coach only edits the name', () => {
    const { onSave } = renderSheet();

    fireEvent.changeText(screen.getByTestId('program-name'), 'Renamed block');
    fireEvent.press(screen.getByText('Save'));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ isTemplate: true }));
  });
});
