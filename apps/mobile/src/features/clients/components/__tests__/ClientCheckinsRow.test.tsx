import { schema } from '@coachos/db';
import { fontSize, spacing } from '@coachos/ui';
import { fireEvent, render, screen } from '@testing-library/react-native';

import {
  CHECKIN_ROW_HEIGHT,
  CHECKIN_STATUSES,
  CHECKIN_STATUS_BADGE,
  ClientCheckinsRow,
  describeCheckinRow,
  formatCheckinPeriod,
  type CheckinStatus,
  type ClientCheckin,
} from '../ClientCheckinsRow.tsx';

// `client-detail/05`. Everything asserted here is a decision with a wrong
// answer that ships silently: a badge word that contradicts the dashboard
// counter it came from, a status the database has and this table does not,
// a period rendered a day early for every coach west of UTC.

const IST = 'Asia/Kolkata';

function checkin(overrides: Partial<ClientCheckin> = {}): ClientCheckin {
  return {
    checkinId: '01924f2c-0000-7000-8000-00000000000a',
    status: 'submitted',
    periodStart: '2026-09-08',
    periodEnd: '2026-09-14',
    submittedAt: new Date('2026-09-14T10:00:00.000Z'),
    reviewedAt: null,
    ...overrides,
  };
}

describe('CHECKIN_STATUSES', () => {
  it('covers every status the database defines, exactly once', () => {
    // The MEMBERSHIP is the DB's (`checkin_status`); this array exists only
    // because `packages/db` is a devDependency of `apps/mobile` and the
    // wire type that would normally supply it is P17's. Pinned here so the
    // union cannot drift from the enum before that lands.
    expect([...CHECKIN_STATUSES].sort()).toEqual([...schema.checkinStatus.enumValues].sort());
    expect(new Set(CHECKIN_STATUSES).size).toBe(CHECKIN_STATUSES.length);
  });
});

describe('CHECKIN_STATUS_BADGE', () => {
  it('gives every status a word, and no two the same word', () => {
    const labels = CHECKIN_STATUSES.map((status) => CHECKIN_STATUS_BADGE[status].label);

    expect(labels).toEqual(['Due', 'Needs review', 'Reviewed', 'Missed']);
    // The word is the signal and the fill is the echo, so four states that
    // shared a word would be three states to anyone reading the label —
    // which is everyone using a screen reader, and everyone with no colour
    // vision (`accessibility` §4).
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('emphasises exactly the status the dashboard counts as Needs review', () => {
    // `apps/api/src/features/coach/dashboard.ts`: `needsReviewQuery` takes
    // `status = 'submitted'` and `checkinsDueQuery` takes `'pending'`, with
    // that file's own comment for why they can never count the same row.
    // One status is the coach's own queue; three are not.
    const emphasised = CHECKIN_STATUSES.filter((status) => CHECKIN_STATUS_BADGE[status].emphasised);

    expect(emphasised).toEqual(['submitted']);
  });
});

describe('formatCheckinPeriod', () => {
  it('collapses the month when the period does not cross one', () => {
    expect(formatCheckinPeriod('2026-09-08', '2026-09-14')).toBe('8 – 14 Sep');
  });

  it('names both months when it does', () => {
    expect(formatCheckinPeriod('2026-08-25', '2026-09-07')).toBe('25 Aug – 7 Sep');
  });

  it('reads a date column as a calendar day, never in the device zone', () => {
    // A `date` column is a day, not an instant. Read in any zone west of
    // UTC, 1 September becomes 31 August — `CLAUDE.md` §25.5, and the one
    // bug this product produces most often.
    expect(formatCheckinPeriod('2026-09-01', '2026-09-07')).toBe('1 – 7 Sep');
    expect(formatCheckinPeriod('2026-12-28', '2027-01-03')).toBe('28 Dec – 3 Jan');
  });
});

describe('describeCheckinRow', () => {
  it('gives a pending period the day it closes, from the period itself', () => {
    expect(describeCheckinRow(checkin({ status: 'pending' }), IST)).toBe('Due 14 Sep');
  });

  it('renders a submission instant in the coach’s own zone, not UTC', () => {
    // 14 Sep 19:00 UTC is 15 Sep 00:30 in Kolkata. A coach in India who
    // reads "Submitted 14 Sep" beside a period ending the 14th would
    // conclude it landed on time when it did not.
    const late = checkin({ submittedAt: new Date('2026-09-14T19:00:00.000Z') });

    expect(describeCheckinRow(late, IST)).toBe('Submitted 15 Sep');
    expect(describeCheckinRow(late, 'UTC')).toBe('Submitted 14 Sep');
  });

  it('gives a reviewed period the day the coach dealt with it', () => {
    const reviewed = checkin({
      status: 'reviewed',
      reviewedAt: new Date('2026-09-16T06:00:00.000Z'),
    });

    expect(describeCheckinRow(reviewed, IST)).toBe('Reviewed 16 Sep');
  });

  it('keeps the word when the instant its status implies is missing', () => {
    // Both columns are nullable. The word alone is still true; a
    // fabricated date would not be.
    expect(describeCheckinRow(checkin({ submittedAt: null }), IST)).toBe('Submitted');
    expect(describeCheckinRow(checkin({ status: 'reviewed', reviewedAt: null }), IST)).toBe(
      'Reviewed',
    );
  });

  it('states what did not happen, and passes no verdict on the client', () => {
    // "Overdue" and "missed by the client" are judgements about a person,
    // which the product never makes (`product-copy` §1).
    expect(describeCheckinRow(checkin({ status: 'missed' }), IST)).toBe('Nothing submitted');
  });
});

describe('ClientCheckinsRow', () => {
  function renderRow(status: CheckinStatus, onPress = jest.fn()) {
    render(
      <ClientCheckinsRow
        checkin={checkin({
          status,
          reviewedAt: new Date('2026-09-16T06:00:00.000Z'),
        })}
        timeZone={IST}
        onPress={onPress}
      />,
    );
    return onPress;
  }

  it.each(CHECKIN_STATUSES)('draws the %s badge with its own word', (status) => {
    renderRow(status);

    // `includeHiddenElements` because the badge is hidden from the
    // ACCESSIBILITY tree on purpose (see below) — it is still the thing a
    // sighted coach reads, and the four words are the whole signal.
    expect(
      screen.getByText(CHECKIN_STATUS_BADGE[status].label, { includeHiddenElements: true }),
    ).toBeTruthy();
  });

  it.each(CHECKIN_STATUSES)('announces the %s row as one sentence, status included', (status) => {
    renderRow(status);

    const label = screen.getByRole('button').props.accessibilityLabel as string;

    // The period, the detail, and the status word — the same three facts
    // the eye gets, in one utterance rather than four fragments
    // (`accessibility` §2).
    expect(label).toContain('Check-in, 8 September to 14 September');
    expect(label).toContain(describeCheckinRow(checkin({ status }), IST));
    expect(label).toContain(CHECKIN_STATUS_BADGE[status].label);
  });

  it('hides the badge from the reading order rather than repeating it', () => {
    renderRow('submitted');

    // The row's own label already says "Needs review". A second accessible
    // node saying it again is the per-row fragmentation `ClientRow` hides
    // its dot lane to avoid. `Chip`'s tag form IS such a node — it sets
    // `accessible` and its own label — so the row wraps it rather than
    // trusting it to stay quiet.
    expect(screen.queryAllByLabelText('Needs review')).toHaveLength(0);
    expect(screen.queryByText('Needs review')).toBeNull();
  });

  it('hands the press its id, never a closure over the row', () => {
    const onPress = renderRow('submitted');

    fireEvent.press(screen.getByRole('button'));

    expect(onPress).toHaveBeenCalledWith('01924f2c-0000-7000-8000-00000000000a');
  });

  it('reports the height the design measured, from the type scale', () => {
    // FlashList v2 deleted `estimatedItemSize` and measures rows itself, so
    // §25.8's protection is the row's job: a uniform `minHeight` so every
    // row reports a stable size on first layout instead of settling over
    // several frames.
    //
    // 11 + 20 + 3 + 15 + 11 + 1. Recomputed here from the same `fontSize`
    // table the row reads, so a change to the type scale fails this test
    // rather than silently leaving the recycler with a number that no
    // longer describes a row.
    const expected =
      spacing(11) * 2 +
      Number.parseInt(fontSize.label[1].lineHeight, 10) +
      spacing(3) +
      Number.parseInt(fontSize.micro[1].lineHeight, 10) +
      1;

    expect(CHECKIN_ROW_HEIGHT).toBe(expected);
    expect(CHECKIN_ROW_HEIGHT).toBe(61);
  });
});
