import { schema } from '@coachos/db';
import { media as mediaSchemas } from '@coachos/schemas';
import { and, eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';

import { appError } from '../lib/app-error.ts';
import { mediaOriginalKey, type MediaOriginalExtension } from '../lib/r2-keys.ts';
import {
  completeMultipartUpload,
  createMultipartUpload,
  getSignedUploadPartUrl,
} from '../lib/storage/r2-client.ts';
import { checkStorageQuota } from '../lib/storage-quota.ts';
import { recordAssetStored } from '../lib/storage-usage.ts';
import { enqueueMediaTranscode } from '../queues/enqueue.ts';
import type { AuthenticatedContext } from '../trpc/context.ts';
import { router } from '../trpc/init.ts';
import {
  coachOrClientProcedure,
  ownsResource,
  rateLimit,
  RATE_LIMIT_TIERS,
} from '../trpc/procedures.ts';

// `media.*` — the write half of the upload contract
// (`phase-11-media-pipeline/upload-server/`). `confirmUpload`, `get` and
// `delete` land in later tasks of this same feature.
//
// The rule the whole file is shaped around (`api-conventions` §8, P11
// README): **bytes never pass through the API.** This procedure authorises
// an upload, names it, and records it. Everything after that is between the
// client's radio and R2.
//
// `createUploadUrl` carries CLAUDE.md §6.5's 60/hour/user tier explicitly;
// every other procedure added here gets the 600/min default automatically
// by deriving from `publicProcedure` (`../trpc/procedures.ts`).

/**
 * The closed mime → (kind, extension) table. Both halves matter: `kind`
 * fills DB§4's `media_kind` column, and the extension is the only value
 * `mediaOriginalKey` will accept — `MediaOriginalExtension` is a union, so
 * a mime added to `@coachos/schemas`' allowlist without a row here fails
 * this object's own `satisfies` check rather than at runtime.
 */
const MIME_TABLE = {
  'video/mp4': { kind: 'video', ext: 'mp4' },
  'video/quicktime': { kind: 'video', ext: 'mov' },
  'video/x-m4v': { kind: 'video', ext: 'm4v' },
  'image/jpeg': { kind: 'image', ext: 'jpg' },
  'image/png': { kind: 'image', ext: 'png' },
  'image/webp': { kind: 'image', ext: 'webp' },
  'image/heic': { kind: 'image', ext: 'heic' },
} satisfies Record<
  (typeof mediaSchemas.UPLOAD_MIME_TYPES)[number],
  { kind: (typeof mediaSchemas.UPLOAD_KINDS)[number]; ext: MediaOriginalExtension }
>;

/**
 * security-and-privacy §4's ceiling, applied to a write URL for the same
 * reason it applies to a read one: a presigned URL is a live credential. A
 * client whose parts outlive it calls `createUploadUrl` again — which is
 * what the 60/hour budget leaves room for.
 */
const UPLOAD_URL_TTL_SECONDS = 60 * 60;

/**
 * Who the asset belongs to, and who the storage meters against. Two ids,
 * both needed: `coachProfileId` fills DB§5.4's "who can see it" column, and
 * `coachUserId` is the key `platform.storage_usage` is actually keyed on
 * (P11 README, "Resolved ambiguities" — the coach's row is the tenant
 * meter, never the uploading client's).
 */
interface UploadTenant {
  coachProfileId: string;
  coachUserId: string;
  clientProfileId: string | null;
}

async function resolveTenant(
  ctx: AuthenticatedContext,
  input: { workoutSessionId?: string | undefined; setLogId?: string | undefined },
): Promise<UploadTenant> {
  if (ctx.user.role === 'client') {
    const clientProfileId = ctx.user.clientProfileId;
    if (clientProfileId === null) {
      throw appError(
        'INTERNAL_ERROR',
        'Something went wrong. Contact support with this reference.',
        {},
      );
    }

    const [row] = await ctx.db
      .select({ coachProfileId: schema.coachProfiles.id, coachUserId: schema.coachProfiles.userId })
      .from(schema.clientProfiles)
      .innerJoin(schema.coachProfiles, eq(schema.coachProfiles.id, schema.clientProfiles.coachId))
      .where(eq(schema.clientProfiles.id, clientProfileId));

    // A detached client (CLAUDE.md §21.3) has nobody to show the video to
    // and no tenant to meter it against. Refusing is the honest answer;
    // writing the row with a null coach would be an asset that renders on
    // nobody's screen and counts against nobody's quota.
    if (!row) {
      throw appError('CLIENT_HAS_NO_COACH', "You're not working with a coach right now.", {});
    }

    return { ...row, clientProfileId };
  }

  const coachProfileId = ctx.user.coachProfileId;
  if (coachProfileId === null) {
    throw appError(
      'INTERNAL_ERROR',
      'Something went wrong. Contact support with this reference.',
      {},
    );
  }

  // A coach's upload is attributed to the client the context id names, so
  // the client can see the reply video on their own session — both
  // `ownsResource` guards have already proven the coach owns that row, so
  // this read only has to say *which* client it belongs to. A demo video
  // names neither id and stays client-less, which is the `mediaAsset`
  // registry kind's second client-side condition
  // (`../trpc/authz/resource-registry.ts`).
  let clientProfileId: string | null = null;
  if (input.workoutSessionId !== undefined) {
    const [session] = await ctx.db
      .select({ clientId: schema.workoutSessions.clientId })
      .from(schema.workoutSessions)
      .where(eq(schema.workoutSessions.id, input.workoutSessionId));
    clientProfileId = session?.clientId ?? null;
  } else if (input.setLogId !== undefined) {
    const [setLog] = await ctx.db
      .select({ clientId: schema.setLogs.clientId })
      .from(schema.setLogs)
      .where(eq(schema.setLogs.id, input.setLogId));
    clientProfileId = setLog?.clientId ?? null;
  }

  return { coachProfileId, coachUserId: ctx.user.id, clientProfileId };
}

/**
 * The four S3/R2 completion failures that mean "the bytes you named are not
 * there" — an aborted or expired upload id, a part that never landed, a tag
 * that doesn't match, a part under the 5MB floor. Each is only recoverable
 * by uploading again, which is what `MEDIA_UPLOAD_INCOMPLETE` tells the
 * client to do.
 *
 * Deliberately a closed list rather than "any error from R2": a socket
 * timeout reaching the store is retryable exactly as it stands, and
 * answering it with "upload your 200MB clip again" would be both wrong and
 * expensive.
 */
const LOST_UPLOAD_ERROR_NAMES = new Set([
  'NoSuchUpload',
  'InvalidPart',
  'InvalidPartOrder',
  'EntityTooSmall',
]);

function isLostUpload(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('name' in error)) return false;
  const { name } = error as { name: unknown };
  return typeof name === 'string' && LOST_UPLOAD_ERROR_NAMES.has(name);
}

export const mediaRouter = router({
  createUploadUrl: coachOrClientProcedure
    .input(mediaSchemas.createUploadUrlInput)
    .use(rateLimit(RATE_LIMIT_TIERS.mediaCreateUploadUrl))
    // Guarded on whichever context id is present. `ownsResource` returns
    // early for an empty id list, so an absent field is not an unguarded
    // one — it is a call that names no client-scoped row at all. `exerciseId`
    // is deliberately unguarded and registered as such in
    // `../trpc/authz/resource-fields.ts`: the exercise catalogue is global.
    .use(
      ownsResource('workoutSession', (i: { workoutSessionId?: string }) =>
        i.workoutSessionId === undefined ? [] : i.workoutSessionId,
      ),
    )
    .use(
      ownsResource('setLog', (i: { setLogId?: string }) =>
        i.setLogId === undefined ? [] : i.setLogId,
      ),
    )
    .mutation(async ({ ctx, input }) => {
      // ── 1. Per-clip limits, before any database write or R2 call ───────
      // CLAUDE.md §8.6's exact numbers. Both are checked here rather than
      // as `.max()` in the Zod schema so each comes back as its own
      // catalogued code carrying the limit that was hit, which is what
      // lets the client offer the right fix — trimming a clip and
      // re-encoding one are different actions.
      const { kind, ext } = MIME_TABLE[input.mimeType];
      if (kind !== input.kind) {
        throw appError('VALIDATION_FAILED', 'That file type does not match the upload kind.', {
          fields: { mimeType: 'This does not match the kind of media being uploaded.' },
        });
      }
      if (kind === 'video' && input.durationSeconds === undefined) {
        // Never defaulted. A default would be a 90-second gate any client
        // could walk past simply by omitting the field.
        throw appError('VALIDATION_FAILED', 'A video upload must declare its length.', {
          fields: { durationSeconds: 'Tell us how long the video is.' },
        });
      }
      if (
        input.durationSeconds !== undefined &&
        input.durationSeconds > mediaSchemas.MAX_CLIP_DURATION_SECONDS
      ) {
        throw appError(
          'MEDIA_DURATION_TOO_LONG',
          `That video is too long. Form checks can be up to ${mediaSchemas.MAX_CLIP_DURATION_SECONDS} seconds.`,
          { maxDurationSeconds: mediaSchemas.MAX_CLIP_DURATION_SECONDS },
        );
      }
      if (input.sizeBytes > mediaSchemas.MAX_CLIP_BYTES) {
        throw appError('PAYLOAD_TOO_LARGE', 'That file is too large.', {
          maxBytes: mediaSchemas.MAX_CLIP_BYTES,
        });
      }

      const tenant = await resolveTenant(ctx, input);

      // ── 2. Quota check (`upload-server/03`) ────────────────────────────
      // Three things this call's placement is load-bearing about:
      //   • It sits AFTER the per-clip limits and BEFORE the insert, so a
      //     request that fails either gate leaves no `uploading` row behind
      //     (`upload-server/01`'s Approach step 2) and no live presigned
      //     credential to clean up.
      //   • It takes `tenant.coachUserId` — the COACH's `users.id`, which
      //     is what `platform.storage_usage` is keyed on and what the P11
      //     README's tenant-meter resolution names. Never the uploading
      //     client's id, and never a `coach_profiles.id`.
      //   • The payload keys are `usedBytes`/`limitBytes`, matching the
      //     shipped catalogue (`@coachos/schemas`' `AppErrorPayloads`), not
      //     the `bytesUsed`/`bytesLimit` names `checkStorageQuota` returns.
      //     The two differ; both are correct in their own place.
      const quota = await checkStorageQuota(ctx.db, tenant.coachUserId, input.sizeBytes);
      if (!quota.ok) {
        // One fact, two voices (`product-copy` §3, §15.4). The coach owns
        // the plan and can act on it, so they get ER§1.3's catalogued line.
        // A client has no plan to be out of, and handing them their coach's
        // commercial state would be both confusing and none of their
        // business — they get the fact and the one route out of it.
        const message =
          ctx.user.role === 'coach'
            ? "You're out of storage on your plan. Free some space or upgrade to keep uploading."
            : "There's no room to store this right now. Your coach can free up space.";
        throw appError('STORAGE_QUOTA_EXCEEDED', message, {
          usedBytes: quota.bytesUsed,
          limitBytes: quota.bytesLimit,
        });
      }

      // ── 3. The row, before any presigned URL ──────────────────────────
      // The ordering is the acceptance criterion, not an implementation
      // detail (`upload-server/01`'s Risks): a client that dies between
      // this insert and the first byte reaching R2 leaves a discoverable,
      // queryable orphan row rather than silent bytes in a bucket with
      // nothing pointing at them.
      //
      // The id is generated here rather than left to the column default
      // because `storage_key` is derived from it and is NOT NULL — one
      // uuidv7 (DB§21), used for both.
      const assetId = uuidv7();
      const storageKey = mediaOriginalKey(ctx.user.id, assetId, ext);

      await ctx.db.insert(schema.mediaAssets).values({
        id: assetId,
        ownerUserId: ctx.user.id,
        coachId: tenant.coachProfileId,
        clientId: tenant.clientProfileId,
        kind,
        storageKey,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        durationSeconds: input.durationSeconds?.toFixed(2) ?? null,
        exerciseId: input.exerciseId ?? null,
        workoutSessionId: input.workoutSessionId ?? null,
        setLogId: input.setLogId ?? null,
        // `visibility` and `processing_status` are left to their column
        // defaults ('coach_only', 'uploading') deliberately — the P11
        // README's rule is that this feature never sets visibility to
        // anything else, and the way to keep that true is to never name it.
      });

      // ── 4. The presigned multipart URLs, 5MB per part ─────────────────
      const partSizeBytes = mediaSchemas.UPLOAD_PART_SIZE_BYTES;
      const partCount = Math.ceil(input.sizeBytes / partSizeBytes);
      const uploadId = await createMultipartUpload(storageKey, input.mimeType);

      const uploadUrls = await Promise.all(
        Array.from({ length: partCount }, async (_, index) => {
          const partNumber = index + 1;
          return {
            partNumber,
            url: await getSignedUploadPartUrl(
              storageKey,
              uploadId,
              partNumber,
              UPLOAD_URL_TTL_SECONDS,
            ),
          };
        }),
      );

      // No log line here, and none anywhere in this path: the storage key,
      // the presigned URLs, and the filename are all DB§18 🔴 and a log is
      // where a signed URL becomes a leaked credential
      // (`security-and-privacy` §4).
      //
      // `uploadId` crosses the wire because the device needs it to survive
      // its own restart — `upload-client/03`'s resumable uploader persists
      // it alongside the parts and ETags in `upload_queue` (DB§13), and
      // `upload-server/02`'s completion needs the same value. It is not an
      // extra disclosure: every part URL already signs it into its own
      // query string.
      return { assetId, uploadId, uploadUrls, partSizeBytes };
    }),

  // The other half of the contract (`upload-server/02`): every part has
  // landed, so assemble the object, hand the asset to the worker, and meter
  // the bytes. Still no byte through the API.
  confirmUpload: coachOrClientProcedure
    .input(mediaSchemas.confirmUploadInput)
    .use(ownsResource('mediaAsset', (i: { assetId: string }) => i.assetId))
    .mutation(async ({ ctx, input }) => {
      // The coach's and the client's `users.id`, which is what
      // `platform.storage_usage` is keyed on — the asset row carries
      // profile ids, and passing one of those would write a counter row
      // against an id `identity.users` has never heard of.
      const [asset] = await ctx.db
        .select({
          storageKey: schema.mediaAssets.storageKey,
          sizeBytes: schema.mediaAssets.sizeBytes,
          processingStatus: schema.mediaAssets.processingStatus,
          coachUserId: schema.coachProfiles.userId,
          clientUserId: schema.clientProfiles.userId,
        })
        .from(schema.mediaAssets)
        .leftJoin(schema.coachProfiles, eq(schema.coachProfiles.id, schema.mediaAssets.coachId))
        .leftJoin(schema.clientProfiles, eq(schema.clientProfiles.id, schema.mediaAssets.clientId))
        .where(eq(schema.mediaAssets.id, input.assetId));

      // Unreachable behind `ownsResource`, which refuses an id that names
      // no row at all — kept because "unreachable" is a claim about another
      // file, and `NOT_YOUR_CLIENT` is the same answer that file gives
      // (`security-and-privacy` §1: never confirm existence).
      if (!asset) {
        throw appError('NOT_YOUR_CLIENT', "We couldn't find that upload.", {});
      }

      // ── 1. The replay ────────────────────────────────────────────────
      // A client retrying after a dropped response gets the same answer
      // and nothing else happens: no second assembly (R2 would refuse it),
      // no second job, and — the reason this check exists at all — no
      // second increment. The guarded UPDATE below is what makes that safe
      // under a genuine race; this is what makes a sequential retry cheap.
      if (asset.processingStatus !== 'uploading') {
        return { status: asset.processingStatus };
      }

      const { coachUserId } = asset;
      if (coachUserId === null) {
        // Every path in `createUploadUrl` sets a coach, and the column
        // cascades rather than nulling. A row here means the tenant meter
        // has nobody to meter, and guessing an owner would silently
        // mis-bill somebody.
        throw appError(
          'INTERNAL_ERROR',
          'Something went wrong. Contact support with this reference.',
          {},
        );
      }

      // ── 2. Assemble the object ───────────────────────────────────────
      try {
        await completeMultipartUpload(asset.storageKey, input.uploadId, input.parts);
      } catch (error) {
        if (isLostUpload(error)) {
          throw appError(
            'MEDIA_UPLOAD_INCOMPLETE',
            "That upload didn't finish. Try uploading it again.",
            {},
          );
        }
        throw error;
      }

      // ── 3. Status and counter, one transaction (DB§8.2) ──────────────
      // `WHERE processing_status = 'uploading'` is the whole idempotency
      // guarantee, and it has to be on the UPDATE rather than on the read
      // above: two confirms in flight at once both read `uploading`, and
      // only the one whose UPDATE matches a row may increment. Removing it
      // "to simplify" double-counts a client's bytes against their coach's
      // quota (this task's Risks).
      const transitioned = await ctx.db.transaction(async (tx) => {
        const updated = await tx
          .update(schema.mediaAssets)
          .set({ processingStatus: 'processing' })
          .where(
            and(
              eq(schema.mediaAssets.id, input.assetId),
              eq(schema.mediaAssets.processingStatus, 'uploading'),
            ),
          )
          .returning({ id: schema.mediaAssets.id });

        if (updated.length === 0) return false;

        await recordAssetStored(tx, {
          coachUserId,
          clientUserId: asset.clientUserId,
          bytes: asset.sizeBytes,
        });
        return true;
      });

      // ── 4. The job, after the commit ─────────────────────────────────
      // Redis is a separate system, so this cannot join the transaction —
      // only sit after it. An enqueue that fails here leaves the asset in
      // `processing` with no job, which `transcode-worker/` reconciles; the
      // inverse (a job for a transition that rolled back) would be a worker
      // reading a row that never moved, which is worse.
      if (transitioned) {
        await enqueueMediaTranscode({ assetId: input.assetId });
      }

      return { status: 'processing' as const };
    }),
});
