/**
 * The R2 object keyspace — DATABASE.md DB§16, transcribed.
 *
 * This is the *only* place an R2 object key is assembled. A key built by
 * template literal at a call site is how one path loses a segment, or uses
 * `clientId` where DB§16 says `userId`, and neither is discoverable until a
 * coach's video 404s months later. `media_assets.storage_key` is what makes
 * the row and the object findable from each other in both directions
 * (DB§16); that property only holds while one grammar produces every key.
 *
 * Nothing here reads or writes R2 — `storage/r2-client.ts` does that, using
 * only the strings these functions return.
 *
 * Every function is a literal transcription. There is no normalisation, no
 * leading-dot stripping, no case folding: a caller that would have passed a
 * malformed extension is stopped by `MediaOriginalExtension` at compile
 * time instead, which is the whole reason these arguments are unions rather
 * than `string`.
 */

/**
 * The HLS renditions the ffmpeg worker produces (CLAUDE.md §12,
 * `transcode-worker/02-hls-ladder.md`). A union, not `string`, so
 * `transcode-worker` and `playback` disagree at compile time rather than
 * over a missing segment.
 */
export type MediaVariant = '720p' | '480p';

/**
 * Extensions `media/{userId}/{assetId}/original.{ext}` accepts. The image
 * half matches the mime→extension map the export job already uses
 * (`jobs/data-export.ts`); the video half is what `expo-camera` and the
 * gallery picker produce on the two platforms.
 *
 * Adding one is a deliberate edit here, paired with the mime allowlist in
 * `media.createUploadUrl` — never a widening to `string` at a call site.
 */
export type MediaOriginalExtension = 'mp4' | 'mov' | 'm4v' | 'jpg' | 'png' | 'webp' | 'heic';

export function mediaOriginalKey(
  userId: string,
  assetId: string,
  ext: MediaOriginalExtension,
): string {
  return `media/${userId}/${assetId}/original.${ext}`;
}

export function mediaHlsManifestKey(userId: string, assetId: string): string {
  return `media/${userId}/${assetId}/hls/manifest.m3u8`;
}

export function mediaHlsSegmentKey(
  userId: string,
  assetId: string,
  variant: MediaVariant,
  segmentIndex: number,
): string {
  // The index is a loop counter in the transcode worker, and a fractional
  // or NaN one writes an object no sub-playlist will ever reference —
  // playback fails silently rather than loudly. Refuse instead of naming it.
  if (!Number.isInteger(segmentIndex) || segmentIndex < 0) {
    throw new RangeError('HLS segment index must be a non-negative integer');
  }
  return `media/${userId}/${assetId}/hls/${variant}/segment_${segmentIndex}.ts`;
}

export function mediaThumbKey(userId: string, assetId: string): string {
  return `media/${userId}/${assetId}/thumb.jpg`;
}

export function mediaPosterKey(userId: string, assetId: string): string {
  return `media/${userId}/${assetId}/poster.jpg`;
}

/**
 * Progress photos — keyed on the client profile, not the owning user, and
 * always `.jpg`. The highest-sensitivity object in the product (DB§18): the
 * key itself never enters a log, an analytics event, or an error message.
 */
export function photoOriginalKey(clientId: string, assetId: string): string {
  return `photos/${clientId}/${assetId}/original.jpg`;
}

/** No per-asset folder here, unlike `media/` and `photos/` — DB§16. */
export function avatarKey(userId: string, assetId: string): string {
  return `avatars/${userId}/${assetId}.jpg`;
}

/** One logo per coach (white-label, CLAUDE.md §15.2), so no asset id. */
export function brandLogoKey(coachId: string): string {
  return `brand/${coachId}/logo.png`;
}

/**
 * `exportId` is a `platform.export_requests.id`. Deterministic from the two
 * ids alone, which is what lets a retried export job overwrite its own
 * archive rather than leave a second one behind. Carries DB§16's 7-day
 * lifecycle rule.
 */
export function exportKey(userId: string, exportId: string): string {
  return `exports/${userId}/${exportId}.zip`;
}

/**
 * The folder half of `exportKey`, for the delete-by-prefix path that removes
 * every archive a user ever requested (DB§19.2 step 8). Not one of DB§16's
 * nine object shapes — it names no object — but it is the same grammar, and
 * a prefix built by hand somewhere else is how the purge silently misses a
 * folder.
 */
export function exportPrefix(userId: string): string {
  return `exports/${userId}/`;
}
