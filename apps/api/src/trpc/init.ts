import { initTRPC } from '@trpc/server';
import superjson from 'superjson';

import type { Context } from './context.ts';

// The single `initTRPC` call in the codebase — a second one produces
// incompatible builders and errors that point at the procedure, not here.
// Transformer is superjson so Dates cross the wire as real Dates
// (api-conventions §10); calendar dates stay `yyyy-MM-dd` strings and must
// never be wrapped in `Date` (CLAUDE.md §17.4).
//
// Pinned to superjson 1.x, not the current 2.x: 2.x ships ESM-only with no
// `main` entry, which ts-jest's CommonJS transpile (jest.node.js) can't
// load. 1.x still ships a CJS build and the transformer API is unchanged.
//
// Error formatter: tRPC's default for now. `../error-and-validation/02-error-formatter-and-codes.md`
// replaces this argument without touching the rest of this file.
const t = initTRPC.context<Context>().create({
  transformer: superjson,
});

export const router = t.router;
export const middleware = t.middleware;
export const mergeRouters = t.mergeRouters;
export const publicProcedure = t.procedure;
