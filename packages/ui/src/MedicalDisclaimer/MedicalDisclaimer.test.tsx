import { fireEvent, render, screen } from '@testing-library/react-native';

import { MEDICAL_DISCLAIMER_COPY } from './copy.ts';
import { MedicalDisclaimer } from './MedicalDisclaimer.tsx';

describe('MedicalDisclaimer — onboarding', () => {
  it('blocks the flow until the acknowledgment is given', () => {
    const onAcknowledge = jest.fn();
    render(<MedicalDisclaimer variant="onboarding" onAcknowledge={onAcknowledge} />);

    const cta = screen.getByLabelText(MEDICAL_DISCLAIMER_COPY.continueLabel);
    expect(cta.props.accessibilityState).toMatchObject({ disabled: true });

    // The verification step this task names: attempt to proceed without
    // acknowledging, and confirm the flow does not move.
    fireEvent.press(cta);
    expect(onAcknowledge).not.toHaveBeenCalled();
  });

  it('lets the flow continue once the acknowledgment is given', () => {
    const onAcknowledge = jest.fn();
    render(<MedicalDisclaimer variant="onboarding" onAcknowledge={onAcknowledge} />);

    fireEvent.press(screen.getByLabelText(MEDICAL_DISCLAIMER_COPY.acknowledgeLabel));

    const cta = screen.getByLabelText(MEDICAL_DISCLAIMER_COPY.continueLabel);
    expect(cta.props.accessibilityState).toMatchObject({ disabled: false });
    fireEvent.press(cta);
    expect(onAcknowledge).toHaveBeenCalledTimes(1);
  });

  it('blocks the flow again if the acknowledgment is withdrawn', () => {
    const onAcknowledge = jest.fn();
    render(<MedicalDisclaimer variant="onboarding" onAcknowledge={onAcknowledge} />);

    const checkbox = screen.getByLabelText(MEDICAL_DISCLAIMER_COPY.acknowledgeLabel);
    fireEvent.press(checkbox);
    fireEvent.press(checkbox);

    fireEvent.press(screen.getByLabelText(MEDICAL_DISCLAIMER_COPY.continueLabel));
    expect(onAcknowledge).not.toHaveBeenCalled();
  });

  it('announces the acknowledgment as a checkbox, with its checked state', () => {
    render(<MedicalDisclaimer variant="onboarding" onAcknowledge={jest.fn()} />);

    const checkbox = screen.getByRole('checkbox', {
      name: MEDICAL_DISCLAIMER_COPY.acknowledgeLabel,
    });
    expect(checkbox.props.accessibilityState).toMatchObject({ checked: false });

    fireEvent.press(checkbox);
    expect(
      screen.getByRole('checkbox', { name: MEDICAL_DISCLAIMER_COPY.acknowledgeLabel }).props
        .accessibilityState,
    ).toMatchObject({ checked: true });
  });

  it('does not fire while the caller-supplied write is still in flight', () => {
    const onAcknowledge = jest.fn();
    render(<MedicalDisclaimer variant="onboarding" onAcknowledge={onAcknowledge} submitting />);

    fireEvent.press(screen.getByLabelText(MEDICAL_DISCLAIMER_COPY.acknowledgeLabel));
    fireEvent.press(screen.getByLabelText(MEDICAL_DISCLAIMER_COPY.continueLabel));
    expect(onAcknowledge).not.toHaveBeenCalled();
  });
});

describe('MedicalDisclaimer — settings', () => {
  it('asks for nothing: no acknowledgment control and no Continue', () => {
    render(<MedicalDisclaimer variant="settings" />);

    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByLabelText(MEDICAL_DISCLAIMER_COPY.continueLabel)).toBeNull();
  });

  it('states the recorded acknowledgment as a fact when there is one', () => {
    render(<MedicalDisclaimer variant="settings" acknowledgedOn="16 Aug 2026" />);
    expect(screen.getByText('You acknowledged this on 16 Aug 2026.')).toBeTruthy();
  });

  it('says nothing rather than "never" when there is no acknowledgment', () => {
    render(<MedicalDisclaimer variant="settings" />);
    expect(screen.queryByText(/acknowledged this on/)).toBeNull();
  });
});

describe('MedicalDisclaimer — the words', () => {
  it('shows the same substantive content in both variants', () => {
    const { unmount } = render(
      <MedicalDisclaimer variant="onboarding" onAcknowledge={jest.fn()} />,
    );
    for (const paragraph of MEDICAL_DISCLAIMER_COPY.paragraphs) {
      expect(screen.getByText(paragraph)).toBeTruthy();
    }
    expect(screen.getByText(MEDICAL_DISCLAIMER_COPY.emergency)).toBeTruthy();
    unmount();

    render(<MedicalDisclaimer variant="settings" />);
    for (const paragraph of MEDICAL_DISCLAIMER_COPY.paragraphs) {
      expect(screen.getByText(paragraph)).toBeTruthy();
    }
    expect(screen.getByText(MEDICAL_DISCLAIMER_COPY.emergency)).toBeTruthy();
  });

  it('never diagnoses, prescribes, or promises an outcome (`COPY.md` §CO2)', () => {
    const everyLine = [
      MEDICAL_DISCLAIMER_COPY.title,
      ...MEDICAL_DISCLAIMER_COPY.paragraphs,
      MEDICAL_DISCLAIMER_COPY.emergency,
      MEDICAL_DISCLAIMER_COPY.acknowledgeLabel,
      MEDICAL_DISCLAIMER_COPY.continueLabel,
    ].join(' ');

    // `product-copy` §6's mechanics, asserted rather than reviewed: no
    // exclamation mark, and none of the three words that shame the person
    // for whom it was not simple.
    expect(everyLine).not.toMatch(/!/);
    expect(everyLine).not.toMatch(/\b(just|simply|easy)\b/i);
  });
});
