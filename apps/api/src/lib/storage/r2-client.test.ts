// The delete half of the R2 client, unit-tested against a stubbed S3
// `send` rather than a live bucket — there is no R2 to talk to in CI, and
// what matters here is not that Cloudflare acknowledges a request but that
// this module asks for *every* object and refuses to report success when
// the store says a key survived. DB§19.2's purge guarantee ("the archive
// is a copy of data being purged; it must not outlive it") is only worth
// as much as those two properties, so they get tests of their own.
const mockSend = jest.fn();

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: class {
    send(command: unknown): Promise<unknown> {
      return mockSend(command) as Promise<unknown>;
    }
  },
  ListObjectsV2Command: class {
    readonly kind = 'list';
    constructor(readonly input: Record<string, unknown>) {}
  },
  DeleteObjectsCommand: class {
    readonly kind = 'delete';
    constructor(readonly input: Record<string, unknown>) {}
  },
  GetObjectCommand: class {
    readonly kind = 'get';
    constructor(readonly input: Record<string, unknown>) {}
  },
}));

import { deleteR2Objects, deleteR2ObjectsByPrefix } from './r2-client.ts';

type StubCommand = { kind: string; input: Record<string, unknown> };

function commandsOfKind(kind: string): Record<string, unknown>[] {
  return mockSend.mock.calls
    .map((call) => call[0] as StubCommand)
    .filter((command) => command.kind === kind)
    .map((command) => command.input);
}

// `noUncheckedIndexedAccess` is on — an assertion here would hide a wrong
// call count behind a confusing "cannot read property of undefined".
function at<T>(items: T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new Error(`expected a command at index ${index}`);
  return item;
}

function keysOf(input: Record<string, unknown>): string[] {
  const deleteSpec = input.Delete as { Objects: { Key: string }[] };
  return deleteSpec.Objects.map((object) => object.Key);
}

function page(keys: string[], nextToken?: string) {
  return {
    Contents: keys.map((Key) => ({ Key })),
    IsTruncated: nextToken !== undefined,
    NextContinuationToken: nextToken,
  };
}

function manyKeys(prefix: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) => `${prefix}${index}.zip`);
}

beforeEach(() => {
  mockSend.mockReset();
});

describe('deleteR2Objects', () => {
  it('sends nothing at all for an empty key list', async () => {
    await deleteR2Objects([]);

    expect(mockSend).not.toHaveBeenCalled();
  });

  it('splits a delete into batches of at most 1000 keys', async () => {
    mockSend.mockResolvedValue({});

    await deleteR2Objects(manyKeys('media/a/', 1001));

    const batches = commandsOfKind('delete');
    expect(batches).toHaveLength(2);
    expect(keysOf(at(batches, 0))).toHaveLength(1000);
    expect(keysOf(at(batches, 1))).toHaveLength(1);
  });

  it('throws when the store reports a per-key failure, rather than reporting success', async () => {
    mockSend.mockResolvedValue({
      Errors: [{ Key: 'exports/u/secret.zip', Code: 'AccessDenied', Message: 'no' }],
    });

    await expect(deleteR2Objects(['exports/u/secret.zip'])).rejects.toThrow(/AccessDenied/);
  });

  it('never names the surviving key in the error it throws', async () => {
    mockSend.mockResolvedValue({
      Errors: [{ Key: 'exports/u/secret.zip', Code: 'InternalError' }],
    });

    // DB§18 — an R2 key is never in a log or an error message. The count
    // and the store's own error code are what an operator needs.
    const error: unknown = await deleteR2Objects(['exports/u/secret.zip']).then(
      () => undefined,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain('secret.zip');
    expect((error as Error).message).toContain('1');
  });
});

describe('deleteR2ObjectsByPrefix', () => {
  it('deletes every page, not just the first, when the listing is truncated', async () => {
    const firstPage = manyKeys('exports/u/first-', 1000);
    const secondPage = manyKeys('exports/u/second-', 3);
    mockSend
      .mockResolvedValueOnce(page(firstPage, 'token-1'))
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce(page(secondPage))
      .mockResolvedValueOnce({});

    const deleted = await deleteR2ObjectsByPrefix('exports/u/');

    expect(deleted).toBe(1003);
    const listings = commandsOfKind('list');
    expect(listings).toHaveLength(2);
    expect(at(listings, 0).ContinuationToken).toBeUndefined();
    expect(at(listings, 1).ContinuationToken).toBe('token-1');
    expect(commandsOfKind('delete').flatMap(keysOf)).toEqual([...firstPage, ...secondPage]);
  });

  it('lists only under the prefix it was given', async () => {
    mockSend.mockResolvedValueOnce(page([]));

    await deleteR2ObjectsByPrefix('exports/user-a/');

    expect(at(commandsOfKind('list'), 0).Prefix).toBe('exports/user-a/');
  });

  it('issues no delete when the prefix holds nothing', async () => {
    mockSend.mockResolvedValueOnce(page([]));

    const deleted = await deleteR2ObjectsByPrefix('exports/user-a/');

    expect(deleted).toBe(0);
    expect(commandsOfKind('delete')).toHaveLength(0);
  });

  it('propagates a per-key failure instead of returning a count that overstates the deletion', async () => {
    mockSend
      .mockResolvedValueOnce(page(['exports/u/a.zip']))
      .mockResolvedValueOnce({ Errors: [{ Key: 'exports/u/a.zip', Code: 'InternalError' }] });

    await expect(deleteR2ObjectsByPrefix('exports/u/')).rejects.toThrow(/InternalError/);
  });

  it.each(['', 'exports', 'exports/user-a'])(
    'refuses the prefix %p rather than risk deleting outside one user folder',
    async (prefix) => {
      await expect(deleteR2ObjectsByPrefix(prefix)).rejects.toThrow(/prefix/i);
      expect(mockSend).not.toHaveBeenCalled();
    },
  );
});
