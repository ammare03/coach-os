import { render, screen } from '@testing-library/react-native';
import { Text as RNText } from 'react-native';

import { Sheet, resolveSheetGestures, resolveSheetSnapPoints } from './Sheet.tsx';

// Nothing about the keyboard behaviour is unit-testable — that is verified
// on hardware (task 04's verification steps 1–3) and it is the real risk in
// this component. What IS testable is the mount contract every consumer
// relies on, and the two rules that would otherwise be one careless edit
// away from breaking silently.
describe('Sheet', () => {
  it('renders nothing when closed', () => {
    render(
      <Sheet isOpen={false} onDismiss={jest.fn()}>
        <RNText>Quick add</RNText>
      </Sheet>,
    );
    expect(screen.queryByText('Quick add')).toBeNull();
  });

  it('renders its content when open', () => {
    render(
      <Sheet isOpen onDismiss={jest.fn()}>
        <RNText>Quick add</RNText>
      </Sheet>,
    );
    expect(screen.getByText('Quick add')).toBeTruthy();
  });
});

describe('resolveSheetSnapPoints', () => {
  it('never snaps to the full height of the screen', () => {
    // A sheet at 100% is a screen and should be a route instead. The 10%
    // gap is what tells the user the screen behind is still there.
    expect(resolveSheetSnapPoints('full')).toEqual(['90%']);
    expect(resolveSheetSnapPoints('half')).toEqual(['50%']);
  });

  it('omits snap points entirely for auto, so the sheet sizes to its content', () => {
    expect(resolveSheetSnapPoints('auto')).toBeUndefined();
  });
});

describe('resolveSheetGestures', () => {
  it('leaves every dismissal gesture on by default', () => {
    expect(resolveSheetGestures(true)).toEqual({
      enablePanDownToClose: true,
      enableHandlePanningGesture: true,
      enableContentPanningGesture: true,
    });
  });

  it('turns off ALL of them when the sheet is not dismissible', () => {
    // Blocking only the backdrop still leaves the sheet draggable
    // off-screen — the bug this asserts against. Mid-purchase (P20) is the
    // one legitimate use and the one place it would be noticed too late.
    expect(Object.values(resolveSheetGestures(false))).toEqual([false, false, false]);
  });
});
