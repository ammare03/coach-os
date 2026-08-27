import { resolveRequestId } from './request-id.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('resolveRequestId', () => {
  it('adopts a well-formed inbound id unchanged', () => {
    const inbound = '018f4b8e-6b3a-7c3e-9c2a-1234567890ab';
    expect(resolveRequestId(inbound)).toBe(inbound);
  });

  it('generates one when the header is missing', () => {
    expect(resolveRequestId(null)).toMatch(UUID_RE);
    expect(resolveRequestId(undefined)).toMatch(UUID_RE);
  });

  it('generates one when the header is malformed, rather than rejecting the request', () => {
    expect(resolveRequestId('not-a-uuid')).toMatch(UUID_RE);
    expect(resolveRequestId('')).toMatch(UUID_RE);
    // Header-injection attempt — proves the value is validated, not just
    // passed through because it was non-empty.
    expect(resolveRequestId('018f4b8e-6b3a-7c3e-9c2a-1234567890ab\r\nX-Evil: 1')).toMatch(UUID_RE);
  });

  it('generates a fresh id on every fallback call, never a fixed placeholder', () => {
    expect(resolveRequestId(null)).not.toBe(resolveRequestId(null));
  });
});
