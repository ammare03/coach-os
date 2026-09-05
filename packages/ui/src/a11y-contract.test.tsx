import { render, screen } from '@testing-library/react-native';
import { Plus } from 'lucide-react-native';

import { AdherenceDot } from './components/AdherenceDot.tsx';
import { AdherenceDotRow } from './components/AdherenceDotRow.tsx';
import { Avatar } from './components/Avatar.tsx';
import { AvatarStack } from './components/AvatarStack.tsx';
import { Badge } from './components/Badge.tsx';
import { Button } from './components/Button.tsx';
import { Calendar } from './components/Calendar.tsx';
import { Card } from './components/Card.tsx';
import { Chip } from './components/Chip.tsx';
import { EmptyState } from './components/EmptyState.tsx';
import { FormField } from './components/FormField.tsx';
import { IconButton } from './components/IconButton.tsx';
import { Input } from './components/Input.tsx';
import { LoadingState } from './components/LoadingState.tsx';
import { NumberStepper } from './components/NumberStepper.tsx';
import { SegmentedControl } from './components/SegmentedControl.tsx';
import { SheetHeader } from './components/SheetHeader.tsx';
import { Text } from './components/Text.tsx';

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
});

describe('regions that are not controls still announce themselves', () => {
  it('LoadingState is a busy progressbar, not a silent blank screen', () => {
    render(<LoadingState shape="card" accessibilityLabel="Loading this week" />);
    const region = screen.getByLabelText('Loading this week');
    expect(region.props.accessibilityRole).toBe('progressbar');
    expect(region.props.accessibilityState).toMatchObject({ busy: true });
  });
});
