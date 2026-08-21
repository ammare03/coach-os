// Barrel — named exports only, one concern per module file (CLAUDE.md
// §17.3). Feature modules (auth.ts, workouts.ts, …) are added by the tasks
// that need them and re-exported here alongside primitives; none of them
// reorganises this file.
export * from './primitives.ts';
