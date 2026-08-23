import { router } from '../trpc/init.ts';

import { authRouter } from './auth.ts';
import { billingRouter } from './billing.ts';
import { checkinsRouter } from './checkins.ts';
import { clientRouter } from './client.ts';
import { coachRouter } from './coach.ts';
import { commentsRouter } from './comments.ts';
import { exercisesRouter } from './exercises.ts';
import { habitsRouter } from './habits.ts';
import { healthRouter } from './health.ts';
import { liveRouter } from './live.ts';
import { meRouter } from './me.ts';
import { mediaRouter } from './media.ts';
import { messagesRouter } from './messages.ts';
import { metricsRouter } from './metrics.ts';
import { notificationsRouter } from './notifications.ts';
import { nutritionRouter } from './nutrition.ts';
import { programsRouter } from './programs.ts';
import { workoutsRouter } from './workouts.ts';

// Data, not code — see routers/README.md for the pattern. `health` first,
// then every §6.1 top-level router alphabetically. No conditionals, no
// spreads, no dynamic imports: a merge conflict here should be a one-line
// conflict, and the reflective walk this feeds (../authorization-middleware/04)
// is only as complete as this list is honest.
export const appRouter = router({
  health: healthRouter,
  auth: authRouter,
  billing: billingRouter,
  checkins: checkinsRouter,
  client: clientRouter,
  coach: coachRouter,
  comments: commentsRouter,
  exercises: exercisesRouter,
  habits: habitsRouter,
  live: liveRouter,
  me: meRouter,
  media: mediaRouter,
  messages: messagesRouter,
  metrics: metricsRouter,
  notifications: notificationsRouter,
  nutrition: nutritionRouter,
  programs: programsRouter,
  workouts: workoutsRouter,
});

export type AppRouter = typeof appRouter;
