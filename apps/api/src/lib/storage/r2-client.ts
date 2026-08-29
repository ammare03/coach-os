// The one client that talks to Cloudflare R2 (CLAUDE.md §3.2 — S3-compatible,
// zero egress fees). `account-lifecycle/04` is this client's first caller;
// `phase-11-media-pipeline` is expected to add the upload/presign side
// alongside this deletion side, both through this same module, never a
// second `S3Client` instantiated elsewhere.
import { DeleteObjectsCommand, S3Client } from '@aws-sdk/client-s3';

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
