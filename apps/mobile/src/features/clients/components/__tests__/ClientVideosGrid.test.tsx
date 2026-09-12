import { render, screen } from '@testing-library/react-native';

import type { ClientFormCheck } from '../../ClientVideosContract.ts';
import { ClientVideosGrid } from '../ClientVideosGrid.tsx';
import { describeFormCheck, describeMeta, formatDuration } from '../ClientVideosTile.tsx';

// The grid renders no data in P10 — the screen passes it an empty array,
// because no procedure fills it until `phase-11-media-pipeline`. What is
// exercised here is the shell P11 inherits, with synthetic rows supplied by
// the test rather than by the app: the order is the server's and is never
// re-derived here, and a tile reads as one sentence rather than five
// fragments.

// A fixed `now`, so "2 days ago" is a fact about the fixture and not about
// the day the suite runs (`testing` §3).
const NOW = new Date('2026-09-12T09:00:00.000Z');

function formCheck(overrides: Partial<ClientFormCheck> = {}): ClientFormCheck {
  return {
    mediaAssetId: '01924f2c-0000-7000-8000-00000000000a',
    thumbnailKey: null,
    processingStatus: 'ready',
    durationSeconds: 22,
    capturedAt: new Date('2026-09-10T09:00:00.000Z'),
    isReviewed: false,
    commentCount: 0,
    exerciseName: 'Back squat',
    setNumber: 3,
    ...overrides,
  };
}

describe('ClientVideosGrid', () => {
  it('renders the empty state instead of a list when there are no videos', () => {
    render(<ClientVideosGrid videos={[]} />);

    expect(screen.getByTestId('client-videos-empty')).toBeTruthy();
    expect(screen.queryByTestId('client-videos-grid')).toBeNull();
  });

  it('renders the array in the order it was given and never re-sorts it', () => {
    // The server sorts unreviewed-first, then newest-first
    // (`ClientVideosContract.ts`). This fixture is deliberately in an order no
    // client-side sort would produce — a REVIEWED row ahead of an unreviewed
    // one, oldest first — so a second ordering in JS would fail here.
    const oldestReviewed = formCheck({
      mediaAssetId: 'a',
      isReviewed: true,
      commentCount: 2,
      capturedAt: new Date('2026-01-01T09:00:00.000Z'),
      exerciseName: 'Bench press',
      setNumber: 2,
    });
    const newestUnreviewed = formCheck({
      mediaAssetId: 'b',
      isReviewed: false,
      capturedAt: new Date('2026-09-11T09:00:00.000Z'),
    });

    render(<ClientVideosGrid videos={[oldestReviewed, newestUnreviewed]} now={NOW} />);

    const rendered = screen.getAllByTestId(/^client-video-/).map((node) => node.props.testID);
    expect(rendered).toEqual(['client-video-a', 'client-video-b']);
  });

  it('reads a tile as one sentence, with reviewed state in words', () => {
    render(<ClientVideosGrid videos={[formCheck()]} now={NOW} />);

    expect(
      screen.getByLabelText('Back squat · set 3. 22 seconds. 2 days ago · not reviewed'),
    ).toBeTruthy();
  });
});

describe('describeMeta', () => {
  it('names the coach queue plainly and never the client', () => {
    expect(describeMeta(formCheck(), NOW)).toBe('2 days ago · not reviewed');
  });

  it('counts comments once reviewed, singular and plural', () => {
    expect(describeMeta(formCheck({ isReviewed: true, commentCount: 1 }), NOW)).toBe(
      '2 days ago · reviewed, 1 comment',
    );
    expect(describeMeta(formCheck({ isReviewed: true, commentCount: 2 }), NOW)).toBe(
      '2 days ago · reviewed, 2 comments',
    );
  });

  it('says only "reviewed" when the coach left no comment', () => {
    expect(describeMeta(formCheck({ isReviewed: true, commentCount: 0 }), NOW)).toBe(
      '2 days ago · reviewed',
    );
  });
});

describe('describeFormCheck', () => {
  it('reads the duration as words — VoiceOver announces "0:22" as a time of day', () => {
    expect(describeFormCheck(formCheck(), NOW)).toContain('22 seconds');
    expect(describeFormCheck(formCheck(), NOW)).not.toContain('0:22');
  });

  it('drops the duration entirely while it is still unknown', () => {
    expect(describeFormCheck(formCheck({ durationSeconds: null }), NOW)).toBe(
      'Back squat · set 3. 2 days ago · not reviewed',
    );
  });

  it('falls back to "Form check" for a video tied to no exercise', () => {
    expect(describeFormCheck(formCheck({ exerciseName: null, setNumber: null }), NOW)).toContain(
      'Form check',
    );
  });
});

describe('formatDuration', () => {
  it('pads the seconds', () => {
    expect(formatDuration(22)).toBe('0:22');
    expect(formatDuration(9)).toBe('0:09');
    expect(formatDuration(61)).toBe('1:01');
  });

  it('floors rather than rounds, so 22.9s never reads as 23 beside a 23s clip', () => {
    expect(formatDuration(22.9)).toBe('0:22');
  });

  it('never renders a negative timecode', () => {
    expect(formatDuration(-1)).toBe('0:00');
  });
});
