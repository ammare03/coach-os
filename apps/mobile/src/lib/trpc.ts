import { createTRPCReact } from '@trpc/react-query';
// Type-only, via the `api` workspace package — a value import would drag
// the Drizzle driver and Node builtins into the Metro bundle (CLAUDE.md
// §17.1 `verbatimModuleSyntax`).
import type { AppRouter } from 'api/src/routers/index.ts';

// The single export every feature's `api.ts` imports. No feature calls
// `fetch` directly.
export const api = createTRPCReact<AppRouter>();
