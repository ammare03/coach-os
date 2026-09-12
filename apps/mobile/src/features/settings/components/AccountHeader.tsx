import {
  Avatar,
  Card,
  Pressable,
  SkeletonCircle,
  SkeletonText,
  Text,
  createThemedStyles,
  spacing,
  useTheme,
} from '@coachos/ui';
import { UserRound } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import { api } from '../../../lib/trpc.ts';

const AVATAR_DIAMETER = 48;

/**
 * Name, email, and avatar, read from `me.get` — and the one section on this
 * screen that is allowed to fail.
 *
 * `UI-UX.md` §UX4's boundary rule, applied to the screen a person opens in
 * order to *leave* the product: the rows beneath this never wait on it and
 * never inherit its failure. Sign out, delete account, and export have to
 * work when the network does not, so this degrades to a shaped fallback
 * with a retry and stops there.
 *
 * Read-only until `phase-11-media-pipeline/profile-editing/01` turns it
 * into the Profile row — `me.get` returns an `avatarAssetId`, not a URL, so
 * there is nothing to render a photo from yet and `Avatar`'s initials
 * fallback is the whole of the treatment today.
 */
export function AccountHeader() {
  const theme = useTheme();
  const themed = useThemedStyles();
  const { data, isPending, isError, refetch } = api.me.get.useQuery();

  if (isPending) {
    return (
      <Card elevation="raised">
        <View style={styles.row}>
          {/* One label for the whole region, never one per shape
              (`Skeleton`'s own contract, `accessibility` §2). */}
          <SkeletonCircle diameter={AVATAR_DIAMETER} accessibilityLabel="Loading your account" />
          <View style={styles.copy}>
            <SkeletonText size="h2" />
            <SkeletonText size="body-sm" lastLineWidth="72%" />
          </View>
        </View>
      </Card>
    );
  }

  if (isError || !data) {
    return (
      <Card elevation="raised">
        <View style={styles.row}>
          <View
            style={[styles.fallbackAvatar, themed.fallbackAvatar]}
            accessible={false}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            <UserRound size={24} color={theme.colors.fg.subtle} />
          </View>
          <View
            style={styles.copy}
            accessible
            accessibilityLabel="Your account. Details unavailable."
          >
            <Text size="h2">Your account</Text>
            {/* `COPY.md` §CO5 — say what happened, then what to do. No
                apology, no "Oops", and no blame. */}
            <Text size="body-sm" tone="muted">
              Your details didn&rsquo;t load
            </Text>
          </View>
          <Pressable
            onPress={() => void refetch()}
            accessibilityRole="button"
            accessibilityLabel="Retry loading your account"
            style={styles.retry}
          >
            <Text size="label" tone="warm">
              Retry
            </Text>
          </Pressable>
        </View>
      </Card>
    );
  }

  return (
    <Card elevation="raised">
      <View style={styles.row}>
        <Avatar name={data.name} userId={data.id} size="md" />
        {/* One accessible item: a name and an email read as two fragments
            otherwise, and neither is a control. */}
        <View style={styles.copy} accessible accessibilityLabel={`${data.name}, ${data.email}`}>
          <Text size="h2" numberOfLines={2}>
            {data.name}
          </Text>
          <Text size="body-sm" tone="muted" numberOfLines={2}>
            {data.email}
          </Text>
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(14),
  },
  copy: {
    flex: 1,
    minWidth: 0,
    gap: spacing(3),
  },
  fallbackAvatar: {
    width: AVATAR_DIAMETER,
    height: AVATAR_DIAMETER,
    borderRadius: AVATAR_DIAMETER / 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  // Negative margin so the visible label keeps its type size while the tap
  // target reaches the floor (`accessibility` §1) — grown, never shrunk.
  retry: {
    minHeight: 48,
    minWidth: 48,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing(8),
  },
});

const useThemedStyles = createThemedStyles((theme) => ({
  fallbackAvatar: {
    backgroundColor: theme.colors.bg.inset,
    borderColor: theme.colors.border.soft,
  },
}));
