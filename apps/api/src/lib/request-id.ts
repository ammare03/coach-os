import { uuidv7 } from 'uuidv7';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Adopting a well-formed inbound `x-request-id` is what lets P22's load
// balancer correlate a request across the edge and the app; anything
// malformed is replaced rather than trusted onto every log line.
export function resolveRequestId(inbound: string | null | undefined): string {
  if (inbound && UUID_RE.test(inbound)) {
    return inbound;
  }
  return uuidv7();
}
