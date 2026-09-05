import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { createThemedValue } from '../theme/createThemedStyles.ts';
import { fontSize, radius, type TextSize } from '../theme/tokens.ts';
import { useTheme } from '../theme/useTheme.ts';

import { buildAvatarPalette, getAvatarFallback } from './avatar-fallback.ts';
import { Text } from './Text.tsx';

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg';
export type AvatarPresence = 'online' | 'offline';

export interface AvatarProps {
  uri?: string;
  name: string;
  userId: string;
  blurhash?: string;
  size?: AvatarSize;
  presence?: AvatarPresence;
  /**
   * Defaults to `userId`. Without it, a recycled `FlashList` row briefly
   * shows the previous client's photo under the new client's name — a bug
   * that looks like a data leak in a product with a coach<->client
   * permission model (`ui-primitives-core/06`).
   */
  recyclingKey?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

// `ui-primitives-core/06`'s consumer table. Exported because `AvatarStack`
// draws its `+n` chip at exactly these sizes and the two must not drift.
export const AVATAR_DIAMETER: Record<AvatarSize, number> = { xs: 24, sm: 32, md: 48, lg: 72 };

export const AVATAR_TEXT_SIZE: Record<AvatarSize, TextSize> = {
  xs: 'micro',
  sm: 'caption',
  md: 'label',
  lg: 'title',
};

/**
 * The one `accessibility` §3 case where capping the scale is the right answer
 * rather than growing the box: an avatar is a fixed graphic whose diameter is
 * load-bearing for the row it sits in and for `AvatarStack`'s overlap maths,
 * so it cannot grow. The cap is the largest multiple of the size's own line
 * box that still fits inside the circle — never a blanket
 * `allowFontScaling={false}`, which would freeze the initials at 11px.
 */
export const AVATAR_MAX_FONT_SCALE: Record<AvatarSize, number> = {
  xs: fitScale('xs'),
  sm: fitScale('sm'),
  md: fitScale('md'),
  lg: fitScale('lg'),
};

function fitScale(size: AvatarSize): number {
  const lineBox = Number.parseFloat(fontSize[AVATAR_TEXT_SIZE[size]][1].lineHeight);
  return Math.max(1, Math.floor((AVATAR_DIAMETER[size] / lineBox) * 10) / 10);
}

const usePalette = createThemedValue(({ colors }) => buildAvatarPalette(colors.deep, colors.brand));

const PRESENCE_DIAMETER: Record<AvatarSize, number> = { xs: 8, sm: 9, md: 12, lg: 16 };
const PRESENCE_RING_WIDTH = 2;

/**
 * A remote image over an initials fallback, never the other way round —
 * the fallback (gradient + initials) renders unconditionally underneath,
 * so there is never a blank or grey frame while a photo loads or after it
 * fails (`ui-primitives-core/06` approach §2). `expo-image` decodes at the
 * size this component renders at (explicit `width`/`height` below), never
 * at whatever the server stored.
 *
 * **Not a touch target.** An avatar sits inside a pressable row and
 * inherits that row's tap target; it never grows its own hit area.
 *
 * **Accessibility contract.** Always hidden from the screen reader
 * (`accessibilityElementsHidden` / `importantForAccessibility="no"`) — an
 * avatar beside a name is redundant to VoiceOver/TalkBack. `AvatarStack`
 * is the one exception: it is the only representation of who is in a
 * group, so it carries its own single label.
 *
 * No avatar URL or name is ever logged or sent to analytics — both are
 * personal data (`CLAUDE.md` §21.1, §20).
 */
export function Avatar({
  uri,
  name,
  userId,
  blurhash,
  size = 'sm',
  presence,
  recyclingKey,
  testID,
  style,
}: AvatarProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const { colors } = useTheme();
  const palette = usePalette();
  const diameter = AVATAR_DIAMETER[size];
  const { initials, gradient } = getAvatarFallback(name, userId, palette);

  return (
    <View
      testID={testID}
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={[styles.base, { width: diameter, height: diameter, borderRadius: radius.full }, style]}
    >
      <LinearGradient
        colors={gradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      {/*
        Font scaling stays on (`accessibility` §3 — never disabled), but it is
        CAPPED per size: the circle cannot grow, so past `AVATAR_MAX_FONT_SCALE`
        the initials would be clipped by `overflow: 'hidden'` rather than
        merely crowded.
      */}
      <Text
        size={AVATAR_TEXT_SIZE[size]}
        tone="bright"
        numberOfLines={1}
        maxFontSizeMultiplier={AVATAR_MAX_FONT_SCALE[size]}
      >
        {initials}
      </Text>
      {uri && !imageFailed ? (
        <Image
          source={{ uri }}
          // `exactOptionalPropertyTypes` (`code-conventions` §3) forbids
          // passing `placeholder={undefined}` explicitly — `expo-image`'s
          // own type has no `undefined` member — so the prop is only
          // included at all when there is a real blurhash.
          {...(blurhash ? { placeholder: blurhash } : {})}
          placeholderContentFit="cover"
          contentFit="cover"
          transition={150}
          recyclingKey={recyclingKey ?? userId}
          cachePolicy="disk"
          onError={() => setImageFailed(true)}
          style={[StyleSheet.absoluteFill, { width: diameter, height: diameter }]}
        />
      ) : null}
      {presence ? (
        <View
          style={[
            styles.presenceRing,
            {
              width: PRESENCE_DIAMETER[size] + PRESENCE_RING_WIDTH * 2,
              height: PRESENCE_DIAMETER[size] + PRESENCE_RING_WIDTH * 2,
              borderRadius: radius.full,
              backgroundColor: colors.bg.DEFAULT,
            },
          ]}
        >
          {/*
            `online` fills solid; `offline` is a hollow ring on the same
            neutral. Colour alone never carries the state (CONTRACT.md
            rule 7) — filled vs hollow is the second channel.
          */}
          <View
            style={[
              {
                width: PRESENCE_DIAMETER[size],
                height: PRESENCE_DIAMETER[size],
                borderRadius: radius.full,
              },
              presence === 'online'
                ? { backgroundColor: colors.brand.DEFAULT }
                : {
                    backgroundColor: 'transparent',
                    borderWidth: 1.5,
                    borderColor: colors.fg.faint,
                  },
            ]}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  presenceRing: {
    position: 'absolute',
    right: -PRESENCE_RING_WIDTH,
    bottom: -PRESENCE_RING_WIDTH,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
