import { programs as programsSchemas } from '@coachos/schemas';

import { createProgramDay } from '../features/programs/create-program-day.ts';
import { createProgramWeek } from '../features/programs/create-program-week.ts';
import { createProgram } from '../features/programs/create-program.ts';
import { deleteProgramDay } from '../features/programs/delete-program-day.ts';
import { deleteProgramWeek } from '../features/programs/delete-program-week.ts';
import { getProgram } from '../features/programs/get-program.ts';
import { updateProgramDay } from '../features/programs/update-program-day.ts';
import { updateProgram } from '../features/programs/update-program.ts';
import { appError } from '../lib/app-error.ts';
import { router } from '../trpc/init.ts';
import { coachProcedure, ownsResource } from '../trpc/procedures.ts';

// `list`/`duplicate`/`delete`/`assign` are filled by the remaining
// `program-builder`, `program-templates` and `assignment` features.
// `create` landed early because `phase-06-onboarding/coach-onboarding/03`
// needs it: a coach finishes onboarding with a real program, not a
// placeholder. `program-builder/01` adds `get`/`update` and the week/day
// hierarchy beneath them.
//
// **`weeks` and `days` are nested routers, not top-level `programWeeks` /
// `programDays` ones.** `api-conventions` §6.1's router list has exactly one
// entry for this domain, and the enumeration test already walks two levels
// (`coach.clients.list`). The task document's `programWeeks.create` naming
// is preserved as `programs.weeks.create`.
//
// Every procedure taking an id goes through `ownsResource`, chained AFTER
// `.input()` and never inlined in the resolver (`CLAUDE.md` §6.2). The
// three kinds resolve to the same owner by different routes:
// `program` reads `programs.coach_id`, `programWeek` joins one level to it,
// `programDay` two (`../trpc/authz/resource-registry.ts`).
const programWeeksRouter = router({
  create: coachProcedure
    .input(programsSchemas.createProgramWeekInput)
    .use(ownsResource('program', (i: { programId: string }) => i.programId))
    .mutation(({ ctx, input }) => createProgramWeek(ctx.db, input)),

  delete: coachProcedure
    .input(programsSchemas.deleteProgramWeekInput)
    .use(ownsResource('programWeek', (i: { programWeekId: string }) => i.programWeekId))
    .mutation(async ({ ctx, input }) => {
      await deleteProgramWeek(ctx.db, input.programWeekId);
    }),
});

const programDaysRouter = router({
  create: coachProcedure
    .input(programsSchemas.createProgramDayInput)
    .use(ownsResource('programWeek', (i: { programWeekId: string }) => i.programWeekId))
    .mutation(({ ctx, input }) => createProgramDay(ctx.db, input)),

  update: coachProcedure
    .input(programsSchemas.updateProgramDayInput)
    .use(ownsResource('programDay', (i: { programDayId: string }) => i.programDayId))
    .mutation(async ({ ctx, input }) => {
      await updateProgramDay(ctx.db, input);
    }),

  delete: coachProcedure
    .input(programsSchemas.deleteProgramDayInput)
    .use(ownsResource('programDay', (i: { programDayId: string }) => i.programDayId))
    .mutation(async ({ ctx, input }) => {
      await deleteProgramDay(ctx.db, input.programDayId);
    }),
});

export const programsRouter = router({
  // `ownsResource` has already established the row belongs to this coach,
  // so a null here is a row deleted between the guard's lookup and this
  // one. `NOT_YOUR_CLIENT` rather than a distinct "no such program": the
  // two must stay byte-identical or the pair becomes an existence oracle
  // (`ERRORS.md` ER§2.1).
  get: coachProcedure
    .input(programsSchemas.getProgramInput)
    .use(ownsResource('program', (i: { programId: string }) => i.programId))
    .query(async ({ ctx, input }) => {
      const program = await getProgram(ctx.db, input.programId);
      if (!program) throw appError('NOT_YOUR_CLIENT', "We couldn't find that.", {});
      return program;
    }),

  // `coachProcedure`, and no `ownsResource`: the owning coach is
  // `ctx.user.coachProfileId` and no id from `input` addresses a row this
  // caller might not own — `exerciseId` references the global library or
  // the caller's own custom exercises, and a foreign coach's custom
  // exercise id would fail the visibility check in `exercises.search`
  // before it could ever reach here.
  create: coachProcedure
    .input(programsSchemas.createProgramInput)
    .mutation(({ ctx, input }) => createProgram(ctx.db, ctx.user.coachProfileId, input)),

  update: coachProcedure
    .input(programsSchemas.updateProgramInput)
    .use(ownsResource('program', (i: { programId: string }) => i.programId))
    .mutation(async ({ ctx, input }) => {
      await updateProgram(ctx.db, input);
    }),

  weeks: programWeeksRouter,
  days: programDaysRouter,
});
