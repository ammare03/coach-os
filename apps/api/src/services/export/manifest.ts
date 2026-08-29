// `account-lifecycle/09` — the archive's `manifest.json` and `README.txt`,
// and the format version both are stamped with. Kept separate from
// `../../jobs/data-export.ts` so the archive's own documented shape has one
// place to change, and from `collect.ts` so a collector never has to know
// anything about how its output gets written to disk.

/**
 * `manifest.json`'s `formatVersion` (Approach step 6). Bump this whenever
 * the archive's file layout or a section's field shape changes in a way
 * that would break a script written against an earlier export — never for
 * an addition that's purely new content in a new file. The first version
 * this feature ships is 1; there is no version 0.
 */
export const EXPORT_FORMAT_VERSION = 1;

/**
 * Every key `../../jobs/data-export.ts` ever writes into `export_requests
 * .row_counts` — the full set, across every role, not just the ones a
 * given export actually populates (a coach's `sessions` stays absent, not
 * zero, matching `../collect.ts`'s own null-vs-empty discipline). `account-
 * lifecycle/10`'s `me.exportStatus` divides how many of these keys are
 * present by this list's length to report real progress while the job is
 * still `building`, rather than an indeterminate spinner (Approach step 6).
 * Kept here, not duplicated in the router, so the two can never drift.
 */
export const EXPORT_ROW_COUNT_KEYS = [
  'sessions',
  'personalRecords',
  'programs',
  'meals',
  'dailySummaries',
  'waterLogs',
  'mealPlans',
  'mealPlanAssignments',
  'checkins',
  'bodyMetrics',
  'habits',
  'comments',
  'messages',
  'liveSessions',
  'coachNotes',
  'mediaAssets',
] as const;

export interface ExportManifest {
  formatVersion: number;
  generatedAt: string;
  role: 'coach' | 'client';
  counts: Record<string, number>;
}

export function buildManifest(
  role: 'coach' | 'client',
  counts: Record<string, number>,
): ExportManifest {
  return {
    formatVersion: EXPORT_FORMAT_VERSION,
    generatedAt: new Date().toISOString(),
    role,
    counts,
  };
}

/**
 * `README.txt` — the archive's plain-language explanation (Approach's own
 * "both JSON and a human-readable form" requirement). Written so a
 * non-technical person opening this on a laptop understands what they're
 * looking at without reading a schema — `product-copy` skill's plain-
 * language, no-jargon standard, applied to a document instead of a screen.
 * Video's link-not-bytes limitation is stated here plainly rather than
 * left for the user to discover (Approach step 4's own instruction).
 */
export function buildReadme(role: 'coach' | 'client'): string {
  const roleLine =
    role === 'coach'
      ? "This export contains your own CoachOS account data — your profile, the programs and meal plans you've authored, your notes, and your conversations. It does not contain any of your clients' training, nutrition, or photos — that data belongs to them and is in their own export, not yours."
      : 'This export contains your CoachOS account data — your profile, training history, nutrition diary, check-ins, body metrics, habits, comments, and messages.';

  return `CoachOS data export
====================

${roleLine}

What's in this folder
----------------------
- manifest.json: technical details about this export (format version, when it was generated, row counts per file).
- profile.json: your account details and preferences.
- training/: your workout history and (if you're a coach) the programs you've built.
- nutrition/: your meal diary and daily nutrition summaries (if applicable).
- coaching/: check-ins, body metrics, habits, comments, and messages.
- media/MANIFEST.json: a list of every photo and video associated with your account.

About photos and video
-----------------------
Photos are included directly in this archive, inside media/files/.

Video is NOT included as a file in this archive — video files can be very large, and
bundling them would make this export too big to download. Instead, media/MANIFEST.json
lists every video with a download link. Those links work for 7 days from when this
export was generated, matching how long this archive itself is available.

Questions
---------
If anything here looks wrong or incomplete, contact support from inside the CoachOS app.
`;
}
