import { render, screen } from '@testing-library/react-native';

import { ClientStatusChip, describeClientStatus } from '../ClientStatusChip.tsx';

// The chip is a TAG, not a control, and that is the whole of what this
// file protects: a `Chip` with no `onPress` renders as an `accessible`
// View, and a `Chip` that grew one would announce as a dimmed button
// carrying a selection state — three claims, none of them true of a fact
// about a person (`Chip`'s own contract, `accessibility` §2).
//
// Asia/Kolkata rather than the device's zone, so the spoken date is the
// same sentence on every machine that runs this.
const IST = 'Asia/Kolkata';
const PAUSED_AT = new Date('2026-09-11T06:30:00.000Z'); // 11 Sep, 12:00 IST
const ARCHIVED_AT = new Date('2026-09-04T06:30:00.000Z');

describe('ClientStatusChip', () => {
  it('says Paused, and says when in the spoken label', () => {
    render(<ClientStatusChip status="paused" since={PAUSED_AT} timeZone={IST} />);

    expect(screen.getByText('Paused')).toBeTruthy();
    expect(screen.getByLabelText('Paused since 11 September')).toBeTruthy();
  });

  it('says Archived, and says when in the spoken label', () => {
    render(<ClientStatusChip status="archived" since={ARCHIVED_AT} timeZone={IST} />);

    expect(screen.getByText('Archived')).toBeTruthy();
    expect(screen.getByLabelText('Archived on 4 September')).toBeTruthy();
  });

  it('speaks the status alone when the timestamp is not known', () => {
    render(<ClientStatusChip status="paused" since={null} timeZone={IST} />);

    // Never an invented date and never a half sentence — the fact without
    // the date is still a true fact (`product-copy` §1).
    expect(screen.getByLabelText('Paused')).toBeTruthy();
  });

  it('is not a focus stop a coach can press', () => {
    render(<ClientStatusChip status="paused" since={PAUSED_AT} timeZone={IST} />);

    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('describeClientStatus', () => {
  it('is the one place the two spoken sentences are built', () => {
    expect(describeClientStatus('paused', PAUSED_AT, IST)).toBe('Paused since 11 September');
    expect(describeClientStatus('archived', ARCHIVED_AT, IST)).toBe('Archived on 4 September');
    expect(describeClientStatus('archived', null, IST)).toBe('Archived');
  });
});
