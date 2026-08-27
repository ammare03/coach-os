// Extracted from `../trpc/context.ts`'s own private helper so
// `../routes/internal/metrics.ts` (a plain Hono route, not a tRPC
// procedure — `observability/06-metrics-and-alerts.md`) can parse the same
// header the same way, without a second copy of this logic drifting from
// the first. This is generic `Authorization: Bearer <token>` extraction,
// not token verification — `../trpc/auth-verifier.ts`'s "nothing else
// parses a token" comment is about the JWT itself, which this file never
// touches.
export function parseBearerToken(header: string | null): string | null {
  if (!header?.startsWith('Bearer ')) {
    return null;
  }
  const token = header.slice('Bearer '.length).trim();
  return token.length > 0 ? token : null;
}
