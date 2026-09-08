import { addNetworkStateListener, getNetworkStateAsync, type NetworkState } from 'expo-network';
import { create } from 'zustand';

/**
 * How long a connectivity change must hold before it reaches consumers.
 *
 * Cell handoffs and flaky gym Wi-Fi emit several transitions in under a
 * second (`connectivity/01` approach §3). Propagating each one would run
 * `connectivity/02`'s flush trigger on every micro-flicker and flash an
 * offline banner at a client mid-set. A trailing debounce collapses a burst
 * into a single settled value.
 */
export const CONNECTIVITY_DEBOUNCE_MS = 1_000;

interface ConnectivityState {
  isConnected: boolean;
  /** No-ops when the value is unchanged, so a flap that settles where it started notifies nobody. */
  setConnected: (isConnected: boolean) => void;
}

export const useConnectivityStore = create<ConnectivityState>((set, get) => ({
  // Optimistic. A cold start has no state until the first probe resolves, and
  // assuming offline there would flash a banner on every launch and make
  // `prefetch/03` skip its first pass. The failure mode of assuming online is
  // a request that fails and retries — which the outbox already handles.
  isConnected: true,
  setConnected: (isConnected) => {
    if (get().isConnected === isConnected) return;
    set({ isConnected });
  },
}));

/**
 * `isInternetReachable` is the signal consumers actually want — a captive
 * portal is "connected" and useless. iOS reports it identically to
 * `isConnected`; Android additionally requires a validated connection. An
 * unreadable state stays optimistic, for the same reason the initial value is.
 */
function toIsConnected(state: NetworkState): boolean {
  return state.isInternetReachable ?? state.isConnected ?? true;
}

let subscription: ReturnType<typeof addNetworkStateListener> | null = null;
let pendingTimer: ReturnType<typeof setTimeout> | null = null;
let probeSuperseded = false;

function scheduleUpdate(isConnected: boolean, debounceMs: number): void {
  if (pendingTimer) clearTimeout(pendingTimer);
  pendingTimer = setTimeout(() => {
    pendingTimer = null;
    useConnectivityStore.getState().setConnected(isConnected);
  }, debounceMs);
}

/**
 * Registers the one `expo-network` listener this app has, and never a second
 * one however many times it is called. Idempotent by design: the hook calls it
 * on mount so no provider wiring is required, and app start may call it
 * eagerly to shorten the window where the default value is showing.
 *
 * There is no matching stop — the listener lives as long as the app does.
 * Tearing it down when the last component unmounts would also silence
 * `connectivity/02`'s non-component subscriber.
 */
export function ensureConnectivityTracking(options: { debounceMs?: number } = {}): void {
  if (subscription) return;
  const debounceMs = options.debounceMs ?? CONNECTIVITY_DEBOUNCE_MS;

  subscription = addNetworkStateListener((event) => {
    probeSuperseded = true;
    scheduleUpdate(toIsConnected(event), debounceMs);
  });

  // Undebounced: the first reading is the cold-start correction, not a flap,
  // and delaying it by a second is exactly the banner flash the debounce is
  // meant to prevent. Dropped if a listener event already beat it, since that
  // event is the newer truth.
  void getNetworkStateAsync()
    .then((state) => {
      if (probeSuperseded) return;
      useConnectivityStore.getState().setConnected(toIsConnected(state));
    })
    .catch((error: unknown) => {
      // Not actionable and not a crash: the listener supplies the next
      // reading, and until then the optimistic default stands.
      console.warn('connectivity.initial_probe_failed', {
        message: error instanceof Error ? error.message : String(error),
      });
    });
}

/** Test-only teardown — clears the listener, any pending debounce, and the store. */
export function resetConnectivityForTests(): void {
  subscription?.remove();
  subscription = null;
  if (pendingTimer) clearTimeout(pendingTimer);
  pendingTimer = null;
  probeSuperseded = false;
  useConnectivityStore.setState({ isConnected: true });
}
