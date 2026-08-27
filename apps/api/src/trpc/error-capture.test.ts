import { reportUncaughtError } from './error-capture.ts';

function captureOneEntry(run: () => void): Record<string, unknown> {
  const written: string[] = [];
  const spy = jest.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    written.push(String(chunk));
    return true;
  });
  try {
    run();
  } finally {
    spy.mockRestore();
  }
  const [line] = written;
  if (line === undefined) {
    throw new Error('expected exactly one log line to be written');
  }
  return JSON.parse(line) as Record<string, unknown>;
}

describe('reportUncaughtError', () => {
  it('logs a fixed message carrying requestId, procedure, and userId', () => {
    const entry = captureOneEntry(() => {
      reportUncaughtError(new Error('relation "users" does not exist'), {
        requestId: 'req-1',
        procedure: 'workouts.logSet',
        userId: 'user-1',
      });
    });

    expect(entry).toMatchObject({
      level: 'error',
      msg: 'request.uncaught_error',
      requestId: 'req-1',
      procedure: 'workouts.logSet',
      userId: 'user-1',
    });
    // The error's own message never reaches the structured log line — that
    // detail is Sentry's job, not the allowlisted log stream's.
    expect(JSON.stringify(entry)).not.toContain('relation "users"');
  });

  it('omits requestId, procedure, and userId from the log line when none is known', () => {
    const entry = captureOneEntry(() => {
      reportUncaughtError(new Error('boom'), {
        requestId: null,
        procedure: undefined,
        userId: null,
      });
    });

    expect(entry).not.toHaveProperty('requestId');
    expect(entry).not.toHaveProperty('procedure');
    expect(entry).not.toHaveProperty('userId');
  });

  it('never throws, even with no Sentry DSN configured', () => {
    expect(() => {
      reportUncaughtError(new Error('boom'), {
        requestId: 'req-2',
        procedure: undefined,
        userId: null,
      });
    }).not.toThrow();
  });
});
