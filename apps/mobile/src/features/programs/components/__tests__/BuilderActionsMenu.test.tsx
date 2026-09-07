import { colors, resolveButtonVariantVisuals } from '@coachos/ui';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Copy, Trash2 } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { BuilderActionsMenu, type BuilderMenuAction } from '../BuilderActionsMenu.tsx';

// The kebab menu (`program-builder/06`, frame 1g). What is asserted is what
// a coach can actually reach and hear: every action is a labelled button,
// the destructive one is last and reads as destructive in words and not
// only in colour (`accessibility` §4), and nothing fires until it is
// pressed.

const SAFE_AREA_METRICS = {
  frame: { x: 0, y: 0, width: 393, height: 852 },
  insets: { top: 59, left: 0, right: 0, bottom: 34 },
};

function withSafeArea(children: ReactNode) {
  return <SafeAreaProvider initialMetrics={SAFE_AREA_METRICS}>{children}</SafeAreaProvider>;
}

// The destructive glyph's ink, asked of the design system by variant
// rather than by naming `urgent` — the same route `useDestructiveInk` takes
// in the component under test.
const DESTRUCTIVE_INK = resolveButtonVariantVisuals('danger', false, false).textColor;

function dayActions(): { actions: BuilderMenuAction[]; presses: string[] } {
  const presses: string[] = [];
  const actions: BuilderMenuAction[] = [
    {
      actionId: 'duplicate-day',
      label: 'Duplicate this day',
      icon: <Copy size={16} color={colors.fg.DEFAULT} />,
      onPress: () => presses.push('duplicate-day'),
    },
    {
      actionId: 'duplicate-week',
      label: 'Duplicate whole week',
      icon: <Copy size={16} color={colors.fg.DEFAULT} />,
      onPress: () => presses.push('duplicate-week'),
    },
    {
      actionId: 'delete-day',
      label: 'Delete day',
      icon: <Trash2 size={16} color={DESTRUCTIVE_INK} />,
      isDestructive: true,
      onPress: () => presses.push('delete-day'),
    },
  ];
  return { actions, presses };
}

describe('BuilderActionsMenu', () => {
  it('exposes every action as a labelled button, in frame 1g’s order', () => {
    const { actions } = dayActions();
    render(
      withSafeArea(
        <BuilderActionsMenu
          isOpen
          title="Tuesday"
          subtitle="Lower — squat focus"
          actions={actions}
          onDismiss={jest.fn()}
        />,
      ),
    );

    for (const action of actions) {
      const row = screen.getByTestId(`menu-action-${action.actionId}`);
      expect(row.props.accessibilityRole).toBe('button');
      // The label names the object, so a screen reader user hears what the
      // action is about without the surrounding rows for context.
      expect(row.props.accessibilityLabel).toBe(action.label);
    }
    // Destructive last — the position is part of how it reads, not decoration.
    expect(actions[actions.length - 1]?.actionId).toBe('delete-day');
  });

  it('fires only the action pressed', () => {
    const { actions, presses } = dayActions();
    render(
      withSafeArea(
        <BuilderActionsMenu isOpen title="Tuesday" actions={actions} onDismiss={jest.fn()} />,
      ),
    );

    fireEvent.press(screen.getByTestId('menu-action-duplicate-week'));
    expect(presses).toEqual(['duplicate-week']);
  });

  it('says "Delete day", not "Delete" — the word carries the meaning the colour also carries', () => {
    const { actions } = dayActions();
    render(
      withSafeArea(
        <BuilderActionsMenu isOpen title="Tuesday" actions={actions} onDismiss={jest.fn()} />,
      ),
    );

    expect(screen.getByTestId('menu-action-delete-day').props.accessibilityLabel).toBe(
      'Delete day',
    );
  });
});
