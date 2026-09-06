// The wire contract with `invites.confirmGuardianConsent`. `apps/web`
// deliberately does not import `@trpc/client` or `superjson`
// (CLAUDE.md §3.4.1 step 2), so the envelope shapes are transcribed by
// hand — these assertions are what catch the transformer or the endpoint
// changing under us.

import { confirmGuardianConsent } from './confirm';

const API_URL = 'https://api.example.test';
const EXPECTED_URL = `${API_URL}/trpc/invites.confirmGuardianConsent`;

const fetchMock = jest.fn();

function respondWith(body: unknown): void {
  fetchMock.mockResolvedValue({ json: async () => body } as unknown as Response);
}

beforeEach(() => {
  process.env.WEB_API_URL = API_URL;
  global.fetch = fetchMock as unknown as typeof fetch;
});

describe('confirmGuardianConsent', () => {
  it('POSTs the superjson-shaped input to the fixed /trpc mount path', async () => {
    respondWith({ result: { data: { json: { outcome: 'invalid' } } } });

    await confirmGuardianConsent('tok_abc');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(EXPECTED_URL);
    expect(init.method).toBe('POST');
    expect(init.cache).toBe('no-store');
    expect(JSON.parse(String(init.body))).toEqual({ json: { token: 'tok_abc' } });
  });

  it('trims a trailing slash off the configured origin', async () => {
    process.env.WEB_API_URL = `${API_URL}/`;
    respondWith({ result: { data: { json: { outcome: 'invalid' } } } });

    await confirmGuardianConsent('tok_abc');

    expect(fetchMock.mock.calls[0]?.[0]).toBe(EXPECTED_URL);
  });

  it('reads the confirmed outcome and its clientName', async () => {
    respondWith({ result: { data: { json: { outcome: 'confirmed', clientName: 'Riya' } } } });

    await expect(confirmGuardianConsent('tok')).resolves.toEqual({
      outcome: 'confirmed',
      clientName: 'Riya',
    });
  });

  it.each(['already_confirmed', 'invalid'] as const)('reads the %s outcome', async (outcome) => {
    respondWith({ result: { data: { json: { outcome } } } });

    await expect(confirmGuardianConsent('tok')).resolves.toEqual({ outcome });
  });

  // A `confirmed` with no name would otherwise render "Thank you — 's
  // account is ready".
  it('does not report confirmed when clientName is missing', async () => {
    respondWith({ result: { data: { json: { outcome: 'confirmed' } } } });

    await expect(confirmGuardianConsent('tok')).resolves.toEqual({ outcome: 'unavailable' });
  });

  // The one distinction that matters most: a failure on our side must never
  // tell a parent holding a live link that it has expired.
  it.each([
    ['a tRPC error envelope', { error: { json: { message: 'Too many requests.' } } }],
    ['an unrecognised outcome', { result: { data: { json: { outcome: 'nope' } } } }],
    ['an empty body', {}],
    ['a non-object body', 'nope'],
  ])('reports unavailable, never invalid, for %s', async (_label, body) => {
    respondWith(body);

    await expect(confirmGuardianConsent('tok')).resolves.toEqual({ outcome: 'unavailable' });
  });

  it('reports unavailable when the request throws', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(confirmGuardianConsent('tok')).resolves.toEqual({ outcome: 'unavailable' });
  });

  it('reports unavailable when the response is not JSON', async () => {
    fetchMock.mockResolvedValue({
      json: async () => {
        throw new Error('Unexpected token <');
      },
    } as unknown as Response);

    await expect(confirmGuardianConsent('tok')).resolves.toEqual({ outcome: 'unavailable' });
  });

  it('fails loudly, and without calling fetch, when WEB_API_URL is unset', async () => {
    delete process.env.WEB_API_URL;

    await expect(confirmGuardianConsent('tok')).rejects.toThrow('WEB_API_URL');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
