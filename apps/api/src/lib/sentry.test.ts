import type * as Sentry from '@sentry/node';

import { captureServerException, initSentry, scrubEvent } from './sentry.ts';

describe('scrubEvent', () => {
  const baseEvent = { type: undefined } as unknown as Sentry.ErrorEvent;

  it('keeps the safe fields: event_id, timestamp, level, message, exception, environment', () => {
    const event = {
      ...baseEvent,
      event_id: 'evt-1',
      timestamp: 1234,
      level: 'error',
      message: 'boom',
      exception: { values: [{ type: 'Error', value: 'boom' }] },
      environment: 'production',
    } as unknown as Sentry.ErrorEvent;

    const scrubbed = scrubEvent(event);

    expect(scrubbed).toMatchObject({
      event_id: 'evt-1',
      timestamp: 1234,
      level: 'error',
      message: 'boom',
      environment: 'production',
    });
  });

  it('carries only requestId and procedure through from tags, never anything else placed there', () => {
    const event = {
      ...baseEvent,
      tags: { requestId: 'req-1', procedure: 'workouts.logSet', clientEmail: 'a@b.com' },
    } as unknown as Sentry.ErrorEvent;

    const scrubbed = scrubEvent(event);

    expect(scrubbed.tags).toEqual({ requestId: 'req-1', procedure: 'workouts.logSet' });
  });

  it('carries the user id only, never the rest of a User object', () => {
    const event = {
      ...baseEvent,
      user: { id: 'user-1', email: 'client@example.com', username: 'Jordan Client' },
    } as unknown as Sentry.ErrorEvent;

    const scrubbed = scrubEvent(event);

    expect(scrubbed.user).toEqual({ id: 'user-1' });
    expect(JSON.stringify(scrubbed)).not.toContain('client@example.com');
    expect(JSON.stringify(scrubbed)).not.toContain('Jordan Client');
  });

  it('never carries request or breadcrumbs through, even adversarially', () => {
    const event = {
      ...baseEvent,
      request: { headers: { authorization: 'Bearer secret-token' }, cookies: { session: 'x' } },
      breadcrumbs: [{ message: 'logged in as client@example.com' }],
      extra: { injuries: 'lower back' },
      contexts: { app: { app_name: 'coachos-api' } },
    } as unknown as Sentry.ErrorEvent;

    const scrubbed = scrubEvent(event);

    expect(scrubbed).not.toHaveProperty('request');
    expect(scrubbed).not.toHaveProperty('breadcrumbs');
    expect(scrubbed).not.toHaveProperty('extra');
    expect(scrubbed).not.toHaveProperty('contexts');
    expect(JSON.stringify(scrubbed)).not.toContain('secret-token');
  });

  it('omits user entirely when the event carries none, rather than an empty object', () => {
    const scrubbed = scrubEvent(baseEvent);
    expect(scrubbed).not.toHaveProperty('user');
  });
});

describe('captureServerException', () => {
  it('does not throw when Sentry has no DSN configured (the default in every test run)', () => {
    expect(() => {
      captureServerException(new Error('scratch'), { requestId: 'req-1', userId: 'user-1' });
    }).not.toThrow();
  });
});

describe('initSentry', () => {
  it('does not throw with no SENTRY_DSN set', () => {
    expect(() => initSentry()).not.toThrow();
  });
});
