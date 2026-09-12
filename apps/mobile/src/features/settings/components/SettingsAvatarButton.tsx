import { Avatar, Pressable, radius } from '@coachos/ui';
import { StyleSheet } from 'react-native';

import { api } from '../../../lib/trpc.ts';

/**
 * `ui-conventions` §5 and `accessibility` §1 put the floor at 48 — the
 * stricter of the two floors in the system, `tapTarget.MIN` being 44 — and
 * `Avatar size="md"` is exactly 48 across, so the circle IS the target and
 * nothing has to be grown around it. Pinned as a minimum anyway: if a later
 * phase swaps the size, the target must not silently follow it down.
 */
export const SETTINGS_AVATAR_TARGET = 48;

export interface SettingsAvatarButtonProps {
  onPress: () => void;
}

/**
 * The client's one way into settings — the avatar the Today hero screen's
 * wireframe already draws at the trailing end of the date header
 * (`docs/screens/client-today.md`).
 *
 * Three decisions it exists to hold:
 *
 * 1. **It is labelled "Settings", never the person's name.** The avatar is
 *    a picture of them; the control is a door to their account, and a
 *    screen reader announces the control. "Priya Raman, button" tells a
 *    VoiceOver user nothing about where the tap goes.
 * 2. **It never renders an empty circle.** `Avatar` draws a deterministic
 *    gradient plus initials under any photo, and `avatar-fallback.ts`
 *    substitutes a neutral glyph for a name it does not have yet — so a
 *    cold start with no signal shows a real button, not a hole.
 * 3. **No network dependency.** `me.get` is read from the TanStack Query
 *    cache, which survives a restart (`offline-sync`), and the button is
 *    fully usable before it resolves. Nothing here waits, retries, or shows
 *    a spinner: a settings door that only appears online is not a door.
 *
 * No `uri`: resolving `users.avatar_asset_id` to a signed URL is
 * `phase-11-media-pipeline`'s work, and the fallback renders underneath one
 * regardless.
 */
export function SettingsAvatarButton({ onPress }: SettingsAvatarButtonProps) {
  const me = api.me.get.useQuery();
  const userId = me.data?.id ?? 'pending';

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Settings"
      // On BOTH, the same call `ListRow` makes: the outer pressable is the
      // box the OS hit-tests, the inner animated view is the box the
      // content lays out in. Guaranteeing only one leaves the other free to
      // fall under the floor.
      containerStyle={styles.target}
      style={styles.target}
      testID="settings-avatar-button"
    >
      {/* `Avatar` hides itself from the reading order by contract — the
          pressable around it carries the one label. */}
      <Avatar name={me.data?.name ?? ''} userId={userId} size="md" recyclingKey={userId} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  target: {
    minWidth: SETTINGS_AVATAR_TARGET,
    minHeight: SETTINGS_AVATAR_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.full,
  },
});
