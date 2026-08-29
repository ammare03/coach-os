// `account-lifecycle/09` — the DB§15 `data-export` job: walk → serialise →
// package → upload → notify. Reads DATABASE.md DB§19.2 and this task's own
// doc before touching this file; the single highest-severity failure mode
// here is a coach's archive containing a client's content (see `../services
// /export/collect.ts`'s own doc comment on how each collector avoids that),
// and the second-highest is this job's own memory footprint on a large
// account (Approach step 3 — everything here streams to a temp file, never
// buffers the archive in the process).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { schema, type DbClient } from '@coachos/db';
import archiver from 'archiver';
import { eq } from 'drizzle-orm';

import { logger } from '../lib/logger.ts';
import {
  getR2ObjectStream,
  getSignedDownloadUrl,
  uploadFileToR2,
} from '../lib/storage/r2-client.ts';
import {
  collectCoaching,
  collectMediaManifest,
  collectNutrition,
  collectProfile,
  collectTraining,
  resolveExportSubject,
} from '../services/export/collect.ts';
import { buildManifest, buildReadme } from '../services/export/manifest.ts';

import { sendExportReadyEmail } from './send-export-ready-email.ts';

const ARCHIVE_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

const MIME_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
};

function extensionFor(mimeType: string): string {
  return MIME_EXTENSIONS[mimeType] ?? 'bin';
}

/**
 * `exports/{userId}/{exportId}.zip` — DATABASE.md DB§16's exact keyspace.
 * Deterministic from the two ids alone, which is what makes the upload
 * half of this job idempotent under a retried/re-enqueued attempt
 * (Approach step 7): a second run overwrites the same object rather than
 * producing a second archive.
 */
function objectKeyFor(userId: string, exportId: string): string {
  return `exports/${userId}/${exportId}.zip`;
}

async function markFailed(db: DbClient, exportId: string, errorCode: string): Promise<void> {
  await db
    .update(schema.exportRequests)
    .set({ status: 'failed', errorCode })
    .where(eq(schema.exportRequests.id, exportId));
}

/**
 * Builds one user's export archive end to end. `exportId` is a
 * `platform.export_requests.id` — the row already exists (created by
 * `account-lifecycle/10`'s request procedure, or by this task's own test
 * fixtures standing in for it) with `status = 'queued'` and names the
 * subject via `user_id`.
 */
export async function buildDataExport(db: DbClient, exportId: string): Promise<void> {
  const [request] = await db
    .select()
    .from(schema.exportRequests)
    .where(eq(schema.exportRequests.id, exportId));
  if (!request) throw new Error(`buildDataExport: export_requests ${exportId} not found`);

  await db
    .update(schema.exportRequests)
    .set({ status: 'building' })
    .where(eq(schema.exportRequests.id, exportId));

  const tempPath = path.join(os.tmpdir(), `coachos-export-${exportId}.zip`);

  try {
    const subject = await resolveExportSubject(db, request.userId);
    const root = `coachos-export-${new Date().toISOString().slice(0, 10)}`;

    const [profile, training, nutrition, coaching, media] = await Promise.all([
      collectProfile(db, subject),
      collectTraining(db, subject),
      collectNutrition(db, subject),
      collectCoaching(db, subject),
      collectMediaManifest(db, subject),
    ]);

    const rowCounts: Record<string, number> = {
      sessions: training.sessions.length,
      personalRecords: training.personalRecords.length,
      programs: training.programs.length,
      meals: nutrition.meals.length,
      dailySummaries: nutrition.dailySummaries.length,
      waterLogs: nutrition.waterLogs.length,
      mealPlans: nutrition.mealPlans.length,
      mealPlanAssignments: nutrition.mealPlanAssignments.length,
      checkins: coaching.checkins.length,
      bodyMetrics: coaching.bodyMetrics.length,
      habits: coaching.habits.length,
      comments: coaching.comments.length,
      messages: coaching.messages.length,
      liveSessions: coaching.liveSessions.length,
      coachNotes: coaching.coachNotes.length,
      mediaAssets: media.length,
    };

    // Video links are minted now, at build time — a fresh, correctly-scoped
    // signature every time the archive is (re)built, never reused past its
    // own `expiresIn` (`../lib/storage/r2-client.ts`'s own doc comment on
    // `getSignedDownloadUrl`). Set to the archive's own remaining lifetime
    // capped at the security skill's 1h ceiling; a user who opens the
    // manifest after that window re-requests a fresh export rather than
    // finding a stale link — the same limitation `README.txt` states.
    const mediaManifest = await Promise.all(
      media.map(async (asset) => ({
        ...asset,
        downloadUrl:
          asset.kind === 'video' ? await getSignedDownloadUrlSafely(asset.storageKey) : undefined,
      })),
    );

    await new Promise<void>((resolve, reject) => {
      const output = fs.createWriteStream(tempPath);
      const archive = archiver('zip', { zlib: { level: 9 } });

      output.on('close', resolve);
      archive.on('error', reject);
      output.on('error', reject);
      archive.pipe(output);

      archive.append(buildReadme(subject.role), { name: `${root}/README.txt` });
      archive.append(JSON.stringify(buildManifest(subject.role, rowCounts), null, 2), {
        name: `${root}/manifest.json`,
      });
      archive.append(JSON.stringify(profile, null, 2), { name: `${root}/profile.json` });

      archive.append(
        JSON.stringify({ sessions: training.sessions, programs: training.programs }, null, 2),
        { name: `${root}/training/sessions.json` },
      );
      archive.append(JSON.stringify(training.personalRecords, null, 2), {
        name: `${root}/training/personal-records.json`,
      });
      archive.append(JSON.stringify(training.programs, null, 2), {
        name: `${root}/training/programs.json`,
      });

      archive.append(JSON.stringify(nutrition.meals, null, 2), {
        name: `${root}/nutrition/meals.json`,
      });
      archive.append(
        JSON.stringify(
          { dailySummaries: nutrition.dailySummaries, waterLogs: nutrition.waterLogs },
          null,
          2,
        ),
        { name: `${root}/nutrition/daily-summaries.json` },
      );
      archive.append(
        JSON.stringify(
          { mealPlans: nutrition.mealPlans, mealPlanAssignments: nutrition.mealPlanAssignments },
          null,
          2,
        ),
        { name: `${root}/nutrition/meal-plans.json` },
      );

      archive.append(JSON.stringify(coaching.checkins, null, 2), {
        name: `${root}/coaching/check-ins.json`,
      });
      archive.append(JSON.stringify(coaching.bodyMetrics, null, 2), {
        name: `${root}/coaching/body-metrics.json`,
      });
      archive.append(JSON.stringify(coaching.habits, null, 2), {
        name: `${root}/coaching/habits.json`,
      });
      archive.append(JSON.stringify(coaching.comments, null, 2), {
        name: `${root}/coaching/comments.json`,
      });
      archive.append(JSON.stringify(coaching.messages, null, 2), {
        name: `${root}/coaching/messages.json`,
      });
      archive.append(JSON.stringify(coaching.liveSessions, null, 2), {
        name: `${root}/coaching/live-sessions.json`,
      });
      if (subject.role === 'coach') {
        archive.append(JSON.stringify(coaching.coachNotes, null, 2), {
          name: `${root}/coaching/notes.json`,
        });
      }

      archive.append(JSON.stringify(mediaManifest, null, 2), {
        name: `${root}/media/MANIFEST.json`,
      });

      // Photos as bytes, streamed straight from R2 into the archive —
      // never buffered whole in this process (Approach step 4). Queued
      // synchronously below, before `finalize()`; each `append` call
      // itself resolves immediately, archiver drains the stream async.
      void (async () => {
        for (const asset of media) {
          if (!asset.includedAsBytes) continue;
          const stream = await getR2ObjectStream(asset.storageKey);
          if (!stream) continue; // gone (retention-swept, or a brief DB§16 row/object gap) — noted only via its absence from files/, never a hard failure
          archive.append(stream, {
            name: `${root}/media/files/${asset.id}.${extensionFor(asset.mimeType)}`,
          });
        }
        archive.finalize();
      })();
    });

    const { size: bytes } = fs.statSync(tempPath);
    const objectKey = objectKeyFor(request.userId, exportId);
    await uploadFileToR2(tempPath, objectKey, 'application/zip');

    const expiresAt = new Date(Date.now() + ARCHIVE_LIFETIME_MS);
    await db
      .update(schema.exportRequests)
      .set({
        status: 'ready',
        bytes,
        rowCounts,
        objectKey,
        expiresAt,
        completedAt: new Date(),
      })
      .where(eq(schema.exportRequests.id, exportId));

    // `CLAUDE.md` §21.2 — every export writes to audit_log. `targetId` here
    // is the SUBJECT's user id, not the exportId — matching the existing
    // convention (`../jobs/purge-account.ts`) of `targetType`/`targetId`
    // naming the account the action concerns.
    await db.insert(schema.auditLog).values({
      actorUserId: request.requestedByUserId ?? request.userId,
      action: 'account.export_generated',
      targetType: 'user',
      targetId: request.userId,
      metadata: { exportId },
    });

    await sendExportReadyEmail(db, request.userId);

    // Step 9's own log discipline: exportId, counts, byte size, duration —
    // never a filename, food name, or media key (Approach step 9).
    logger.info('export.generated', { jobId: exportId, bytes, count: media.length });
  } catch (err) {
    await markFailed(db, exportId, 'INTERNAL_ERROR');
    throw err;
  } finally {
    fs.promises.unlink(tempPath).catch(() => {
      // Best-effort temp-file cleanup — a leftover file in os.tmpdir() is
      // an operational nuisance the platform's own tmp-cleaning already
      // handles, never a reason to mask the job's real outcome.
    });
  }
}

/**
 * Signing a video link must never fail the whole export over one asset —
 * the manifest simply omits `downloadUrl` for that row, same tolerance
 * `getR2ObjectStream` already applies to a missing photo.
 */
async function getSignedDownloadUrlSafely(key: string): Promise<string | undefined> {
  try {
    return await getSignedDownloadUrl(key, 3600);
  } catch {
    return undefined;
  }
}
