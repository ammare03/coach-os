import { fireEvent, render, screen, within } from '@testing-library/react-native';

import type { ClientStatusControls } from '../../hooks/useClientStatus.ts';
import { ClientStatusActions } from '../ClientStatusActions.tsx';

// `relationship-controls/01`'s first two acceptance criteria, at component
// level: **each action renders only when it is legal for the current
// status**, and archive and release are behind a typed confirmation while
// pause and resume are not.
//
// The legality table here is the mirror of `set-status.ts`'s
// `LEGAL_TRANSITIONS`, and the mirror is the point: a coach never taps a
// row whose refusal is already knowable, so `CLIENT_STATUS_TRANSITION_INVALID`
// is the floor under a stale screen rather than the normal path.
//
// The hook is mocked because this file is about the rows, the copy, and the
// dialogs. What the hook actually does to the cache and to the server has
// its own file (`hooks/__tests__/useClientStatus.test.tsx`) and asserting
// it twice would make both harder to read and neither more true.

const CLIENT_ID = '01924f2c-0000-7000-8000-00000000000a';
const PAUSED_AT = new Date('2026-09-11T06:30:00.000Z'); // 11 Sep, 12:00 IST
const IST = 'Asia/Kolkata';

let mockControls: ClientStatusControls;

jest.mock('../../hooks/useClientStatus.ts', () => ({
  useClientStatus: () => mockControls,
}));

beforeEach(() => {
  mockControls = {
    pause: jest.fn(),
    resume: jest.fn(),
    archive: jest.fn(),
    release: jest.fn(),
    isPending: false,
  };
});

type Props = Partial<Parameters<typeof ClientStatusActions>[0]>;

function renderActions(props: Props = {}) {
  return render(
    <ClientStatusActions
      clientId={CLIENT_ID}
      firstName="Priya"
      fullName="Priya Sharma"
      status="active"
      statusSince={null}
      timeZone={IST}
      onReleased={jest.fn()}
      {...props}
    />,
  );
}

describe('which rows render, per status', () => {
  it('offers pause, archive and release to an active client', () => {
    renderActions({ status: 'active' });

    expect(screen.getByText('Pause coaching')).toBeTruthy();
    expect(screen.getByText('Archive client')).toBeTruthy();
    expect(screen.getByText('Release client')).toBeTruthy();
    expect(screen.queryByText('Resume coaching')).toBeNull();
  });

  it('swaps pause for resume on a paused client', () => {
    renderActions({ status: 'paused' });

    expect(screen.getByText('Resume coaching')).toBeTruthy();
    expect(screen.queryByText('Pause coaching')).toBeNull();
    expect(screen.getByText('Archive client')).toBeTruthy();
    expect(screen.getByText('Release client')).toBeTruthy();
  });

  it('leaves pause ABSENT on an invited client, never disabled', () => {
    renderActions({ status: 'invited' });

    // `invited -> paused` is refused server-side: a pending invite is
    // cancelled, not paused. A greyed row would advertise an action that
    // can never succeed, which is worse than no row at all.
    expect(screen.queryByText('Pause coaching')).toBeNull();
    expect(screen.queryByText('Resume coaching')).toBeNull();
    expect(screen.getByText('Archive client')).toBeTruthy();
    expect(screen.getByText('Release client')).toBeTruthy();
  });

  it('leaves an archived client exactly one action', () => {
    renderActions({ status: 'archived', statusSince: PAUSED_AT });

    // `archived -> anything` is `CLIENT_ARCHIVED`, so every status row
    // goes. Release survives because it is `detachClient`, not a status
    // change — it stays legal, and it is the one thing still worth doing.
    expect(screen.queryByText('Pause coaching')).toBeNull();
    expect(screen.queryByText('Resume coaching')).toBeNull();
    expect(screen.queryByText('Archive client')).toBeNull();
    expect(screen.getByText('Release client')).toBeTruthy();
  });
});

describe('the consequence lines', () => {
  it('names the client and uses a neutral possessive', () => {
    renderActions({ status: 'active' });

    expect(
      screen.getByText(
        "Nothing is scheduled and no reminders go out. Priya's seat is free while they are paused.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByText('Priya keeps everything and is not notified. You keep their history.'),
    ).toBeTruthy();
    expect(
      screen.getByText(
        'Ends your coaching. Priya is emailed, and most of what you can read closes in 30 days.',
      ),
    ).toBeTruthy();
  });

  it('says "for good" when release is the last thing left', () => {
    renderActions({ status: 'archived' });

    expect(
      screen.getByText(
        'Ends your coaching for good. Priya is emailed, and most of what you can read closes in 30 days.',
      ),
    ).toBeTruthy();
  });

  it('never asks whether the coach is sure', () => {
    renderActions({ status: 'active' });

    expect(screen.queryByText(/are you sure/i)).toBeNull();
  });
});

describe('accessibility', () => {
  it('names the client in every row label and the consequence in the hint', () => {
    renderActions({ status: 'active' });

    const pause = screen.getByLabelText('Pause coaching with Priya');
    expect(pause.props.accessibilityHint).toBe(
      'Nothing is scheduled while they are paused. You will have five seconds to undo.',
    );

    const archive = screen.getByLabelText('Archive Priya');
    expect(archive.props.accessibilityHint).toBe(
      'They keep everything and are not notified. You will be asked to type ARCHIVE.',
    );

    const release = screen.getByLabelText('Release Priya');
    expect(release.props.accessibilityHint).toBe(
      'This ends your coaching and emails them. You will be asked to type RELEASE.',
    );
  });

  it('labels resume with its own five-second promise', () => {
    renderActions({ status: 'paused' });

    const resume = screen.getByLabelText('Resume coaching with Priya');
    expect(resume.props.accessibilityHint).toBe(
      'Sessions are scheduled again from today. You will have five seconds to undo.',
    );
  });
});

describe('the open pause window', () => {
  it('makes archive and release inert rather than removing them', () => {
    // A row that vanishes for five seconds is a moving target under a
    // finger, and the coach who mis-tapped Pause is the one most likely
    // reaching for the row below it.
    mockControls.isPending = true;
    renderActions({ status: 'paused' });

    for (const label of ['Archive Priya', 'Release Priya']) {
      const row = screen.getByLabelText(label);
      expect(row.props.accessibilityState).toMatchObject({ disabled: true });
      expect(row.props.accessibilityHint).toBe('Available once the pause finishes saving.');
    }
  });

  it('leaves resume pressable inside the window, because it is the undo', () => {
    mockControls.isPending = true;
    renderActions({ status: 'paused' });

    fireEvent.press(screen.getByLabelText('Resume coaching with Priya'));

    expect(mockControls.resume).toHaveBeenCalledTimes(1);
  });

  it('does not start an archive from an inert row', () => {
    mockControls.isPending = true;
    renderActions({ status: 'paused' });

    fireEvent.press(screen.getByLabelText('Archive Priya'));

    expect(screen.queryByTestId('client-archive-confirm')).toBeNull();
    expect(mockControls.archive).not.toHaveBeenCalled();
  });
});

describe('pause and resume', () => {
  it('pauses on one tap, with no dialog', () => {
    renderActions({ status: 'active' });

    fireEvent.press(screen.getByLabelText('Pause coaching with Priya'));

    expect(mockControls.pause).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/to confirm$/)).toBeNull();
  });
});

/** The dialog, scoped — "Archive client" is also the row's own label. */
function archiveDialog() {
  return within(screen.getByTestId('client-archive-confirm'));
}

function releaseDialog() {
  return within(screen.getByTestId('client-release-confirm'));
}

describe('the typed confirmations', () => {
  it('states four consequences and commits only on an exact ARCHIVE', () => {
    renderActions({ status: 'active' });

    fireEvent.press(screen.getByLabelText('Archive Priya'));
    const dialog = archiveDialog();

    expect(dialog.getByText('Archive Priya Sharma')).toBeTruthy();
    expect(
      dialog.getByText(
        'Priya keeps every workout, meal, photo and message. They are not notified. You keep their full history and can reopen it here. Their seat is released, so you can invite another client.',
      ),
    ).toBeTruthy();
    expect(dialog.getByText('Type ARCHIVE to confirm')).toBeTruthy();
    expect(dialog.getByRole('button', { name: 'Archive client' })).toBeDisabled();

    // Case-sensitive, untrimmed — the friction is the feature
    // (`ConfirmModal`'s own contract).
    fireEvent.changeText(dialog.getByPlaceholderText('ARCHIVE'), 'archive');
    expect(archiveDialog().getByRole('button', { name: 'Archive client' })).toBeDisabled();
    expect(mockControls.archive).not.toHaveBeenCalled();

    fireEvent.changeText(archiveDialog().getByPlaceholderText('ARCHIVE'), 'ARCHIVE');
    fireEvent.press(archiveDialog().getByRole('button', { name: 'Archive client' }));

    expect(mockControls.archive).toHaveBeenCalledTimes(1);
  });

  it('states what the client keeps first, and commits only on an exact RELEASE', () => {
    renderActions({ status: 'active' });

    fireEvent.press(screen.getByLabelText('Release Priya'));
    const dialog = releaseDialog();

    expect(dialog.getByText('Release Priya Sharma')).toBeTruthy();
    expect(
      dialog.getByText(
        'Priya keeps everything. We email them to say you have stopped working together. Their meals, measurements and photos close to you today. Their sessions, check-ins, videos, comments and messages stay readable for 30 days, then close too.',
      ),
    ).toBeTruthy();

    fireEvent.changeText(dialog.getByPlaceholderText('RELEASE'), 'RELEASE');
    fireEvent.press(releaseDialog().getByRole('button', { name: 'Release client' }));

    expect(mockControls.release).toHaveBeenCalledTimes(1);
  });

  it('lets a coach back out', () => {
    renderActions({ status: 'active' });

    fireEvent.press(screen.getByLabelText('Archive Priya'));
    fireEvent.press(archiveDialog().getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByTestId('client-archive-confirm')).toBeNull();
    expect(mockControls.archive).not.toHaveBeenCalled();
  });
});

describe('the statement well', () => {
  it('states when a paused client was paused, and what that means', () => {
    renderActions({ status: 'paused', statusSince: PAUSED_AT });

    expect(screen.getByText('Paused since Friday 11 September')).toBeTruthy();
    expect(
      screen.getByText(
        "Nothing is scheduled and no reminders go out. Priya's seat is free. They can still open the app and log against their last program.",
      ),
    ).toBeTruthy();
  });

  it('states an archived client keeps everything, and how to work together again', () => {
    renderActions({ status: 'archived', statusSince: PAUSED_AT });

    expect(screen.getByText('Archived on 11 September')).toBeTruthy();
    expect(
      screen.getByText(
        "Priya's history stays here and they keep their own. They were not notified. To work together again, send a new invite.",
      ),
    ).toBeTruthy();
  });

  it('carries no control — it is a statement, in the InjuriesBanner register', () => {
    renderActions({ status: 'paused', statusSince: PAUSED_AT });
    const well = within(screen.getByTestId('client-status-well-paused'));

    // One accessible item, and nothing pressable inside it. A control here
    // would be a second, competing place to act, one scroll above the
    // section that already is one.
    expect(well.queryByRole('button')).toBeNull();
    expect(well.getByLabelText(/^Paused since Friday 11 September\./)).toBeTruthy();
  });

  it('says nothing at all for an active client', () => {
    renderActions({ status: 'active' });

    expect(screen.queryByText(/^Paused since/)).toBeNull();
    expect(screen.queryByText(/^Archived on/)).toBeNull();
  });

  it('does not appear under the finger when a coach pauses mid-screen', () => {
    // The layout is decided at mount and never re-decided. A well
    // appearing above an open undo window would move Archive to where
    // Pause was, mid-gesture.
    const view = renderActions({ status: 'active' });
    view.rerender(
      <ClientStatusActions
        clientId={CLIENT_ID}
        firstName="Priya"
        fullName="Priya Sharma"
        status="paused"
        statusSince={PAUSED_AT}
        timeZone={IST}
        onReleased={jest.fn()}
      />,
    );

    expect(screen.queryByText(/^Paused since/)).toBeNull();
    // The ROWS still follow the live status — only the layout is frozen.
    expect(screen.getByText('Resume coaching')).toBeTruthy();
  });
});

describe('the section', () => {
  it('is labelled RELATIONSHIP', () => {
    renderActions({ status: 'active' });

    expect(screen.getByText('RELATIONSHIP')).toBeTruthy();
  });

  it('offers no chevron — nothing here opens a screen', () => {
    renderActions({ status: 'active' });

    expect(screen.queryByTestId('client-status-chevron')).toBeNull();
  });
});
