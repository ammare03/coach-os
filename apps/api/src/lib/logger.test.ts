import { logger, type LogFields } from './logger.ts';

// DB§18's sensitive field names — the exact ones the redaction is proving
// never reach a log line, not just the ones `LogFields` happens to declare.
const SENSITIVE_KEYS = ['email', 'name', 'injuries', 'foodName', 'mediaUrl', 'message'];

function captureStdout(run: () => void): string[] {
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
  return written;
}

// `noUncheckedIndexedAccess` makes `written[0]` a `string | undefined` —
// this is the one narrowing guard, so no call site below needs its own `!`.
function captureOneEntry(run: () => void): Record<string, unknown> {
  const [line] = captureStdout(run);
  if (line === undefined) {
    throw new Error('expected exactly one log line to be written');
  }
  return JSON.parse(line) as Record<string, unknown>;
}

describe('logger', () => {
  it('emits one JSON line per call, carrying ts, level, and the fixed msg', () => {
    const entry = captureOneEntry(() => {
      logger.info('request.completed', { requestId: 'req-1', durationMs: 12 });
    });

    expect(entry).toMatchObject({
      level: 'info',
      msg: 'request.completed',
      requestId: 'req-1',
      durationMs: 12,
    });
    expect(typeof entry.ts).toBe('string');
  });

  it('never includes a DB§18-classified field, even when adversarially passed', () => {
    // Cast past the closed `LogFields` type — proving the *runtime* copy is
    // an allowlist, not just the compile-time one a caller could route
    // around with an `as` the way an evolving call site eventually will.
    const malicious = {
      requestId: 'req-2',
      email: 'client@example.com',
      name: 'Jordan Client',
      injuries: 'lower back',
      foodName: 'chicken breast',
      mediaUrl: 'https://r2.example/signed-video',
      message: 'told the coach about a knee issue',
    } as unknown as LogFields;

    const entry = captureOneEntry(() => {
      logger.info('adversarial.test', malicious);
    });

    for (const key of SENSITIVE_KEYS) {
      expect(entry).not.toHaveProperty(key);
    }
    expect(JSON.stringify(entry)).not.toContain('client@example.com');
    expect(entry.requestId).toBe('req-2');
  });

  it('carries requestId unchanged, so a line is joinable back to its request', () => {
    const entry = captureOneEntry(() => {
      logger.warn('rate_limit.rejected', { requestId: 'req-3', procedure: 'comments.create' });
    });

    expect(entry.requestId).toBe('req-3');
  });

  it('carries userId only as an opaque id, never alongside name or email', () => {
    const entry = captureOneEntry(() => {
      logger.info('request.completed', { userId: 'user-123', requestId: 'req-4' });
    });

    expect(entry.userId).toBe('user-123');
    expect(entry).not.toHaveProperty('email');
    expect(entry).not.toHaveProperty('name');
  });

  it('omits a field entirely when the caller does not pass it, rather than writing null or undefined', () => {
    const entry = captureOneEntry(() => {
      logger.info('request.completed', { requestId: 'req-5' });
    });

    expect(entry).not.toHaveProperty('errorCode');
    expect(entry).not.toHaveProperty('durationMs');
  });

  it('suppresses debug output when env.NODE_ENV is production', async () => {
    // `env` is parsed once and frozen at import (`../env.ts`) — mutating
    // `process.env` after the fact wouldn't move it, so the production
    // branch is exercised by isolating a fresh module graph with a mocked
    // `env` instead.
    await jest.isolateModulesAsync(async () => {
      jest.doMock('../env.ts', () => ({ env: { NODE_ENV: 'production' } }));
      const { logger: prodLogger } = await import('./logger.ts');

      const written = captureStdout(() => {
        prodLogger.debug('should.not.appear', { requestId: 'req-6' });
      });

      expect(written).toHaveLength(0);
    });
  });

  it('emits debug output outside production', () => {
    const written = captureStdout(() => {
      logger.debug('visible.in.test', { requestId: 'req-7' });
    });
    expect(written).toHaveLength(1);
  });
});
