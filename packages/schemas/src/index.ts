// Barrel — named exports only, one concern per module file (CLAUDE.md
// §17.3). Primitives export flat (`id`, `email`, …); every feature module
// exports as a namespace (`auth`, `workouts`, …) so two modules can each
// have, say, a `listInput` without colliding. Alphabetical, no logic — the
// same reasoning `api-scaffold/04`'s router registry gives for its own
// list applies here.
export * from './primitives.ts';

export * as auth from './auth.ts';
export * as billing from './billing.ts';
export * as checkins from './checkins.ts';
export * as client from './client.ts';
export * as coach from './coach.ts';
export * as comments from './comments.ts';
export * as exercises from './exercises.ts';
export * as habits from './habits.ts';
export * as live from './live.ts';
export * as me from './me.ts';
export * as media from './media.ts';
export * as messages from './messages.ts';
export * as metrics from './metrics.ts';
export * as notifications from './notifications.ts';
export * as nutrition from './nutrition.ts';
export * as programs from './programs.ts';
export * as workouts from './workouts.ts';
