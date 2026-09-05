// `phase-05-app-shell/deep-linking/02`. Turns whichever of the three URL
// shapes actually arrived into one internal shape, so nothing downstream —
// the link table, the pending-link replay — ever has to care which form a
// link came in as.

/** The universal-link host registered in `app.config.ts` (`deep-linking/01`). */
export const UNIVERSAL_LINK_HOST = 'app.coachos.com';

/** The custom scheme registered in `app.config.ts` (`deep-linking/01`). */
export const APP_SCHEME = 'coachos';

/**
 * A link that is ours: path segments (decoded, no empties) plus the raw
 * query string. The query is deliberately NOT parsed — no link in §9.3 reads
 * one, and the only thing that currently carries it forward is the
 * placeholder routing for links whose real screen does not exist yet, which
 * wants it verbatim.
 */
export type ParsedDeepLink = {
  segments: readonly string[];
  /** `''` when there was none. Never carries the leading `?`. */
  query: string;
};

/** `decodeURIComponent` throws on a lone `%`, which a truncated link has. */
function decodeSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

/**
 * `exp://192.168.1.4:8081/--/invite/ABC` — how every link arrives in a dev
 * client or over a tunnel, where the app has no scheme of its own to be
 * launched by. Everything after `/--/` is the real path. Without this the
 * whole feature is untestable before a store build, which is the point at
 * which nobody tests it.
 */
const DEV_CLIENT_SEPARATOR = '/--/';

const SCHEME_PATTERN = /^([a-z][a-z0-9+.-]*):\/\//i;

/** The host out of an authority, minus any `user:pass@` and any `:port`. */
function hostOf(authority: string): string {
  const afterCredentials = authority.slice(authority.lastIndexOf('@') + 1);
  const colon = afterCredentials.indexOf(':');
  return (colon === -1 ? afterCredentials : afterCredentials.slice(0, colon)).toLowerCase();
}

/**
 * `null` means "not a CoachOS link" — a foreign scheme, another host, or a
 * URL mangled badly enough that no path can be read out of it. Every caller
 * treats that as "leave the app alone", never as an error: a link can arrive
 * truncated by a messaging app's preview generator, and the correct response
 * to that is a normal launch, not a crash (this task's Risks section).
 *
 * Deliberately hand-parsed rather than `new URL()`. React Native's `URL` is a
 * partial implementation whose handling of custom schemes differs from
 * Node's, so a Jest suite written against Node's would pass while the device
 * did something else — the exact class of bug this file exists to prevent.
 */
export function parseDeepLink(raw: string): ParsedDeepLink | null {
  const trimmed = raw.trim();
  if (trimmed === '') {
    return null;
  }

  let rest: string;
  const developmentIndex = trimmed.indexOf(DEV_CLIENT_SEPARATOR);
  const scheme = SCHEME_PATTERN.exec(trimmed);

  if (developmentIndex !== -1) {
    // Keep the separator's trailing slash so the path stays absolute.
    rest = trimmed.slice(developmentIndex + DEV_CLIENT_SEPARATOR.length - 1);
  } else if (scheme === undefined || scheme === null) {
    // Already a bare path — expo-router hands one over on some platforms,
    // and `+native-intent.ts`'s own re-entry looks like this too.
    rest = trimmed;
  } else {
    const protocol = (scheme[1] ?? '').toLowerCase();
    const afterScheme = trimmed.slice(scheme[0].length);

    if (protocol === APP_SCHEME) {
      // `coachos://invite/ABC` puts `invite` in the authority position and
      // `coachos:///invite/ABC` does not. Both are emitted in the wild, and
      // both mean the same thing once the empty segments are dropped below.
      rest = afterScheme;
    } else if (protocol === 'https' || protocol === 'http') {
      const separator = afterScheme.search(/[/?#]/);
      const authority = separator === -1 ? afterScheme : afterScheme.slice(0, separator);
      if (hostOf(authority) !== UNIVERSAL_LINK_HOST) {
        return null;
      }
      rest = separator === -1 ? '' : afterScheme.slice(separator);
    } else {
      return null;
    }
  }

  const hash = rest.indexOf('#');
  if (hash !== -1) {
    rest = rest.slice(0, hash);
  }

  const questionMark = rest.indexOf('?');
  const pathname = questionMark === -1 ? rest : rest.slice(0, questionMark);
  const query = questionMark === -1 ? '' : rest.slice(questionMark + 1);

  const segments: string[] = [];
  for (const part of pathname.split('/')) {
    if (part === '') {
      continue;
    }
    const decoded = decodeSegment(part);
    if (decoded === null) {
      return null;
    }
    segments.push(decoded);
  }

  return { segments, query };
}
