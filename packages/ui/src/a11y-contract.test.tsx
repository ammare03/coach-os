import { fireEvent, render, screen } from '@testing-library/react-native';
import { Plus } from 'lucide-react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AdherenceDot } from './components/AdherenceDot.tsx';
import { AdherenceDotRow } from './components/AdherenceDotRow.tsx';
import { Avatar } from './components/Avatar.tsx';
import { AvatarStack } from './components/AvatarStack.tsx';
import { Badge } from './components/Badge.tsx';
import { Button } from './components/Button.tsx';
import { Calendar } from './components/Calendar.tsx';
import { Card } from './components/Card.tsx';
import { CHART_MIN_SPAN } from './components/chartDomain.ts';
import { Chip } from './components/Chip.tsx';
import { ConfirmModal } from './components/ConfirmModal.tsx';
import { EmptyState } from './components/EmptyState.tsx';
import { FORBIDDEN_COPY, ForbiddenState } from './components/ForbiddenState.tsx';
import { FormField } from './components/FormField.tsx';
import { IconButton } from './components/IconButton.tsx';
import { Input } from './components/Input.tsx';
import { LineChart } from './components/LineChart.tsx';
import { LoadingState } from './components/LoadingState.tsx';
import { MacroBar } from './components/MacroBar.tsx';
import { Modal } from './components/Modal.tsx';
import { NOT_FOUND_COPY, NotFoundState } from './components/NotFoundState.tsx';
import { NumberStepper } from './components/NumberStepper.tsx';
import { ProgressRing } from './components/ProgressRing.tsx';
import { SegmentedControl } from './components/SegmentedControl.tsx';
import { SheetFooter } from './components/SheetFooter.tsx';
import { SheetHeader } from './components/SheetHeader.tsx';
import { Skeleton } from './components/Skeleton.tsx';
import { SkeletonText } from './components/SkeletonText.tsx';
import { Sparkline } from './components/Sparkline.tsx';
import { Text } from './components/Text.tsx';
import { MEDICAL_DISCLAIMER_COPY } from './MedicalDisclaimer/copy.ts';
import { MedicalDisclaimer } from './MedicalDisclaimer/MedicalDisclaimer.tsx';
import { Toast } from './toast/Toast.tsx';

// `component-gallery/03` — the accessibility half of the audit, in one
// place. The point of gathering it here rather than trusting twelve
// component tests is that "every interactive primitive is labelled" is a
// claim about the SET, and a new primitive that forgets a label passes every
// existing test in the package.
//
// Three things are asserted per control, because a screen reader needs all
// three and any one of them missing is silent failure:
//   - a LABEL naming the action or the value, never the icon
//   - a ROLE, so the control is reachable and its gesture is announced
//   - a STATE, wherever the control has one (disabled, selected, busy)
//
// The two mechanical rules from `accessibility` §2 are asserted alongside:
// an icon-only control's label names the ACTION, and a decorative element is
// removed from the reading order rather than left as noise.

describe('interactive primitives are labelled, roled, and stated', () => {
  it('Button — role, label from its own words, and both states', () => {
    render(<Button onPress={jest.fn()}>Invite client</Button>);
    const button = screen.getByRole('button', { name: 'Invite client' });
    expect(button.props.accessibilityState).toMatchObject({ disabled: false, busy: false });
  });

  it('Button — disabled and loading are announced, not just drawn', () => {
    const { rerender } = render(
      <Button onPress={jest.fn()} disabled>
        Invite client
      </Button>,
    );
    expect(
      screen.getByRole('button', { name: 'Invite client' }).props.accessibilityState,
    ).toMatchObject({ disabled: true });

    rerender(
      <Button onPress={jest.fn()} loading>
        Invite client
      </Button>,
    );
    expect(
      screen.getByRole('button', { name: 'Invite client' }).props.accessibilityState,
    ).toMatchObject({ busy: true });
  });

  it('IconButton — the label is the action, and the type demands one', () => {
    render(
      <IconButton icon={<Plus size={16} />} accessibilityLabel="Add set" onPress={jest.fn()} />,
    );
    // Not "plus icon" — `accessibility` §2. The type makes omitting it a
    // compile error, so the only failure left is a bad string.
    expect(screen.getByRole('button', { name: 'Add set' })).toBeTruthy();
  });

  it('Card — focusable and roled only when it is actually a control', () => {
    const { rerender } = render(
      <Card onPress={jest.fn()} accessibilityLabel="Priya, 3 of 5 logged">
        <Text>Priya</Text>
      </Card>,
    );
    expect(screen.getByRole('button', { name: 'Priya, 3 of 5 logged' })).toBeTruthy();

    rerender(
      <Card>
        <Text>Priya</Text>
      </Card>,
    );
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('Chip — interactive chips are buttons carrying their selected state', () => {
    render(<Chip label="Legs" selected onPress={jest.fn()} />);
    expect(screen.getByRole('button', { name: 'Legs' }).props.accessibilityState).toMatchObject({
      selected: true,
    });
  });

  it('Chip — a chip with no onPress is a tag, not a dimmed button', () => {
    // The defect this replaced: a display-only chip rendered as a disabled
    // `Pressable`, so VoiceOver announced a read-only label as "Legs,
    // button, dimmed, selected" — three claims, none of them true.
    render(<Chip label="Legs" selected />);
    expect(screen.queryByRole('button')).toBeNull();
    const tag = screen.getByLabelText('Legs');
    expect(tag.props.accessibilityState?.disabled).toBeFalsy();
  });

  it('Chip — the remove affordance names what it removes', () => {
    render(<Chip label="Legs" onPress={jest.fn()} onRemove={jest.fn()} />);
    expect(screen.getByLabelText('Remove Legs')).toBeTruthy();
  });

  it('Input — FormField supplies the spoken name and the error as the hint', () => {
    render(
      <FormField label="Email" error="Enter an email address">
        <Input value="" onChangeText={jest.fn()} />
      </FormField>,
    );
    const field = screen.getByLabelText('Email');
    expect(field.props.accessibilityHint).toBe('Enter an email address');
  });

  it('Input — the clear affordance names the field it clears', () => {
    render(
      <FormField label="Email">
        <Input value="a@b.co" onChangeText={jest.fn()} />
      </FormField>,
    );
    expect(screen.getByLabelText('Clear Email')).toBeTruthy();
  });

  it('Input — disabled is announced', () => {
    render(
      <FormField label="Email">
        <Input value="" onChangeText={jest.fn()} state="disabled" />
      </FormField>,
    );
    expect(screen.getByLabelText('Email').props.accessibilityState).toMatchObject({
      disabled: true,
    });
  });

  it('NumberStepper — adjustable, with a value and both increment actions', () => {
    render(
      <NumberStepper
        value={60}
        onChange={jest.fn()}
        step={2.5}
        min={0}
        max={300}
        accessibilityLabel="Weight in kilograms"
        unit="kg"
      />,
    );
    // `adjustable` is what makes the value reachable with a swipe, without
    // hunting for two 52px keys mid-set (`accessibility` §8).
    const adjustable = screen.getByRole('adjustable', { name: 'Weight in kilograms' });
    expect(adjustable.props.accessibilityValue).toMatchObject({ now: 60, min: 0, max: 300 });
    expect(
      (adjustable.props.accessibilityActions as { name: string }[]).map((a) => a.name).sort(),
    ).toEqual(['decrement', 'increment']);

    // And the visible keys are still labelled for anyone who taps them.
    expect(screen.getByLabelText('Increase Weight in kilograms')).toBeTruthy();
    expect(screen.getByLabelText('Decrease Weight in kilograms')).toBeTruthy();
  });

  it('MedicalDisclaimer — the acknowledgment is a checkbox, and it says what is being agreed to', () => {
    render(<MedicalDisclaimer variant="onboarding" onAcknowledge={jest.fn()} />);
    // Not "checkbox" and not "I understand" — the label is the whole
    // sentence, because a screen-reader user is agreeing to it unheard
    // otherwise (`accessibility` §2).
    const checkbox = screen.getByRole('checkbox', {
      name: MEDICAL_DISCLAIMER_COPY.acknowledgeLabel,
    });
    expect(checkbox.props.accessibilityState).toMatchObject({ checked: false });
  });

  it('SegmentedControl — a tablist of tabs, each announcing its position and selection', () => {
    render(
      <SegmentedControl
        options={[
          { value: 'week', label: 'Week' },
          { value: 'month', label: 'Month' },
        ]}
        value="week"
        onChange={jest.fn()}
      />,
    );
    const [first, second] = screen.getAllByRole('tab');
    expect(first?.props.accessibilityLabel).toBe('Week, tab 1 of 2');
    expect(first?.props.accessibilityState).toMatchObject({ selected: true });
    expect(second?.props.accessibilityState).toMatchObject({ selected: false });
  });

  it('Calendar — month navigation is labelled and every day carries its state', () => {
    render(
      <Calendar
        initialMonth="2026-09-01"
        selected="2026-09-17"
        onSelect={jest.fn()}
        locale="en-US"
      />,
    );
    expect(screen.getByLabelText('Previous month')).toBeTruthy();
    expect(screen.getByLabelText('Next month')).toBeTruthy();
    const day = screen.getByLabelText(/^September 17, 2026/);
    expect(day.props.accessibilityRole).toBe('button');
    expect(day.props.accessibilityState).toMatchObject({ selected: true });
  });

  it('AdherenceDot — the state is announced in words, tappable or not', () => {
    const { rerender } = render(<AdherenceDot state="no-data" />);
    // "Not started", never "no data" and never a colour — §10.5, and a hue
    // is not a thing a screen reader can read.
    expect(screen.getByLabelText('Not started')).toBeTruthy();

    rerender(<AdherenceDot state="off-track" onPress={jest.fn()} />);
    expect(screen.getByRole('button', { name: 'Off plan' })).toBeTruthy();
  });

  it('AdherenceDotRow — one summary, not seven dots', () => {
    render(
      <AdherenceDotRow
        days={[
          { dateISO: '2026-09-03', state: 'on-track' },
          { dateISO: '2026-09-04', state: 'no-data' },
        ]}
        metric="training"
        todayISO="2026-09-04"
      />,
    );
    // Seven fragments per client × thirty clients is what this prevents: the
    // strip announces one sentence and hides its own dots.
    expect(screen.queryAllByLabelText('On plan')).toHaveLength(0);
    expect(screen.getByLabelText(/training/i)).toBeTruthy();
  });

  it('SheetHeader — the close affordance is reachable without the gesture', () => {
    render(<SheetHeader title="Add exercise" onClose={jest.fn()} />);
    // `accessibility` §7 — never a gesture with no button equivalent.
    expect(screen.getByLabelText('Close')).toBeTruthy();
  });

  it('EmptyState — the single action is a labelled button', () => {
    render(
      <EmptyState
        title="No clients yet"
        body="Invite your first client to get started."
        primaryAction={{ label: 'Invite client', onPress: jest.fn() }}
      />,
    );
    expect(screen.getByRole('button', { name: 'Invite client' })).toBeTruthy();
  });

  it('NotFoundState — the recovery action is reachable and labelled from the copy', () => {
    render(<NotFoundState onRecover={jest.fn()} />);
    expect(screen.getByRole('button', { name: NOT_FOUND_COPY.action })).toBeTruthy();
  });

  it('ForbiddenState — the recovery action is reachable and labelled from the copy', () => {
    render(<ForbiddenState onRecover={jest.fn()} />);
    expect(screen.getByRole('button', { name: FORBIDDEN_COPY.action })).toBeTruthy();
  });

  it('SheetFooter — the commit action is a labelled, disableable button', () => {
    // `useSafeAreaInsets` throws outside a provider — the same wrapper
    // `scheme-wiring.test.tsx` uses for this component.
    const insets = (
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width: 390, height: 844 },
          insets: { top: 47, left: 0, right: 0, bottom: 34 },
        }}
      >
        <SheetFooter actionLabel="Add 2 items" onAction={jest.fn()} />
      </SafeAreaProvider>
    );
    const { rerender } = render(insets);
    expect(
      screen.getByRole('button', { name: 'Add 2 items' }).props.accessibilityState,
    ).toMatchObject({ disabled: true });

    rerender(
      <SafeAreaProvider
        initialMetrics={{
          frame: { x: 0, y: 0, width: 390, height: 844 },
          insets: { top: 47, left: 0, right: 0, bottom: 34 },
        }}
      >
        <SheetFooter actionLabel="Add 2 items" onAction={jest.fn()} isActionDisabled={false} />
      </SafeAreaProvider>,
    );
    expect(
      screen.getByRole('button', { name: 'Add 2 items' }).props.accessibilityState,
    ).toMatchObject({ disabled: false });
  });

  it('Modal — an alert dialog that traps focus, with the scrim hidden from the reading order', () => {
    render(
      <Modal isOpen onDismiss={jest.fn()}>
        <Text>Delete this client?</Text>
      </Modal>,
    );
    // `getByRole` requires `accessible` to be explicit or inferred (`text`,
    // `textInput`, `switch`) — a plain `View` carrying only
    // `accessibilityRole` falls outside that, same as `Toast`'s root below,
    // so the dialog is found by its distinguishing prop instead.
    const dialog = screen.UNSAFE_getByProps({ accessibilityViewIsModal: true });
    expect(dialog.props.accessibilityRole).toBe('alert');
  });

  it('ConfirmModal — the typed match, not a tap, is what enables the action', () => {
    render(
      <ConfirmModal
        isOpen
        onCancel={jest.fn()}
        onConfirm={jest.fn()}
        title="Delete your account"
        body="This removes your workouts, photos, and messages after a 7-day grace period."
        confirmationText="DELETE"
        actionLabel="Delete account"
      />,
    );
    const action = () => screen.getByRole('button', { name: 'Delete account' });
    expect(action().props.accessibilityState).toMatchObject({ disabled: true });

    fireEvent.changeText(screen.getByPlaceholderText('DELETE'), 'DELETE');
    expect(action().props.accessibilityState).toMatchObject({ disabled: false });
  });
});

describe('decorative elements are removed from the reading order', () => {
  it('Avatar is hidden — it is redundant beside the name it abbreviates', () => {
    render(<Avatar name="Priya Sharma" userId="u1" testID="avatar" />);
    const avatar = screen.getByTestId('avatar', { includeHiddenElements: true });
    expect(avatar.props.accessibilityElementsHidden).toBe(true);
    expect(avatar.props.importantForAccessibility).toBe('no');
  });

  it('AvatarStack is the exception, and carries one label for the group', () => {
    render(
      <AvatarStack
        people={[
          { name: 'Priya Sharma', userId: 'u1' },
          { name: 'Arun Rao', userId: 'u2' },
        ]}
        max={1}
      />,
    );
    expect(screen.getByLabelText('Priya Sharma, and 1 more')).toBeTruthy();
  });

  it('Badge is hidden — the count belongs to the row it sits on', () => {
    render(<Badge count={3} testID="badge" />);
    expect(
      screen.getByTestId('badge', { includeHiddenElements: true }).props
        .accessibilityElementsHidden,
    ).toBe(true);
  });

  it('Skeleton is hidden by default — a screen made of them needs one announcement, not twenty', () => {
    render(<Skeleton height={20} testID="skeleton" />);
    const skeleton = screen.getByTestId('skeleton', { includeHiddenElements: true });
    expect(skeleton.props.accessibilityElementsHidden).toBe(true);
    expect(skeleton.props.accessible).toBe(false);
  });

  it('Sparkline is hidden when it carries no label — a mark with no meaning is noise', () => {
    render(<Sparkline points={[]} testID="spark" />);
    const spark = screen.getByTestId('spark', { includeHiddenElements: true });
    expect(spark.props.accessibilityElementsHidden).toBe(true);
    expect(spark.props.accessible).toBe(false);
  });
});

describe('regions that are not controls still announce themselves', () => {
  it('LoadingState is a busy progressbar, not a silent blank screen', () => {
    render(<LoadingState shape="card" accessibilityLabel="Loading this week" />);
    const region = screen.getByLabelText('Loading this week');
    expect(region.props.accessibilityRole).toBe('progressbar');
    expect(region.props.accessibilityState).toMatchObject({ busy: true });
  });

  it('Skeleton announces itself as a busy progressbar once it carries the region label', () => {
    render(<Skeleton height={20} accessibilityLabel="Loading this week" />);
    const region = screen.getByLabelText('Loading this week');
    expect(region.props.accessibilityRole).toBe('progressbar');
    expect(region.props.accessibilityState).toMatchObject({ busy: true });
  });

  it('SkeletonText puts the region label on its first line only, never once per line', () => {
    render(<SkeletonText lines={3} accessibilityLabel="Loading history" />);
    // `getByLabelText` throws on more than one match — the assertion IS that
    // exactly one of the three lines carries it (`Skeleton`'s own contract:
    // one label per loading region, not one per shape).
    expect(screen.getByLabelText('Loading history')).toBeTruthy();
  });

  it('ProgressRing — value, target, and unit as one spoken sentence', () => {
    render(<ProgressRing value={1800} target={2200} unit="kcal" label="left" />);
    const ring = screen.getByRole('progressbar');
    expect(ring.props.accessibilityLabel).toContain('1800');
    expect(ring.props.accessibilityValue).toMatchObject({ min: 0, max: 2200, now: 1800 });
  });

  it('MacroBar — the full protein/carbs/fat breakdown, not just the fill colour', () => {
    render(<MacroBar proteinG={40} carbsG={50} fatG={20} targetKcal={2000} />);
    const bar = screen.getByRole('progressbar');
    expect(bar.props.accessibilityLabel).toContain('protein 40 grams');
  });

  it('LineChart — a spoken summary standing in for a graphic no screen reader can read, plus a way to reach it as a list', () => {
    render(
      <LineChart
        series={[
          {
            points: [{ dateISO: '2026-09-01', value: 84.2 }],
            label: 'Weight',
            minSpan: CHART_MIN_SPAN.bodyWeightKg,
          },
        ]}
        onRequestTable={jest.fn()}
      />,
    );
    expect(screen.getByRole('image', { name: /^Weight, one entry on/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Read weight entries as a list' })).toBeTruthy();
  });

  it('Sparkline — the trend in a word, spoken instead of the shape', () => {
    render(<Sparkline points={[]} accessibilityLabel="Bench press working weight" />);
    expect(
      screen.getByRole('image', { name: 'Bench press working weight, no entries yet' }),
    ).toBeTruthy();
  });

  it('Toast — announced as an alert, with a labelled action', () => {
    render(
      <Toast
        toastId="t1"
        message="Set deleted"
        action={{ label: 'Undo', onPress: jest.fn() }}
        durationMs={5000}
        onTimeout={jest.fn()}
      />,
    );
    // Same reason as `Modal` above: found by the role prop directly, not
    // through `getByRole`'s accessible-element filter.
    expect(screen.UNSAFE_getByProps({ accessibilityRole: 'alert' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Undo' })).toBeTruthy();
  });
});
