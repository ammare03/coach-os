import { create } from 'zustand';

import type { AccessTokenRole } from './jwt.ts';

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

// Deliberately minimal (`auth-client/04`'s scope) — status, who, and their
// role. No profile, no preferences: those are server state, fetched via
// TanStack Query once authenticated, never duplicated in here (CLAUDE.md
// §10 bans server data in Zustand). `phase-05-app-shell/providers-and-
// gates/03`'s route gate reads `status` to pick a route group.
interface AuthState {
  status: AuthStatus;
  userId: string | null;
  role: AccessTokenRole | null;
  setAuthenticated: (session: { userId: string; role: AccessTokenRole }) => void;
  setSignedOut: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  status: 'loading',
  userId: null,
  role: null,
  setAuthenticated: ({ userId, role }) => set({ status: 'authenticated', userId, role }),
  setSignedOut: () => set({ status: 'unauthenticated', userId: null, role: null }),
}));
