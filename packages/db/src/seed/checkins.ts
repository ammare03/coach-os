// DB§21: "4 submitted check-ins, 1 pending, 1 missed" — exactly the
// `checkin_status` values the acceptance criteria name (never `'reviewed'`,
// which exists in the enum but isn't part of this task's required count).
// `template_snapshot` is set on every row, matching `coaching-schema/03`'s
// requirement that it always be explicit, never left to a default.
import type { Transaction } from '../aggregates/types.ts';
import { checkinTemplates, checkins } from '../schema/coaching.ts';

import { dateStringFromAnchor, timestampFromAnchor } from './lib/dates.ts';
import { seedId } from './lib/deterministic-id.ts';

const TEMPLATE_FIELDS = [
  { key: 'weight', label: 'Current weight (kg)', type: 'number', required: true },
  {
    key: 'energy',
    label: 'Energy levels this week (1-5)',
    type: 'scale',
    min: 1,
    max: 5,
    required: true,
  },
  { key: 'sleep_hours', label: 'Average sleep hours per night', type: 'number', required: false },
  { key: 'notes', label: 'Anything else your coach should know?', type: 'text', required: false },
];

type CheckinDef = {
  key: string;
  clientKey: string;
  periodStartOffset: number; // days from anchor
  periodLengthDays: number;
  status: 'pending' | 'submitted' | 'missed';
};

const CHECKIN_DEFS: CheckinDef[] = [
  {
    key: 'checkin:maya:1',
    clientKey: 'client:1',
    periodStartOffset: -35,
    periodLengthDays: 6,
    status: 'submitted',
  },
  {
    key: 'checkin:maya:2',
    clientKey: 'client:1',
    periodStartOffset: -28,
    periodLengthDays: 6,
    status: 'submitted',
  },
  {
    key: 'checkin:maya:3',
    clientKey: 'client:1',
    periodStartOffset: -21,
    periodLengthDays: 6,
    status: 'submitted',
  },
  {
    key: 'checkin:maya:4',
    clientKey: 'client:1',
    periodStartOffset: -7,
    periodLengthDays: 6,
    status: 'pending',
  },
  {
    key: 'checkin:andre:1',
    clientKey: 'client:2',
    periodStartOffset: -28,
    periodLengthDays: 6,
    status: 'submitted',
  },
  {
    key: 'checkin:andre:2',
    clientKey: 'client:2',
    periodStartOffset: -14,
    periodLengthDays: 6,
    status: 'missed',
  },
];

/** Must run after `clients.ts` and `coach.ts`. */
export async function seedCheckins(
  tx: Transaction,
  coachProfileId: string,
  clientIdByKey: Map<string, string>,
): Promise<void> {
  const templateId = seedId('checkin_template:weekly-default');

  const templateCreatedAt = timestampFromAnchor(-400, 9);

  await tx.insert(checkinTemplates).values({
    id: templateId,
    coachId: coachProfileId,
    name: 'Weekly Check-in',
    cadence: 'weekly',
    dueWeekday: 0, // Sunday
    fields: TEMPLATE_FIELDS,
    isDefault: true,
    // Explicit — see coach.ts's comment on the same pair.
    createdAt: templateCreatedAt,
    updatedAt: templateCreatedAt,
  });

  const rows: (typeof checkins.$inferInsert)[] = [];

  for (const def of CHECKIN_DEFS) {
    const clientProfileId = clientIdByKey.get(def.clientKey);
    if (!clientProfileId) throw new Error(`seedCheckins: no client id for ${def.clientKey}`);

    const periodStart = dateStringFromAnchor(def.periodStartOffset);
    const periodEnd = dateStringFromAnchor(def.periodStartOffset + def.periodLengthDays);
    const submitted = def.status === 'submitted';

    rows.push({
      id: seedId(def.key),
      clientId: clientProfileId,
      coachId: coachProfileId,
      templateId,
      templateSnapshot: TEMPLATE_FIELDS,
      periodStart,
      periodEnd,
      status: def.status,
      responses: submitted
        ? {
            weight: 78.4,
            energy: 4,
            sleep_hours: 7,
            notes: 'Feeling strong this week, sleep has been consistent.',
          }
        : {},
      draftResponses: def.status === 'pending' ? { weight: 77.9 } : null,
      submittedAt: submitted
        ? timestampFromAnchor(def.periodStartOffset + def.periodLengthDays, 20)
        : null,
      coachSummary: submitted
        ? 'On track — keep the current split, small bump in calories next block.'
        : null,
      // Explicit — see coach.ts's comment on the same pair.
      createdAt: timestampFromAnchor(def.periodStartOffset, 9),
      updatedAt: submitted
        ? timestampFromAnchor(def.periodStartOffset + def.periodLengthDays, 20)
        : timestampFromAnchor(def.periodStartOffset, 9),
    });
  }

  await tx.insert(checkins).values(rows);
}
