// `auth.linkAppleProvider` / `auth.linkGoogleProvider` (`social-sign-in/03`'s
// collision-resolution path) — called once the caller has already proven
// ownership of the account by signing in with its existing method
// (`protectedProcedure`, `../../routers/auth.ts`). `ctx.user.id` is the
// link target, never a client-supplied id — the whole point of requiring
// an authenticated session first (`03`'s Risks: "auto-linking on email
// match alone is the single most dangerous mistake available in this task").
import type { DbClient } from '@coachos/db';

import { linkProviderToUser, type SocialProvider } from '../../lib/social-auth-link.ts';

export async function linkSocialProvider(
  db: DbClient,
  userId: string,
  provider: SocialProvider,
  providerUid: string,
): Promise<void> {
  await db.transaction((tx) => linkProviderToUser(tx, userId, { provider, providerUid }));
}
