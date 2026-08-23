import { initTRPC } from '@trpc/server';
import superjson from 'superjson';

import { env } from '../env.ts';

import type { Context } from './context.ts';
import { createErrorFormatter } from './error-formatter.ts';

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
// `isDevelopment` is the one switch `02-error-formatter-and-codes.md` step 5
// requires: exactly `'development'` opens the verbose branch, anything else
// — including an unset or misspelled NODE_ENV — defaults to production.
const t = initTRPC.context<Context>().create({
  transformer: superjson,
  errorFormatter: createErrorFormatter({ isDevelopment: env.NODE_ENV === 'development' }),
});

export const router = t.router;
export const middleware = t.middleware;
export const mergeRouters = t.mergeRouters;
export const publicProcedure = t.procedure;
