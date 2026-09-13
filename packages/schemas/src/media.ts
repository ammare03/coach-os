// Input schemas for `media.*` (createUploadUrl, confirmUpload, get, delete).
// `createUploadUrl` filled by `phase-11-media-pipeline/upload-server/01`,
// `confirmUpload` by `/02`.
import { z } from 'zod';

import { id, strictObject } from './primitives.ts';

/**
 * One multipart part, in bytes. 5MB is `CLAUDE.md` §12's pipeline figure and
 * also S3/R2's own minimum for every part but the last — a smaller value is
 * rejected by the store at completion time, not at presign time, which makes
 * it a bug that only shows up once a real upload finishes.
 */
export const UPLOAD_PART_SIZE_BYTES = 5 * 1024 * 1024;

/**
 * `CLAUDE.md` §8.6's two per-clip limits, stated once here so the server
 * gate and the client's own pre-flight trim read the same numbers.
 *
 * Deliberately **not** expressed as `.max()` on the fields below: a request
 * past either of these must come back as `PAYLOAD_TOO_LARGE` /
 * `MEDIA_DURATION_TOO_LONG` carrying the limit that was hit, not as a
 * generic `VALIDATION_FAILED` (`upload-server/01`'s acceptance criteria).
 * Zod validates shape here; the product limit is the resolver's to enforce.
 */
export const MAX_CLIP_BYTES = 200 * 1024 * 1024;
export const MAX_CLIP_DURATION_SECONDS = 90;

/**
 * The closed mime allowlist. Paired one-for-one with `MediaOriginalExtension`
 * in `apps/api/src/lib/r2-keys.ts` — widening one without the other is how a
 * key gets an extension the keyspace module does not know about, so adding a
 * row is a deliberate edit in both files.
 *
 * Video first: the authorisation enumeration test synthesises the first
 * member of an enum, and a video mime paired with the synthesised
 * `kind: 'video'` keeps that probe a well-formed request rather than an
 * accidental validation failure.
 */
export const UPLOAD_MIME_TYPES = [
  'video/mp4',
  'video/quicktime',
  'video/x-m4v',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
] as const;

/**
 * DB§4's `media_kind`, narrowed to what this pipeline uploads. `audio` and
 * `document` exist in the column's enum but nothing mints one yet; admitting
 * them here would mean a mime allowlist and a transcode path for neither.
 */
export const UPLOAD_KINDS = ['video', 'image'] as const;

export const createUploadUrlInput = strictObject({
  kind: z.enum(UPLOAD_KINDS),
  mimeType: z.enum(UPLOAD_MIME_TYPES),
  sizeBytes: z.number().int().positive(),
  /**
   * Required for a video, absent for an image — enforced in the resolver
   * rather than by a `.refine()`, because a cross-field refinement makes the
   * schema unsynthesisable for the authorisation enumeration test and
   * because "a video with no duration" needs its own sentence, not a generic
   * form error. Omitting it on a video is refused, never defaulted: a
   * default would be a 90-second gate a client could walk straight past.
   */
  durationSeconds: z.number().positive().optional(),

  // What the upload is ABOUT (DB§5.4) — all optional, and a coach's demo
  // video carries none of them.
  exerciseId: id.optional(),
  workoutSessionId: id.optional(),
  setLogId: id.optional(),
});
export type CreateUploadUrlInput = z.infer<typeof createUploadUrlInput>;

/**
 * The most parts a single clip can ever have: the §8.6 size ceiling over
 * the 5MB part size. Derived rather than written, so raising either limit
 * cannot leave this one behind.
 */
export const MAX_UPLOAD_PARTS = Math.ceil(MAX_CLIP_BYTES / UPLOAD_PART_SIZE_BYTES);

/**
 * An S3/R2 entity tag as the store returns it in the `ETag` response header
 * — a quoted hex digest, sometimes with a `-{partCount}` suffix. Passed back
 * to R2 verbatim at completion: normalising it (stripping the quotes,
 * lowercasing) is how a completion starts failing for reasons nobody can
 * see, since only R2 knows which form it signed.
 */
const etag = z.string().min(1).max(128);

export const confirmUploadInput = strictObject({
  assetId: id,
  /**
   * R2's own multipart upload handle, as `createUploadUrl` returned it.
   * Not a row id, and deliberately not stored server-side: `media_assets`
   * has no column for it, and inventing one would mean a migration for a
   * value the device already has to persist anyway to survive its own
   * restart (`upload-client/03`'s `upload_queue` row, DB§13).
   */
  uploadId: z.string().min(1).max(256),
  /**
   * Exactly what S3-compatible multipart completion needs, and exactly what
   * gets forwarded — R2 validates the count, the order, and every tag, so
   * re-deriving or re-ordering any of it here would only mask a client bug
   * behind a store error nobody can trace.
   */
  parts: z
    .array(strictObject({ partNumber: z.number().int().positive(), etag }))
    .min(1)
    .max(MAX_UPLOAD_PARTS),
});
export type ConfirmUploadInput = z.infer<typeof confirmUploadInput>;
