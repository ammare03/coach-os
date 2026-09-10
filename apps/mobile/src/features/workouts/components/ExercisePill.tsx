import { Text } from '@coachos/ui';
import { createThemedStyles, radius, spacing } from '@coachos/ui/theme';
import { View } from 'react-native';

// A static 12px label on glass, four to a row (`today-card/DESIGN-SPEC.md`
// §2.3). **Deliberately not `Chip`** — that is a 33px interactive filter
// with a selection state and an `onRemove` target, and none of those three
// exist here. Local to this feature, and not promoted: §7 of the spec is
// explicit that it stays here (`code-conventions` §1 — promote on the
// second consumer).

export interface ExercisePillProps {
  label: string;
  /** The `+N more` pill: dashed, quieter, and not the name of anything. */
  muted?: boolean;
}

export function ExercisePill({ label, muted = false }: ExercisePillProps) {
  const themed = useThemedStyles();

  return (
    <View style={[themed.pill, muted && themed.pillMuted]}>
      {/* No `numberOfLines`: at 200% text a pill grows and the row wraps
          (`accessibility` §3). The row's own `flexWrap` is what absorbs it. */}
      <Text size="caption" tone={muted ? 'warm-muted' : 'warm'}>
        {label}
      </Text>
    </View>
  );
}

const useThemedStyles = createThemedStyles(({ control }) => ({
  pill: {
    paddingVertical: spacing(5),
    paddingHorizontal: spacing(10),
    borderRadius: radius.control,
    // §2.3's `rgba(19,26,41,.5)` — `bg.inset` at 50%, which is exactly the
    // `control.surface` composition, read from the active scheme.
    backgroundColor: control.surface,
    borderWidth: 1,
    // §2.3 writes this hairline at .12 and `control.border` composes the
    // same ink at .14. The token is used rather than a literal: two hundredths
    // of alpha is invisible, and an rgba literal here would bake in the
    // default brand ink and survive a white-label override.
    borderColor: control.border,
  },
  pillMuted: {
    borderStyle: 'dashed',
  },
}));
