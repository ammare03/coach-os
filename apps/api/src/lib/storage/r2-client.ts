// The one client that talks to Cloudflare R2 (CLAUDE.md §3.2 — S3-compatible,
// zero egress fees). `account-lifecycle/04` is this client's first caller;
// `account-lifecycle/09` adds the upload/presign side (`phase-11-media-
// pipeline` is expected to reuse both once it lands), both through this
// same module, never a second `S3Client` instantiated elsewhere.
import fs from 'node:fs';
import type { Readable } from 'node:stream';

import { DeleteObjectsCommand, GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import { env } from '../../env.ts';

// R2's own documented endpoint shape and region value — `forcePathStyle`
// is not needed for R2 (unlike some other S3-compatible stores), and
// `region: 'auto'` is what Cloudflare's own docs specify; the SDK requires
// *some* value even though R2 doesn't use it.
const client = new S3Client({
  region: 'auto',
  endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  },
});

// S3's DeleteObjects API caps a single request at 1000 keys.
const MAX_KEYS_PER_BATCH = 1000;

function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
}

/**
 * Deletes every key given, batched at the API's 1000-key cap. Deleting a
 * key that's already gone is not an error (S3-compatible semantics) —
 * exactly the idempotency `account-lifecycle/04`'s purge job needs: a
 * retried purge must not fail because a previous attempt already removed
 * the objects.
 */
export async function deleteR2Objects(keys: string[]): Promise<void> {
  if (keys.length === 0) return;

  for (const batch of chunk(keys, MAX_KEYS_PER_BATCH)) {
    await client.send(
      new DeleteObjectsCommand({
        Bucket: env.R2_BUCKET_NAME,
        Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
      }),
    );
  }
}

/**
 * Uploads a local file to R2 by streaming it from disk (`fs.createReadStream`),
 * never reading it into memory whole — `@aws-sdk/lib-storage`'s `Upload`
 * handles the multipart split itself. This is the second half of
 * `account-lifecycle/09`'s "stream, do not buffer" requirement: the archive
 * is built to a temp file first (`../../jobs/data-export.ts`), then handed
 * to this function, so peak memory is bounded by one part size
 * (`queueSize`/`partSize` below), never by the archive's total size.
 */
export async function uploadFileToR2(
  filePath: string,
  key: string,
  contentType: string,
): Promise<void> {
  const upload = new Upload({
    client,
    params: {
      Bucket: env.R2_BUCKET_NAME,
      Key: key,
      Body: fs.createReadStream(filePath),
      ContentType: contentType,
    },
    // 10MB parts, 4 in flight — comfortably inside a small-container memory
    // budget (CLAUDE.md §19) regardless of the archive's total size.
    partSize: 10 * 1024 * 1024,
    queueSize: 4,
  });
  await upload.done();
}

/**
 * A signed GET URL, capped at security-and-privacy's own ≤1h ceiling —
 * this is deliberately shorter than an export archive's 7-day life
 * (`account-lifecycle/09`'s Approach step 4). The email this task sends
 * never embeds this URL directly for that reason: a link that outlives its
 * signature by six days would just be broken, and a link valid for six
 * days would violate the ceiling. Callers that need a durable pointer (the
 * archive's own `README.txt`/`MANIFEST.json` action, or a later click)
 * mint a fresh one at the moment it's used, never reuse an old one past
 * `expiresInSeconds`.
 */
export async function getSignedDownloadUrl(key: string, expiresInSeconds: number): Promise<string> {
  return getSignedUrl(client, new GetObjectCommand({ Bucket: env.R2_BUCKET_NAME, Key: key }), {
    expiresIn: expiresInSeconds,
  });
}

/**
 * A readable stream of one object's bytes — `account-lifecycle/09`'s photo
 * inclusion (Approach step 4: "bytes for photos"), piped straight into the
 * archive's write stream rather than buffered. Returns `null` for an
 * object that's gone (already retention-swept, or the R2 row/object pair
 * DB§16 allows to briefly diverge) so the caller can skip it and note the
 * gap in the manifest instead of failing the whole export over one photo.
 */
export async function getR2ObjectStream(key: string): Promise<Readable | null> {
  try {
    const result = await client.send(
      new GetObjectCommand({ Bucket: env.R2_BUCKET_NAME, Key: key }),
    );
    // In Node, the SDK's `Body` is always a `Readable` under this cast — it
    // is only a web `ReadableStream` in a browser runtime, which this
    // server process never is.
    return (result.Body as Readable | undefined) ?? null;
  } catch {
    return null;
  }
}
