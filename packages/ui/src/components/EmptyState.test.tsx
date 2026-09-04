import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet, View, type ViewStyle } from 'react-native';

import { EmptyState } from './EmptyState.tsx';

/**
 * The action's height lives on `Button`'s inner animated view, not on the
 * accessible host, so the tap floor is read by walking down from the label.
 */
function actionHeight(label: string): number {
  const host = screen.getByLabelText(label);
  const sized = host
    .findAll((node) => typeof node.type === 'string')
    .map((node) => StyleSheet.flatten(node.props.style as ViewStyle | undefined))
    .find((style) => typeof style?.height === 'number');

  if (typeof sized?.height !== 'number') throw new Error('no height on the action');
  return sized.height;
}

const action = { label: 'Invite your first client', onPress: () => {} };

describe('EmptyState', () => {
  it('calls the one primary action', () => {
    const onPress = jest.fn();
    render(<EmptyState title="No clients yet" primaryAction={{ label: 'Invite', onPress }} />);

    fireEvent.press(screen.getByLabelText('Invite'));

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('renders with neither an illustration nor an explanation', () => {
    render(<EmptyState title="No clients yet" primaryAction={action} />);

    expect(screen.getByText('No clients yet')).toBeTruthy();
    expect(screen.getByLabelText(action.label)).toBeTruthy();
  });

  // `DESIGN.md` §6 — the isometric solid carries no meaning the text does
  // not already carry, so it is noise in the reading order.
  it('hides the illustration from the screen reader', () => {
    render(
      <EmptyState
        icon={<View testID="art" />}
        title="No photos yet"
        body="Only you and your coach can see these."
        primaryAction={action}
      />,
    );

    expect(screen.queryByTestId('art')).toBeNull();
    expect(screen.getByTestId('art', { includeHiddenElements: true })).toBeTruthy();
  });

  it('announces the heading as a header', () => {
    render(<EmptyState title="Queue clear" primaryAction={action} />);

    expect(screen.getByText('Queue clear').props.accessibilityRole).toBe('header');
  });

  // `accessibility` §1 — 48x48, both apps, no exceptions. §9 gives the empty
  // state's action one height rather than a density pair, so the coach app's
  // 46px primary button never applies here.
  it('keeps the action above the 48px tap floor at both densities', () => {
    render(<EmptyState title="No clients yet" primaryAction={action} density="client" />);
    expect(actionHeight(action.label)).toBeGreaterThanOrEqual(48);

    screen.unmount();

    render(<EmptyState title="No clients yet" primaryAction={action} density="coach" />);
    expect(actionHeight(action.label)).toBeGreaterThanOrEqual(48);
  });

  // §1.3's body floor: 16pt in the client app, 15pt in the coach app.
  it('steps the explanation down for coach density only', () => {
    render(
      <EmptyState
        title="Queue clear"
        body="Nothing else is waiting on you."
        primaryAction={action}
      />,
    );
    expect(screen.getByText('Nothing else is waiting on you.').props.className).toContain(
      'text-body-lg',
    );

    screen.unmount();

    render(
      <EmptyState
        title="Queue clear"
        body="Nothing else is waiting on you."
        primaryAction={action}
        density="coach"
      />,
    );
    const coachBody = screen.getByText('Nothing else is waiting on you.').props.className as string;
    expect(coachBody).not.toContain('text-body-lg');
    expect(coachBody).toContain('text-body');
  });
});
