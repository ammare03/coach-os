import { render, screen, fireEvent } from '@testing-library/react-native';

import type { SessionHistoryItem } from '../../api.ts';
import {
  SESSION_ROW_HEIGHT,
  SessionHistoryRow,
  buildRowLabel,
  describeSession,
  formatSessionDate,
  formatSessionVolume,
} from '../SessionHistoryRow.tsx';

// Three things this row can get wrong in ways a type check cannot see:
// the date (a `date` column read in the wrong zone), the copy (a count
// reworded as an accusation), and the reviewed signal (a colour with no
// word behind it).

const SESSION_ID = '01924f2c-0000-7000-8000-00000000001a';

function makeSession(overrides: Partial<SessionHistoryItem> = {}): SessionHistoryItem {
  return {
    sessionId: SESSION_ID,
    scheduledDate: '2026-09-08',
    name: 'Upper A',
    status: 'completed',
    skipReason: null,
    durationSeconds: 2880,
    totalVolumeKg: 7240.5,
    personalRecordCount: 2,
    reviewedAt: new Date('2026-09-09T08:00:00.000Z'),
    ...overrides,
  };
}

const onPress = jest.fn();

beforeEach(() => {
  onPress.mockClear();
});

describe('formatSessionDate', () => {
  it('reads the calendar day in UTC, never the device zone', () => {
    // 8 September is the client's own training day. A coach west of UTC
    // reading it as an instant would render the 7th (`CLAUDE.md` §25.5).
    expect(formatSessionDate('2026-09-08', new Date('2026-09-12T00:00:00Z'))).toBe('Tue 8 Sep');
  });

  it('adds the year only when the session is not from this one', () => {
    expect(formatSessionDate('2025-12-30', new Date('2026-09-12T00:00:00Z'))).toBe(
      'Tue 30 Dec 2025',
    );
  });
});

describe('formatSessionVolume', () => {
  it('drops the decimal a four-figure session total does not need', () => {
    expect(formatSessionVolume(7240.5, 'kg')).toBe('7240.5');
    expect(formatSessionVolume(7240, 'kg')).toBe('7240');
  });

  it('converts through packages/utils for a reader who works in pounds', () => {
    // 7240 kg is ~15962 lb. The number is the util's, not this row's —
    // conversion lives in `packages/utils` and nowhere else (`CLAUDE.md` §0).
    expect(formatSessionVolume(7240, 'lb')).toBe('15961');
  });
});

describe('describeSession', () => {
  it('states counts, and puts the records in their own run', () => {
    expect(describeSession(makeSession(), 'kg')).toEqual({
      facts: '48 min · 7240.5 kg',
      records: '2 PRs',
    });
  });

  it('says nothing at all about records when there are none', () => {
    // "0 PRs" is loss framing for a perfectly good session (`product-copy` §3).
    expect(describeSession(makeSession({ personalRecordCount: 0 }), 'kg').records).toBeNull();
  });

  it('singularises one record', () => {
    expect(describeSession(makeSession({ personalRecordCount: 1 }), 'kg').records).toBe('1 PR');
  });

  it('repeats the client’s own skip reason and adds nothing to it', () => {
    expect(
      describeSession(
        makeSession({
          status: 'skipped',
          skipReason: 'travelling',
          durationSeconds: null,
          totalVolumeKg: null,
          personalRecordCount: 0,
        }),
        'kg',
      ),
    ).toEqual({ facts: 'Skipped · travelling', records: null });
  });

  it('states a skip with no reason as a fact, never as a judgement', () => {
    expect(describeSession(makeSession({ status: 'skipped', skipReason: null }), 'kg').facts).toBe(
      'Skipped',
    );
  });

  it('states an in-progress session rather than a duration that is still running', () => {
    expect(
      describeSession(
        makeSession({ status: 'in_progress', durationSeconds: 720, totalVolumeKg: null }),
        'kg',
      ).facts,
    ).toBe('In progress');
  });

  it('never claims a zero for a session that logged nothing measurable', () => {
    expect(
      describeSession(
        makeSession({ durationSeconds: null, totalVolumeKg: null, personalRecordCount: 0 }),
        'kg',
      ).facts,
    ).toBe('No sets logged');
  });
});

describe('buildRowLabel', () => {
  it('reads as one sentence, with the review state as a word', () => {
    expect(
      buildRowLabel('Tue 8 Sep', 'Upper A', { facts: '48 min · 7240 kg', records: '2 PRs' }, true),
    ).toBe('Tue 8 Sep. Upper A. 48 min, 7240 kg, 2 PRs. Needs review.');
  });

  it('says nothing about review on a session the coach has already opened', () => {
    expect(buildRowLabel('Tue 8 Sep', 'Upper A', { facts: '48 min', records: null }, false)).toBe(
      'Tue 8 Sep. Upper A. 48 min.',
    );
  });
});

describe('SessionHistoryRow', () => {
  it('announces the whole session as one labelled button', () => {
    render(<SessionHistoryRow session={makeSession()} unit="kg" onPress={onPress} />);

    expect(screen.getByLabelText('Tue 8 Sep. Upper A. 48 min, 7240.5 kg, 2 PRs.')).toBeTruthy();
  });

  it('carries "Needs review" as a word, not only as a surface', () => {
    render(
      <SessionHistoryRow session={makeSession({ reviewedAt: null })} unit="kg" onPress={onPress} />,
    );

    // Upper-cased in the eyebrow, which is the one place `DESIGN.md` §1.2
    // allows caps — and readable with no colour vision at all.
    expect(screen.getByText('NEEDS REVIEW')).toBeTruthy();
  });

  it('does not flag a session the coach has already opened', () => {
    render(<SessionHistoryRow session={makeSession()} unit="kg" onPress={onPress} />);

    expect(screen.queryByText('NEEDS REVIEW')).toBeNull();
  });

  it('falls back to a name rather than rendering an unlabelled row', () => {
    render(<SessionHistoryRow session={makeSession({ name: null })} unit="kg" onPress={onPress} />);

    expect(screen.getByText('Workout')).toBeTruthy();
  });

  it('hands back the session id, never a closure over the row', () => {
    render(<SessionHistoryRow session={makeSession()} unit="kg" onPress={onPress} />);

    fireEvent.press(screen.getByTestId(`session-row-${SESSION_ID}`));

    expect(onPress).toHaveBeenCalledWith(SESSION_ID);
  });

  it('reports a stable, uniform height to the recycler on first layout', () => {
    // FlashList v2 has no `estimatedItemSize`; the row's own `minHeight` is
    // what replaces it (`CLAUDE.md` §25.8). Derived from the type scale, so
    // this asserts the arithmetic rather than a magic number.
    expect(SESSION_ROW_HEIGHT).toBe(97);
  });
});
