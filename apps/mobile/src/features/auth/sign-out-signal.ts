// A minimal pub/sub so `refresh-interceptor.ts` (this feature's network
// layer) can ask for a sign-out without importing the Zustand auth store —
// that store doesn't exist until `auth-client/04`, and having the network
// layer depend on it would invert the dependency this feature's task order
// establishes. `auth-client/04`'s store subscribes here instead.
type Listener = () => void;

const listeners = new Set<Listener>();

export function onSignOutRequired(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Called only when a refresh genuinely fails — the session is over, not retryable. */
export function signalSignOutRequired(): void {
  for (const listener of listeners) {
    listener();
  }
}
