# Better Auth adoption boundary

> `auth-server/01-better-auth-integration.md`. This is this task's real deliverable —
> the next five tasks in this feature read it as settled, not as a proposal.

## Decision: fallback taken. Better Auth is not installed.

`CLAUDE.md` §3.2 pinned Better Auth as the auth choice on the strength of its price
(free, self-hosted, forever — §3.4.3) versus Auth0/Clerk's per-MAU billing. That
comparison is still correct. What this task tested is a narrower question: can Better
Auth's own persistence model sit on top of `identity.*` (`DATABASE.md` DB§5.1) with zero
schema change. It cannot, and the reason is structural, not cosmetic.

Better Auth's core schema (`@better-auth/core/db`'s `getAuthTables`, inspected directly
in `node_modules` rather than assumed from docs — step 3's instruction to let a test
decide, not a feeling) requires:

| Better Auth field/table                                           | Type it expects                                            | DB§5.1 has                                                                                           | Why remapping `fieldName` doesn't fix it                                                                                                                                                                                                        |
| ----------------------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `user.emailVerified`                                              | `boolean`, not-null, default `false`                       | `users.email_verified_at timestamptz`                                                                | Better Auth's adapter reads/writes this column as a boolean at the SQL level. Pointing `fieldName` at `email_verified_at` renames the column reference; it does not make the driver stop sending `true`/`false` against a `timestamptz` column. |
| `user.image`                                                      | `string` (a URL)                                           | `users.avatar_asset_id uuid` (FK → `coaching.media_assets`)                                          | Same class of problem, plus a semantic one: Better Auth writes whatever URL a provider hands it, `avatar_asset_id` is a foreign key into our own media pipeline. Nothing in Better Auth resolves a URL to an asset row.                         |
| `account` table (credential storage, incl. `password`)            | A whole separate table, one row per credential/provider    | No `account` table in DB§5.1 — `users.password_hash` lives directly on the user row                  | Not a column rename. Better Auth's sign-up/sign-in handlers write `user` and `account` together as one operation; there is nowhere to point `account` at without creating the table, which is a migration this task is not allowed to generate. |
| `session` table                                                   | A whole separate table (`token`, `expiresAt`, `userId`, …) | No `sessions` table — `refresh_tokens` models rotation families (`family_id`, `replaced_by`) instead | Same as `account`: a required table with no DB§5.1 counterpart, and its actual shape (a single opaque token) can't express rotation-family reuse detection anyway (§21.2) — the schemas aren't compatible even in spirit.                       |
| `verification` table (password reset / email verification tokens) | A whole separate table                                     | No table — task 06 explicitly does not use one, per DB§5.1                                           | Same as above.                                                                                                                                                                                                                                  |

Every one of these was one of the four mismatches this task's own "Why this exists"
section predicted from reading the docs. Confirming them against the library's actual
`getAuthTables` source (not the marketing docs, which — as step 3 warns — "will always
suggest it should work") turned the prediction into the fallback condition: **the
mapping cannot pass without a migration.** No migration was generated, applied, or
committed by this task; `identity` is byte-identical to what P01 produced
(`pnpm db:generate` produces no pending migration after this task).

Better Auth was installed briefly to inspect its adapter and schema code directly, then
uninstalled. It appears nowhere in `apps/api/package.json`.

## The adoption boundary

| Concept                            | Decision                                                                                                                                                                                                                                         | Owner                                      |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------ |
| User persistence                   | **Not adopted.** Plain Drizzle queries against `identity.users`, same package/client every other feature already uses.                                                                                                                           | `02-password-hashing-and-user-creation.md` |
| Credential verification            | **Not adopted** (no `account` table to hold it). Argon2id, ours regardless — §21.2 requires it specifically, and no third-party default was ever going to satisfy that.                                                                          | `02-password-hashing-and-user-creation.md` |
| Session persistence                | **Not adopted.** `refresh_tokens` models rotation families; Better Auth's `session` table models one opaque token per session and has no reuse-detection concept.                                                                                | `04-refresh-token-rotation.md`             |
| Access tokens                      | **Not adopted.** JWTs issued and verified behind the P02 verifier seam (`apps/api/src/trpc/auth-verifier.ts`), using `jose` — already a `package.json` §3 entry as of this task.                                                                 | `03-access-token-issuance.md`              |
| Social provider token verification | **Adopted the _approach_ (verify against the provider's published JWKS), not the library.** `jose`'s `createRemoteJWKSet` does the JWKS fetch/cache/rotation handling Better Auth would otherwise have done; `provider-verification.ts` is ours. | this task                                  |
| Password-reset tokens              | **Not adopted.** No `verification` table exists in DB§5.1; task 06 defines its own storage.                                                                                                                                                      | `06-password-reset-via-resend.md`          |
| Rate limiting                      | **Not adopted.** P02 `rate-limiting` already owns it and uses the DB§15 keyspace; Better Auth's built-in limiter was never going to be reachable since Better Auth itself isn't installed.                                                       | P02                                        |
| Email delivery                     | **Not adopted.** Resend + React Email per §3.2.                                                                                                                                                                                                  | `06-password-reset-via-resend.md`          |

## `CLAUDE.md` reversal

§3.2's "Auth" row and §3.3's rejected-options list are updated in this same PR to record
this reversal, per the fallback path's own acceptance criterion. The replacement,
exactly as `01`'s Risks section anticipated: **`jose`** for JWT signing/verification and
provider JWKS handling, plus our own Drizzle queries. Not a second auth framework — the
whole point of taking the fallback deliberately, in writing, rather than half-adopting
a library that only ends up doing one thing.

## What this task actually shipped

- `provider-verification.ts` — `verifyAppleIdentityToken` / `verifyGoogleIdToken`, pure
  functions: a token in, a normalised claim or `null` out, no database access, no user
  creation.
- `config.ts` — the two cached remote JWKS clients (`jose.createRemoteJWKSet`, cached by
  key id, bounded by `jose`'s own cooldown so an unknown key id triggers at most one
  fetch per cooldown window) and the issuer/audience constants those verifiers check
  against.
- `env.ts` — `APPLE_SIGN_IN_CLIENT_ID`, `GOOGLE_SIGN_IN_CLIENT_IDS` added, fail-fast at
  boot like every other required variable. `JWT_SECRET` / `REFRESH_TOKEN_SECRET` already
  existed (added ahead of time by the scaffold) and are read here for the first time,
  by task 03 and 04 respectively — not by this task, which only confirms they're there.
