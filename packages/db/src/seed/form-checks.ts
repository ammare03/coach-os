// DB§21: "2 form-check videos with coach comments and annotations."
// `phase-11-media-pipeline` doesn't exist yet at this point in the build
// order, so these `media_assets` rows are seeded directly with
// `processing_status = 'ready'` and placeholder `storage_key` values — they
// represent what the pipeline *would* produce, not an actual upload
// (seed-and-fixtures/01's own Approach §8). At least one comment carries
// `timestamp_ms` and `annotation`, since `phase-16-video-annotation` needs a
// realistic example to develop against even though it's a much later phase.
import type { Transaction } from '../aggregates/types.ts';
import { comments, mediaAssets } from '../schema/coaching.ts';

import { timestampFromAnchor } from './lib/dates.ts';
import { seedId } from './lib/deterministic-id.ts';
import { faker } from './lib/faker.ts';

export type FormCheckDef = {
  key: string;
  clientKey: string;
  exerciseName: string;
  exerciseId: string;
};

export type SeededFormCheck = {
  assetId: string;
};

/** Must run after `clients.ts`, `exercises.ts`, and `coach.ts`. */
export async function seedFormChecks(
  tx: Transaction,
  coachProfileId: string,
  coachUserId: string,
  clientIdByKey: Map<string, string>,
  clientUserIdByKey: Map<string, string>,
  defs: FormCheckDef[],
): Promise<SeededFormCheck[]> {
  const seeded: SeededFormCheck[] = [];

  for (const [index, def] of defs.entries()) {
    const clientProfileId = clientIdByKey.get(def.clientKey);
    const clientUserId = clientUserIdByKey.get(def.clientKey);
    if (!clientProfileId || !clientUserId) {
      throw new Error(`seedFormChecks: unresolved client for ${def.clientKey}`);
    }

    const assetId = seedId(`media_asset:formcheck:${def.key}`);
    const uploadedAt = timestampFromAnchor(-10 + index, 18);

    await tx.insert(mediaAssets).values({
      id: assetId,
      ownerUserId: clientUserId,
      coachId: coachProfileId,
      clientId: clientProfileId,
      kind: 'video',
      storageKey: `seed/formchecks/${def.key}.mp4`,
      mimeType: 'video/mp4',
      sizeBytes: faker.number.int({ min: 8_000_000, max: 45_000_000 }),
      durationSeconds: faker.number.int({ min: 12, max: 45 }).toFixed(2),
      width: 1080,
      height: 1920,
      orientation: 0,
      thumbnailKey: `seed/formchecks/${def.key}-thumb.jpg`,
      blurhash: 'LKO2?U%2Tw=w]~RBVZRi};RPxuwH',
      playbackId: `seed-playback-${def.key}`,
      processingStatus: 'ready',
      visibility: 'shared',
      exerciseId: def.exerciseId,
      createdAt: uploadedAt,
      updatedAt: uploadedAt,
    });

    // The coach's review comment — first one carries the timestamp +
    // annotation `phase-16-video-annotation` needs; the second is a plain
    // text reply, proving both comment shapes on this same target.
    await tx.insert(comments).values([
      {
        id: seedId(`comment:formcheck:${def.key}:1`),
        authorUserId: coachUserId,
        targetType: 'media_asset',
        targetId: assetId,
        clientId: clientProfileId,
        body: `Knees are caving in slightly on the way up — think "screw your feet into the floor" and push them out toward your toes. ${def.exerciseName} looks strong otherwise.`,
        timestampMs: faker.number.int({ min: 2000, max: 8000 }),
        annotation: {
          frameMs: 4200,
          shape: 'arrow',
          strokes: [
            { x: 0.42, y: 0.61 },
            { x: 0.36, y: 0.68 },
          ],
        },
        createdAt: timestampFromAnchor(-9 + index, 9),
        updatedAt: timestampFromAnchor(-9 + index, 9),
      },
      {
        id: seedId(`comment:formcheck:${def.key}:2`),
        authorUserId: coachUserId,
        targetType: 'media_asset',
        targetId: assetId,
        clientId: clientProfileId,
        body: 'Depth is great this week — keep it up.',
        createdAt: timestampFromAnchor(-9 + index, 9, 5),
        updatedAt: timestampFromAnchor(-9 + index, 9, 5),
      },
    ]);

    seeded.push({ assetId });
  }

  return seeded;
}
