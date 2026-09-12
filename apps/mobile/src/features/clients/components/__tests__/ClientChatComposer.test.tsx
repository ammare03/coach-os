import { fireEvent, render, screen } from '@testing-library/react-native';

import { ClientChatComposer } from '../ClientChatComposer.tsx';

// **The one test this task exists for.**
//
// The P10 README's Risks section names a single failure mode for the Chat
// facet: a composer that looks functional, accepts text, and silently drops
// it — worse than no composer at all, because it reads as a bug rather than
// an unshipped feature. These assertions are what stop a later edit
// reintroducing it, and they are deliberately structural (the `editable`
// prop, the absence of a press handler) rather than visual, because a
// screenshot cannot tell a disabled field from a dimmed one.

describe('ClientChatComposer', () => {
  it('renders a text field the platform cannot route a keystroke to', () => {
    render(<ClientChatComposer />);

    const input = screen.getByTestId('client-chat-composer-input');

    // `editable={false}` is the property that matters: it is what stops the
    // keyboard opening and what stops RN delivering a change event at all.
    expect(input.props.editable).toBe(false);
    expect(input.props.accessibilityState).toMatchObject({ disabled: true });
  });

  it('drops nothing, because it accepts nothing', () => {
    render(<ClientChatComposer />);

    const input = screen.getByTestId('client-chat-composer-input');

    // Two assertions in one act. `fireEvent.changeText` on a non-editable
    // `TextInput` is refused by Testing Library exactly as the platform
    // refuses it, so this must not throw — and the composer's own
    // `onChangeText` throws by design, so a future edit that makes the
    // field editable without wiring a real handler fails HERE, loudly,
    // instead of eating a coach's message in production.
    expect(() => {
      fireEvent.changeText(input, 'Great work on those squats this week');
    }).not.toThrow();

    expect(input.props.value).toBe('');
    expect(screen.queryByDisplayValue('Great work on those squats this week')).toBeNull();
  });

  it('gives the send control no handler to fill in by accident', () => {
    render(<ClientChatComposer />);

    // Not a disabled button — not a button at all. A focusable control that
    // cannot be pressed is a stop in the reading order that leads nowhere
    // (`accessibility` §2), so it is a plain view with no `onPress` for a
    // later edit to complete, and it is genuinely out of the reading order:
    // Testing Library's default queries skip hidden elements, so the first
    // assertion IS the accessibility assertion.
    expect(screen.queryByTestId('client-chat-composer-send')).toBeNull();

    const send = screen.getByTestId('client-chat-composer-send', { includeHiddenElements: true });
    expect(send.props.onPress).toBeUndefined();
    expect(send.props.accessibilityElementsHidden).toBe(true);
  });

  it('says why, in a line that promises neither a date nor an outcome', () => {
    render(<ClientChatComposer />);

    // `product-copy` §2 and §5: a fact, no "coming soon", no apology, no
    // exclamation mark. Asserted on the literal because the wording is the
    // feature here — it is the only thing telling a coach this is unshipped
    // rather than broken.
    expect(screen.getByText("This version of CoachOS can't send messages.")).toBeTruthy();

    const explanation = screen.getByText("This version of CoachOS can't send messages.");
    expect(explanation.props.children).not.toContain('!');
  });

  it('labels the field with the action and the reason, for a screen reader', () => {
    render(<ClientChatComposer />);

    const input = screen.getByLabelText('Message composer');

    expect(input.props.accessibilityHint).toBe(
      "Disabled. This version of CoachOS can't send messages.",
    );
  });
});
