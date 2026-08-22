// DB§21: "weekly body metrics trending toward the client's goal" — a
// fat-loss client's weight trends down across the four weeks, a
// muscle-gain client's up (seed-and-fixtures/01's own Approach §10), giving
// `phase-18-habits-metrics-photos/body-metrics/02`'s weekly-averaged trend
// chart something meaningful even before real client usage exists.
import type { Transaction } from '../aggregates/types.ts';
import { bodyMetrics } from '../schema/coaching.ts';

import { dateStringFromAnchor, timestampFromAnchor } from './lib/dates.ts';
import { seedId } from './lib/deterministic-id.ts';
import { faker } from './lib/faker.ts';

// -28, -21, -14, -7, -1 — five weekly-ish readings across the same 4-week
// window training-history.ts and nutrition-history.ts use.
const READING_OFFSETS = [-28, -21, -14, -7, -1];

type ClientTrend = {
  clientKey: string;
  startWeightKg: number;
  weeklyDeltaKg: number; // negative = losing, positive = gaining
  startBodyFatPct: number;
  weeklyBodyFatDelta: number;
};

const TRENDS: ClientTrend[] = [
  {
    clientKey: 'client:1',
    startWeightKg: 68,
    weeklyDeltaKg: -0.4,
    startBodyFatPct: 28,
    weeklyBodyFatDelta: -0.3,
  }, // fat_loss
  {
    clientKey: 'client:2',
    startWeightKg: 79,
    weeklyDeltaKg: 0.3,
    startBodyFatPct: 16,
    weeklyBodyFatDelta: 0.05,
  }, // muscle_gain
  {
    clientKey: 'client:4',
    startWeightKg: 88,
    weeklyDeltaKg: -0.15,
    startBodyFatPct: 24,
    weeklyBodyFatDelta: -0.1,
  }, // health
  {
    clientKey: 'client:5',
    startWeightKg: 74,
    weeklyDeltaKg: -0.05,
    startBodyFatPct: 20,
    weeklyBodyFatDelta: 0,
  }, // other
];

/** Must run after `clients.ts`. */
export async function seedBodyMetrics(
  tx: Transaction,
  clientIdByKey: Map<string, string>,
): Promise<void> {
  const rows: (typeof bodyMetrics.$inferInsert)[] = [];

  for (const trend of TRENDS) {
    const clientId = clientIdByKey.get(trend.clientKey);
    if (!clientId) throw new Error(`seedBodyMetrics: no client id for ${trend.clientKey}`);

    for (const [weekIndex, offset] of READING_OFFSETS.entries()) {
      const weightKg =
        trend.startWeightKg +
        weekIndex * trend.weeklyDeltaKg +
        faker.number.float({ min: -0.3, max: 0.3, fractionDigits: 2 });
      const bodyFatPct = Math.max(
        1,
        trend.startBodyFatPct +
          weekIndex * trend.weeklyBodyFatDelta +
          faker.number.float({ min: -0.2, max: 0.2, fractionDigits: 2 }),
      );
      const recordedAt = timestampFromAnchor(offset, 7, 30);

      rows.push({
        id: seedId(`body_metric:${trend.clientKey}:${weekIndex}`),
        clientId,
        recordedAt,
        recordedDate: dateStringFromAnchor(offset),
        weightKg: weightKg.toFixed(2),
        bodyFatPct: bodyFatPct.toFixed(1),
        waistCm: faker.number.float({ min: 70, max: 95, fractionDigits: 1 }).toFixed(1),
        source: 'manual',
        clientLocalId: `body_metric:${trend.clientKey}:${weekIndex}`,
        // Explicit — see coach.ts's comment on the same pair.
        createdAt: recordedAt,
        updatedAt: recordedAt,
      });
    }
  }

  await tx.insert(bodyMetrics).values(rows);
}
