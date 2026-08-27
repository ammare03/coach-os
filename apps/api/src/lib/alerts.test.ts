describe('dispatchAlert', () => {
  it('always writes the structured log line, even with no destination configured', async () => {
    await jest.isolateModulesAsync(async () => {
      jest.doMock('../env.ts', () => ({
        env: {
          RESEND_API_KEY: 'test-key',
          ALERTS_EMAIL_TO: undefined,
          ALERTS_EXPO_PUSH_TOKEN: undefined,
        },
      }));
      const { dispatchAlert } = await import('./alerts.ts');

      const written: string[] = [];
      const spy = jest.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
        written.push(String(chunk));
        return true;
      });

      await dispatchAlert({ alertId: 'P1', summary: '2 duplicate sessions detected.' });
      spy.mockRestore();

      const fired = written.map((l) => JSON.parse(l) as Record<string, unknown>);
      expect(fired).toContainEqual(
        expect.objectContaining({ msg: 'alert.fired', errorCode: 'P1' }),
      );
    });
  });

  it('never sends email or push when neither destination is configured', async () => {
    await jest.isolateModulesAsync(async () => {
      jest.doMock('../env.ts', () => ({
        env: {
          RESEND_API_KEY: 'test-key',
          ALERTS_EMAIL_TO: undefined,
          ALERTS_EXPO_PUSH_TOKEN: undefined,
        },
      }));
      const fetchSpy = jest
        .spyOn(global, 'fetch')
        .mockResolvedValue(new Response(null, { status: 200 }));
      const { dispatchAlert } = await import('./alerts.ts');

      await dispatchAlert({ alertId: 'P3', summary: 'The database is unreachable.' });

      expect(fetchSpy).not.toHaveBeenCalled();
      fetchSpy.mockRestore();
    });
  });

  it('POSTs to Resend when an email destination is configured', async () => {
    await jest.isolateModulesAsync(async () => {
      jest.doMock('../env.ts', () => ({
        env: {
          RESEND_API_KEY: 'test-key',
          ALERTS_EMAIL_TO: 'ammar@example.com',
          ALERTS_EXPO_PUSH_TOKEN: undefined,
        },
      }));
      const fetchSpy = jest
        .spyOn(global, 'fetch')
        .mockResolvedValue(new Response(null, { status: 200 }));
      const { dispatchAlert } = await import('./alerts.ts');

      await dispatchAlert({ alertId: 'P2', summary: 'Error rate is 50%.' });

      expect(fetchSpy).toHaveBeenCalledWith(
        'https://api.resend.com/emails',
        expect.objectContaining({ method: 'POST' }),
      );
      fetchSpy.mockRestore();
    });
  });

  it('POSTs to Expo push when a push token is configured', async () => {
    await jest.isolateModulesAsync(async () => {
      jest.doMock('../env.ts', () => ({
        env: {
          RESEND_API_KEY: 'test-key',
          ALERTS_EMAIL_TO: undefined,
          ALERTS_EXPO_PUSH_TOKEN: 'ExponentPushToken[xyz]',
        },
      }));
      const fetchSpy = jest
        .spyOn(global, 'fetch')
        .mockResolvedValue(new Response(null, { status: 200 }));
      const { dispatchAlert } = await import('./alerts.ts');

      await dispatchAlert({ alertId: 'P1', summary: '1 duplicate session detected.' });

      expect(fetchSpy).toHaveBeenCalledWith(
        'https://exp.host/--/api/v2/push/send',
        expect.objectContaining({ method: 'POST' }),
      );
      fetchSpy.mockRestore();
    });
  });

  it('a failed email delivery does not prevent the push attempt, or throw', async () => {
    await jest.isolateModulesAsync(async () => {
      jest.doMock('../env.ts', () => ({
        env: {
          RESEND_API_KEY: 'test-key',
          ALERTS_EMAIL_TO: 'ammar@example.com',
          ALERTS_EXPO_PUSH_TOKEN: 'ExponentPushToken[xyz]',
        },
      }));
      const fetchSpy = jest
        .spyOn(global, 'fetch')
        .mockImplementation(async (url) =>
          String(url).includes('resend')
            ? new Response(null, { status: 500 })
            : new Response(null, { status: 200 }),
        );
      const { dispatchAlert } = await import('./alerts.ts');

      await expect(
        dispatchAlert({ alertId: 'P3', summary: 'The database is unreachable.' }),
      ).resolves.toBeUndefined();

      expect(fetchSpy).toHaveBeenCalledTimes(2);
      fetchSpy.mockRestore();
    });
  });

  it('never includes a name, content, or health value — the summary is the entire payload', async () => {
    await jest.isolateModulesAsync(async () => {
      jest.doMock('../env.ts', () => ({
        env: {
          RESEND_API_KEY: 'test-key',
          ALERTS_EMAIL_TO: 'ammar@example.com',
          ALERTS_EXPO_PUSH_TOKEN: undefined,
        },
      }));
      const fetchSpy = jest
        .spyOn(global, 'fetch')
        .mockResolvedValue(new Response(null, { status: 200 }));
      const { dispatchAlert } = await import('./alerts.ts');

      await dispatchAlert({ alertId: 'P1', summary: '3 duplicate sessions detected.' });

      const [, init] = fetchSpy.mock.calls[0] ?? [];
      const body = JSON.parse(String((init as RequestInit)?.body)) as Record<string, unknown>;
      expect(Object.keys(body).sort()).toEqual(['from', 'subject', 'text', 'to']);
      fetchSpy.mockRestore();
    });
  });
});
