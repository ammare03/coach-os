// `client-onboarding/05` — the one write the whole client onboarding flow
// makes. Steps 02–04 accumulate into the device's draft store and nothing
// reaches the server until here, so this receives the complete profile in
// one call rather than four partial ones (`GoalsStep.tsx` records that
// decision and why).
//
// ⚠️ The task's Files table names `apps/api/src/routers/client.ts`. That
// router is `clientApp.ts` in this repo, and deliberately: `createTRPCReact`
// reserves `.client` on its own returned object, so a top-level router
// literally named `client` silently corrupts every type the mobile hooks
// infer (`routers/index.ts` carries the full note). This lands in
// `clientAppRouter` instead — same procedure path from the app's point of
// view, `api.clientApp.updateProfile`.
import { schema, type DbClient } from '@coachos/db';
import type { client as clientSchemas } from '@coachos/schemas';
import { eq } from 'drizzle-orm';

export type UpdateClientProfileInput = clientSchemas.UpdateProfileInput;

export async function updateClientProfile(
  db: DbClient,
  clientProfileId: string,
  input: UpdateClientProfileInput,
): Promise<{ success: true }> {
  await db
    .update(schema.clientProfiles)
    .set({
      goal: input.goal,
      // Trimmed to empty by the schema when a client wrote nothing; stored
      // as NULL rather than '' so "no notes" is one value in the column,
      // not two.
      goalNotes: input.goalNotes.length === 0 ? null : input.goalNotes,
      dateOfBirth: input.dateOfBirth,
      sexAtBirth: input.sexAtBirth,
      // `numeric` columns cross Drizzle as strings (DB§11.2) — the schema
      // parsed the wire value to a number, and this is the one place it
      // goes back.
      heightCm: String(input.heightCm),
      experienceLevel: input.experienceLevel,
      ...(input.trainingDaysPerWeek === undefined
        ? {}
        : { trainingDaysPerWeek: input.trainingDaysPerWeek }),
      equipmentAccess: [...input.equipmentAccess],
      dietaryRestrictions: [...input.dietaryRestrictions],
    })
    .where(eq(schema.clientProfiles.id, clientProfileId));

  return { success: true } as const;
}
