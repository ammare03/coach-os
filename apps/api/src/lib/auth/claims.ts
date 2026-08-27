// The verified-token shape, factored out of `../../trpc/auth-verifier.ts`
// so `./access-token.ts` (which produces it) and `auth-verifier.ts` (which
// re-exports it as part of the P02 seam) can both depend on the type
// without a runtime circular import — `access-token.ts` imports this with
// `import type`, `auth-verifier.ts` imports the *function* from
// `access-token.ts`, and only one of those two edges exists at runtime.
export interface AuthClaims {
  userId: string;
  deviceId: string;
  expiresAt: Date;
}
