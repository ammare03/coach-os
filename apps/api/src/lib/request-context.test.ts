import { getRequestId, runWithRequestId } from './request-context.ts';

describe('request-context', () => {
  it('returns undefined outside any bound request', () => {
    expect(getRequestId()).toBeUndefined();
  });

  it('exposes the bound id to a synchronous callback', () => {
    const seen = runWithRequestId('req-sync', () => getRequestId());
    expect(seen).toBe('req-sync');
  });

  it('keeps the bound id alive across awaits inside the callback', async () => {
    const seen = await runWithRequestId('req-async', async () => {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
      return getRequestId();
    });
    expect(seen).toBe('req-async');
  });

  it('never leaks one request’s id into a sibling call outside its run()', () => {
    runWithRequestId('req-a', () => {
      expect(getRequestId()).toBe('req-a');
    });
    expect(getRequestId()).toBeUndefined();
  });

  it('isolates concurrent requests from each other', async () => {
    const [a, b] = await Promise.all([
      runWithRequestId('req-x', async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return getRequestId();
      }),
      runWithRequestId('req-y', async () => {
        await new Promise((resolve) => setTimeout(resolve, 1));
        return getRequestId();
      }),
    ]);
    expect(a).toBe('req-x');
    expect(b).toBe('req-y');
  });
});
