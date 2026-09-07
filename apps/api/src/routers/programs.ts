import { programs as programsSchemas } from '@coachos/schemas';

import { createProgramDay } from '../features/programs/create-program-day.ts';
import { createProgramExercise } from '../features/programs/create-program-exercise.ts';
import { createProgramWeek } from '../features/programs/create-program-week.ts';
import { createProgram } from '../features/programs/create-program.ts';
import { deleteProgramDay } from '../features/programs/delete-program-day.ts';
import { deleteProgramExercise } from '../features/programs/delete-program-exercise.ts';
import { deleteProgramWeek } from '../features/programs/delete-program-week.ts';
import { getProgramDay } from '../features/programs/get-program-day.ts';
import { getProgram } from '../features/programs/get-program.ts';
import { reorderProgramExercises } from '../features/programs/reorder-program-exercises.ts';
import { setAlternatives } from '../features/programs/set-alternatives.ts';
import { setSupersetGroup } from '../features/programs/set-superset-group.ts';
import { updateProgramDay } from '../features/programs/update-program-day.ts';
import { updateProgramExercise } from '../features/programs/update-program-exercise.ts';
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
// `programDay` two, `programExercise` three
// (`../trpc/authz/resource-registry.ts`).
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
  // The day screen's single read (`program-builder/02`, frame 1b). Same
  // NOT_FOUND-after-ownership shape as `programs.get` below, and for the
  // same reason: a row deleted between the guard's lookup and this one must
  // not be distinguishable from a row that was never the caller's.
  get: coachProcedure
    .input(programsSchemas.getProgramDayInput)
    .use(ownsResource('programDay', (i: { programDayId: string }) => i.programDayId))
    .query(async ({ ctx, input }) => {
      const day = await getProgramDay(ctx.db, input.programDayId);
      if (!day) throw appError('NOT_YOUR_CLIENT', "We couldn't find that.", {});
      return day;
    }),

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

// The task document names these `programExercises.create`/`update`/
// `delete`; they land nested, as `programs.exercises.*`, for the same
// reason `weeks` and `days` did — `api-conventions` §6.1's router list has
// one entry for this whole domain.
//
// `create` is guarded on the DAY it is being added to and `update`/`delete`
// on the ROW itself; `exerciseId` is not an ownership question at all
// (`../trpc/authz/resource-fields.ts` records why) and is checked for
// visibility inside `createProgramExercise`.
const programExercisesRouter = router({
  create: coachProcedure
    .input(programsSchemas.createProgramExerciseInput)
    .use(ownsResource('programDay', (i: { programDayId: string }) => i.programDayId))
    .mutation(({ ctx, input }) => createProgramExercise(ctx.db, ctx.user.coachProfileId, input)),

  update: coachProcedure
    .input(programsSchemas.updateProgramExerciseInput)
    .use(ownsResource('programExercise', (i: { programExerciseId: string }) => i.programExerciseId))
    .mutation(async ({ ctx, input }) => {
      await updateProgramExercise(ctx.db, input);
    }),

  delete: coachProcedure
    .input(programsSchemas.deleteProgramExerciseInput)
    .use(ownsResource('programExercise', (i: { programExerciseId: string }) => i.programExerciseId))
    .mutation(async ({ ctx, input }) => {
      await deleteProgramExercise(ctx.db, input.programExerciseId);
    }),

  // `program-builder/03`'s drop. TWO guards, and both are load-bearing:
  // owning the day says nothing about the ids in the array, and
  // `ownsResource` is all-or-nothing over an array selector
  // (`../trpc/middleware/owns-resource.ts`), so a single foreign id refuses
  // the whole call. What neither guard can answer — that those ids are
  // exactly THIS day's blocks, none missing and none extra — is checked in
  // the resolver against the day's real contents.
  reorder: coachProcedure
    .input(programsSchemas.reorderProgramExercisesInput)
    .use(ownsResource('programDay', (i: { programDayId: string }) => i.programDayId))
    .use(
      ownsResource(
        'programExercise',
        (i: { orderedExerciseIds: string[] }) => i.orderedExerciseIds,
      ),
    )
    .mutation(({ ctx, input }) => reorderProgramExercises(ctx.db, input)),

  // `program-builder/04`'s grouping and ungrouping. The same two guards as
  // `reorder`, for the same two reasons: owning the day says nothing about
  // the ids in the array, and an array selector on `ownsResource` is
  // all-or-nothing, so one foreign id refuses the whole call. A group
  // spanning two days of this coach's OWN program is what neither guard can
  // see, and is refused in the resolver against the day's real contents.
  setSupersetGroup: coachProcedure
    .input(programsSchemas.setSupersetGroupInput)
    .use(ownsResource('programDay', (i: { programDayId: string }) => i.programDayId))
    .use(ownsResource('programExercise', (i: { exerciseIds: string[] }) => i.exerciseIds))
    .mutation(({ ctx, input }) => setSupersetGroup(ctx.db, input)),

  // `program-builder/05`'s commit. ONE guard, not two, and the asymmetry
  // is the whole point: `programExerciseId` names a row this coach either
  // owns or does not, which is `ownsResource`'s question — but
  // `alternativeExerciseIds` name LIBRARY rows, which nobody owns and
  // every coach may reference some of. That is a visibility question, the
  // same one `exerciseId` raises on `create`
  // (`../trpc/authz/resource-fields.ts` records why), and forcing it
  // through `ownsResource` would be answering it with the wrong model.
  //
  // It is answered instead by `visibleToCoach` inside the resolver,
  // resolved from `ctx.user.coachProfileId` rather than from anything the
  // caller sends — alongside the existence check that
  // `program_exercises.alternatives`, alone among DB§5.2's id columns, has
  // no foreign key to perform for it.
  setAlternatives: coachProcedure
    .input(programsSchemas.setAlternativesInput)
    .use(ownsResource('programExercise', (i: { programExerciseId: string }) => i.programExerciseId))
    .mutation(({ ctx, input }) => setAlternatives(ctx.db, ctx.user.coachProfileId, input)),
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
  exercises: programExercisesRouter,
});
