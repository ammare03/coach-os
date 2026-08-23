import packageJson from '../../package.json' with { type: 'json' };
import { publicProcedure, router } from '../trpc/init.ts';

// The mount proof, not the Fly liveness probe — that stays the plain
// `GET /health` route in `index.ts`. This one proves the tRPC pipeline end
// to end for the mobile app and legitimately sits on the public allowlist
// (`../authorization-middleware/05-public-allowlist.md`).
export const healthRouter = router({
  ping: publicProcedure.query(() => ({
    status: 'ok' as const,
    serverTime: new Date(),
    version: packageJson.version,
  })),
});
