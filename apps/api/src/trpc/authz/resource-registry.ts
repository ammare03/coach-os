// `03-owns-resource.md` step 3 and step 8 — one statement per kind, using
// the DB§6 denormalised columns. Every function here answers "which of
// these ids does this coach/client own", never a single id at a time, so
// the batch case (step 5) and the single-id case share one code path.
import { schema, type DbClient } from '@coachos/db';
import { and, eq, gt, inArray, notExists, or, sql } from 'drizzle-orm';

// `account-lifecycle/06`'s time-boxed exception to DB§6: a coach who has
// been detached still owns their own training-history feedback for this
// long, read-only. `DATABASE.md` DB§6's own note names the exact rows this
// applies to and the ones it structurally cannot (body_metrics,
// progress_photos, nutrition).
const FORMER_COACH_GRACE_WINDOW = sql`now() - interval '30 days'`;

export type ResourceKind =
  | 'client'
  | 'coachNote'
  | 'invite'
  | 'program'
  | 'workoutSession'
  | 'setLog'
  | 'meal'
  | 'mediaAsset'
  | 'comment'
  | 'checkin'
  | 'liveSession';

interface ResourceKindEntry {
  // Ignores `deleted_at` and `client_profiles.status` (step 6/7) —
  // ownership answers *whose*, not *whether it's still there or billable*.
  coachOwnedIds: (
    db: DbClient,
    coach: { coachProfileId: string },
    ids: string[],
  ) => Promise<Set<string>>;
  // `null` for a kind with no client-side ownership concept at all
  // (`coachNote`) — never a function that always returns an empty set.
  // Structurally unrepresentable is stronger than "always returns false"
  // (step 8).
  clientOwnedIds:
    | ((
        db: DbClient,
        client: { clientProfileId: string; userId: string },
        ids: string[],
      ) => Promise<Set<string>>)
    | null;
  // `account-lifecycle/06`: a detached coach's 30-day read-only window on
  // their former client's training history and feedback (never photos,
  // metrics, or nutrition). `null` for a kind the window structurally
  // cannot reach — same "null, never a function returning empty" rule as
  // `clientOwnedIds` above, and for the same reason.
  formerCoachOwnedIds:
    | ((db: DbClient, coach: { coachProfileId: string }, ids: string[]) => Promise<Set<string>>)
    | null;
}

function idsOf(rows: { id: string }[]): Set<string> {
  return new Set(rows.map((r) => r.id));
}

export const RESOURCE_REGISTRY: Record<ResourceKind, ResourceKindEntry> = {
  client: {
    coachOwnedIds: async (db, { coachProfileId }, ids) =>
      idsOf(
        await db
          .select({ id: schema.clientProfiles.id })
          .from(schema.clientProfiles)
          .where(
            and(
              inArray(schema.clientProfiles.id, ids),
              eq(schema.clientProfiles.coachId, coachProfileId),
            ),
          ),
      ),
    // A client only ever "owns" their own client_profiles row.
    clientOwnedIds: async (db, { clientProfileId }, ids) =>
      idsOf(
        await db
          .select({ id: schema.clientProfiles.id })
          .from(schema.clientProfiles)
          .where(
            and(
              inArray(schema.clientProfiles.id, ids),
              eq(schema.clientProfiles.id, clientProfileId),
            ),
          ),
      ),
    // The window grants a former coach read access to their ex-client's
    // *content*, never the client_profiles row itself.
    formerCoachOwnedIds: null,
  },

  // No client branch — a client never sees `coach_client_notes` (CLAUDE.md
  // §6.2, DATABASE.md DB§5.1's own warning on the table). `clientOwnedIds`
  // is `null`, not a function returning `false`.
  coachNote: {
    coachOwnedIds: async (db, { coachProfileId }, ids) =>
      idsOf(
        await db
          .select({ id: schema.coachClientNotes.id })
          .from(schema.coachClientNotes)
          .where(
            and(
              inArray(schema.coachClientNotes.id, ids),
              eq(schema.coachClientNotes.coachId, coachProfileId),
            ),
          ),
      ),
    clientOwnedIds: null,
    formerCoachOwnedIds: null,
  },

  // A client never sees an invite — it's a coach's own pending-invitation
  // record, gone (converted to a `client_profiles` row) the moment it's
  // useful to anyone else. `clientOwnedIds` is `null`, same as `coachNote`.
  invite: {
    coachOwnedIds: async (db, { coachProfileId }, ids) =>
      idsOf(
        await db
          .select({ id: schema.invites.id })
          .from(schema.invites)
          .where(and(inArray(schema.invites.id, ids), eq(schema.invites.coachId, coachProfileId))),
      ),
    clientOwnedIds: null,
    formerCoachOwnedIds: null,
  },

  program: {
    coachOwnedIds: async (db, { coachProfileId }, ids) =>
      idsOf(
        await db
          .select({ id: schema.programs.id })
          .from(schema.programs)
          .where(
            and(inArray(schema.programs.id, ids), eq(schema.programs.coachId, coachProfileId)),
          ),
      ),
    // A client owns a program only via an `assignment` row —
    // `phase-07-exercise-and-program-authoring/` adds that table and, with
    // it, this entry's client branch. Not a P02 concern; `null` until then.
    clientOwnedIds: null,
    // A coach's own authored template, not client content — no grace window.
    formerCoachOwnedIds: null,
  },

  workoutSession: {
    coachOwnedIds: async (db, { coachProfileId }, ids) =>
      idsOf(
        await db
          .select({ id: schema.workoutSessions.id })
          .from(schema.workoutSessions)
          .where(
            and(
              inArray(schema.workoutSessions.id, ids),
              eq(schema.workoutSessions.coachId, coachProfileId),
            ),
          ),
      ),
    clientOwnedIds: async (db, { clientProfileId }, ids) =>
      idsOf(
        await db
          .select({ id: schema.workoutSessions.id })
          .from(schema.workoutSessions)
          .where(
            and(
              inArray(schema.workoutSessions.id, ids),
              eq(schema.workoutSessions.clientId, clientProfileId),
            ),
          ),
      ),
    // Training history — explicitly granted to a detached coach for 30 days
    // (`account-lifecycle/06`'s transition table).
    formerCoachOwnedIds: async (db, { coachProfileId }, ids) =>
      idsOf(
        await db
          .select({ id: schema.workoutSessions.id })
          .from(schema.workoutSessions)
          .innerJoin(
            schema.clientProfiles,
            eq(schema.clientProfiles.id, schema.workoutSessions.clientId),
          )
          .where(
            and(
              inArray(schema.workoutSessions.id, ids),
              eq(schema.clientProfiles.formerCoachId, coachProfileId),
              gt(schema.clientProfiles.detachedAt, FORMER_COACH_GRACE_WINDOW),
            ),
          ),
      ),
  },

  // `set_logs` carries `client_id` but not `coach_id` (DB§5.2) — DB§6 says
  // "coach_id *and/or* client_id", so the coach branch joins one level to
  // `client_profiles`, never further, per step 3's two shapes.
  setLog: {
    coachOwnedIds: async (db, { coachProfileId }, ids) =>
      idsOf(
        await db
          .select({ id: schema.setLogs.id })
          .from(schema.setLogs)
          .innerJoin(schema.clientProfiles, eq(schema.clientProfiles.id, schema.setLogs.clientId))
          .where(
            and(inArray(schema.setLogs.id, ids), eq(schema.clientProfiles.coachId, coachProfileId)),
          ),
      ),
    clientOwnedIds: async (db, { clientProfileId }, ids) =>
      idsOf(
        await db
          .select({ id: schema.setLogs.id })
          .from(schema.setLogs)
          .where(
            and(inArray(schema.setLogs.id, ids), eq(schema.setLogs.clientId, clientProfileId)),
          ),
      ),
    // Same training-history grant as workoutSession, one join further.
    formerCoachOwnedIds: async (db, { coachProfileId }, ids) =>
      idsOf(
        await db
          .select({ id: schema.setLogs.id })
          .from(schema.setLogs)
          .innerJoin(schema.clientProfiles, eq(schema.clientProfiles.id, schema.setLogs.clientId))
          .where(
            and(
              inArray(schema.setLogs.id, ids),
              eq(schema.clientProfiles.formerCoachId, coachProfileId),
              gt(schema.clientProfiles.detachedAt, FORMER_COACH_GRACE_WINDOW),
            ),
          ),
      ),
  },

  meal: {
    coachOwnedIds: async (db, { coachProfileId }, ids) =>
      idsOf(
        await db
          .select({ id: schema.meals.id })
          .from(schema.meals)
          .where(and(inArray(schema.meals.id, ids), eq(schema.meals.coachId, coachProfileId))),
      ),
    clientOwnedIds: async (db, { clientProfileId }, ids) =>
      idsOf(
        await db
          .select({ id: schema.meals.id })
          .from(schema.meals)
          .where(and(inArray(schema.meals.id, ids), eq(schema.meals.clientId, clientProfileId))),
      ),
    // Nutrition is excluded from the grace window outright — access ends
    // immediately on detachment, no 30-day read-only period at all
    // (`account-lifecycle/06`'s transition table).
    formerCoachOwnedIds: null,
  },

  // The one kind with two independent client-side conditions (step 8):
  // DB§5.4 gives it a nullable `coach_id`/`client_id` alongside
  // `owner_user_id` — a coach's own demo video has no client, and a
  // client's own not-yet-tagged upload has no `client_id` set either. Both
  // conditions are written; do not "simplify" to one.
  mediaAsset: {
    coachOwnedIds: async (db, { coachProfileId }, ids) =>
      idsOf(
        await db
          .select({ id: schema.mediaAssets.id })
          .from(schema.mediaAssets)
          .where(
            and(
              inArray(schema.mediaAssets.id, ids),
              eq(schema.mediaAssets.coachId, coachProfileId),
            ),
          ),
      ),
    clientOwnedIds: async (db, { clientProfileId, userId }, ids) =>
      idsOf(
        await db
          .select({ id: schema.mediaAssets.id })
          .from(schema.mediaAssets)
          .where(
            and(
              inArray(schema.mediaAssets.id, ids),
              or(
                eq(schema.mediaAssets.clientId, clientProfileId),
                eq(schema.mediaAssets.ownerUserId, userId),
              ),
            ),
          ),
      ),
    // Form-check videos keep the 30-day window; progress photos never do,
    // regardless of window (`account-lifecycle/06`'s transition table,
    // `CLAUDE.md` §21.1). The `NOT EXISTS` is the only way to tell the two
    // apart — both live in this same table with no `kind`/`purpose` column
    // to switch on; a `progress_photos` row pointing at this asset is what
    // makes it a photo.
    formerCoachOwnedIds: async (db, { coachProfileId }, ids) =>
      idsOf(
        await db
          .select({ id: schema.mediaAssets.id })
          .from(schema.mediaAssets)
          .innerJoin(
            schema.clientProfiles,
            eq(schema.clientProfiles.id, schema.mediaAssets.clientId),
          )
          .where(
            and(
              inArray(schema.mediaAssets.id, ids),
              eq(schema.clientProfiles.formerCoachId, coachProfileId),
              gt(schema.clientProfiles.detachedAt, FORMER_COACH_GRACE_WINDOW),
              notExists(
                db
                  .select({ one: sql`1` })
                  .from(schema.progressPhotos)
                  .where(eq(schema.progressPhotos.assetId, schema.mediaAssets.id)),
              ),
            ),
          ),
      ),
  },

  // `comments` is polymorphic (DB§5.4/DB§10) with no reliable path from a
  // comment to its client except the denormalised `client_id` column — the
  // same one-join shape as `setLog` above, for the same reason.
  comment: {
    coachOwnedIds: async (db, { coachProfileId }, ids) =>
      idsOf(
        await db
          .select({ id: schema.comments.id })
          .from(schema.comments)
          .innerJoin(schema.clientProfiles, eq(schema.clientProfiles.id, schema.comments.clientId))
          .where(
            and(
              inArray(schema.comments.id, ids),
              eq(schema.clientProfiles.coachId, coachProfileId),
            ),
          ),
      ),
    clientOwnedIds: async (db, { clientProfileId }, ids) =>
      idsOf(
        await db
          .select({ id: schema.comments.id })
          .from(schema.comments)
          .where(
            and(inArray(schema.comments.id, ids), eq(schema.comments.clientId, clientProfileId)),
          ),
      ),
    // "Comments the coach left ... Read-only 30 days" — the transition
    // table's own words.
    formerCoachOwnedIds: async (db, { coachProfileId }, ids) =>
      idsOf(
        await db
          .select({ id: schema.comments.id })
          .from(schema.comments)
          .innerJoin(schema.clientProfiles, eq(schema.clientProfiles.id, schema.comments.clientId))
          .where(
            and(
              inArray(schema.comments.id, ids),
              eq(schema.clientProfiles.formerCoachId, coachProfileId),
              gt(schema.clientProfiles.detachedAt, FORMER_COACH_GRACE_WINDOW),
            ),
          ),
      ),
  },

  checkin: {
    coachOwnedIds: async (db, { coachProfileId }, ids) =>
      idsOf(
        await db
          .select({ id: schema.checkins.id })
          .from(schema.checkins)
          .where(
            and(inArray(schema.checkins.id, ids), eq(schema.checkins.coachId, coachProfileId)),
          ),
      ),
    clientOwnedIds: async (db, { clientProfileId }, ids) =>
      idsOf(
        await db
          .select({ id: schema.checkins.id })
          .from(schema.checkins)
          .where(
            and(inArray(schema.checkins.id, ids), eq(schema.checkins.clientId, clientProfileId)),
          ),
      ),
    // "Check-ins and their answers ... Read-only 30 days" — the transition
    // table's own words.
    formerCoachOwnedIds: async (db, { coachProfileId }, ids) =>
      idsOf(
        await db
          .select({ id: schema.checkins.id })
          .from(schema.checkins)
          .innerJoin(schema.clientProfiles, eq(schema.clientProfiles.id, schema.checkins.clientId))
          .where(
            and(
              inArray(schema.checkins.id, ids),
              eq(schema.clientProfiles.formerCoachId, coachProfileId),
              gt(schema.clientProfiles.detachedAt, FORMER_COACH_GRACE_WINDOW),
            ),
          ),
      ),
  },

  liveSession: {
    coachOwnedIds: async (db, { coachProfileId }, ids) =>
      idsOf(
        await db
          .select({ id: schema.liveSessions.id })
          .from(schema.liveSessions)
          .where(
            and(
              inArray(schema.liveSessions.id, ids),
              eq(schema.liveSessions.coachId, coachProfileId),
            ),
          ),
      ),
    // `client_id` is nullable — null for a group session (DB§5.4). Equality
    // against a real `clientProfileId` never matches a null column, so a
    // client probing a group session correctly gets `NOT_YOUR_CLIENT`
    // rather than a null-comparison surprise.
    clientOwnedIds: async (db, { clientProfileId }, ids) =>
      idsOf(
        await db
          .select({ id: schema.liveSessions.id })
          .from(schema.liveSessions)
          .where(
            and(
              inArray(schema.liveSessions.id, ids),
              eq(schema.liveSessions.clientId, clientProfileId),
            ),
          ),
      ),
    // Not named in `account-lifecycle/06`'s transition table — the safer
    // default is no grace window rather than inventing access it never
    // granted. Revisit as an explicit decision if a real need surfaces.
    formerCoachOwnedIds: null,
  },
};
