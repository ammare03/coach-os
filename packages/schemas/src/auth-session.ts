// The output shapes `auth.signUp`, `auth.signIn`, and `auth.refresh`
// return. Deliberately separate from `./auth.ts`: this package's own
// `layout.test.ts` holds every §6.1 *input*-schema module to importing
// nothing but `zod` and `./primitives.ts`, and `conventions.test.ts` walks
// every export of those modules expecting strict, capped caller input — an
// output shape belongs here instead, exempt from both for the same reason
// `./pagination.ts`'s `pageOf()` is (that file's own doc comment).
import { z } from 'zod';

import { id, timezone } from './primitives.ts';

/**
 * What `signUp` and `signIn` both return on success. Deliberately minimal
 * (`auth-server/02`'s Produces section) — `me.get` is the full profile;
 * duplicating fields here creates a second copy to keep in sync. Not
 * `strictObject`: this is server-assembled output, not caller input.
 */
export const authSession = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresAt: z.iso.datetime(),
  deviceId: id,
  user: z.object({
    id,
    role: z.enum(['coach', 'client']), // never 'assistant' here — auth-server never issues one (P25 extends this)
    name: z.string(),
    timezone,
    onboardingCompletedAt: z.iso.datetime().nullable(),
  }),
});
export type AuthSession = z.infer<typeof authSession>;

/**
 * What a successful `auth.refresh` returns — a new access/refresh pair,
 * same shape as the `accessToken`/`refreshToken`/`expiresAt` fields of
 * {@link authSession}, minus `deviceId` (unchanged by rotation, so not
 * worth returning again) and `user` (rotation doesn't re-fetch the
 * profile; `me.get` is the one place for that).
 */
export const refreshOutput = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresAt: z.iso.datetime(),
});
export type RefreshOutput = z.infer<typeof refreshOutput>;
