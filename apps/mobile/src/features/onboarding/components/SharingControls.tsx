import {
  Card,
  Divider,
  LIST_ROW_MIN_HEIGHT,
  Pressable,
  SegmentedControl,
  Text,
  createThemedStyles,
  radius,
  spacing,
  useTheme,
  type SegmentedOptions,
} from '@coachos/ui';
import { Circle, CircleCheck, Lock } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { StyleSheet, Switch, View, useWindowDimensions } from 'react-native';

// `relationship-controls/03`. Design: `history-sharing.html` — the prop
// contract, frames A–C, F and G.
//
// The one control, rendered by BOTH surfaces that make this decision:
// invite acceptance (`ReturningClientInviteScreen`, `client-onboarding/01`)
// and **Settings → What {coach} can see**. Not a copy of the acceptance
// step — the same component, because 03's Approach step 1 is "a different
// shape here would read as a different permission", and a card on one
// surface and none on the other is exactly how two screens drift into
// being two controls. It therefore draws **no surface of its own**; each
// screen supplies its own container.
//
// It lives here rather than in either consumer because `code-conventions`
// §1 promotes on the second consumer, and this is the second: the decision
// it renders belongs to the invite flow (`client-onboarding/01`), which is
// what `features/onboarding/components/` already holds (`InviteCodeInput`,
// `OptionCard`). `src/components/` — the folder map's home for shared code
// — does not exist and is documented as "cross-feature PRIMITIVES only";
// this is product-aware, knows what a coach is, and is not one.
//
// Three things this file is deliberately responsible for:
//
// 1. **The never-shared block ships with the control.** Messages,
//    check-ins and progress photos from a previous coach have no setting.
//    `account-lifecycle/07` step 2 required that line at acceptance and
//    the acceptance screen never rendered it; exporting it from the same
//    module is what stops the omission recurring on a third surface.
// 2. **The 200% swap is the component's, not a screen's.** Past
//    `fontScale` 1.5 the segmented track becomes three selectable rows,
//    and both surfaces swap together — which is what "mirror" requires.
// 3. **No haptic anywhere.** `ui-conventions` §5 sanctions four triggers
//    and a settings toggle is none of them.

/**
 * The three options are the three timestamps that mean something (account
 * creation, twelve weeks back, now) — never a boolean, never a stored
 * duration (`account-lifecycle/07`'s Risks).
 */
export type HistorySharing = 'nothing' | 'twelve_weeks' | 'everything';

/**
 * Shipped labels and shipped order, not 03's prose ("Last 12 weeks ·
 * Everything · Nothing before today"). Three reasons, in order of weight:
 * changing them changes a screen a client has already agreed to; least →
 * most puts the product default in the middle rather than at an end; and
 * `SegmentedControl` pins its label to `numberOfLines={1}` in a ~122px
 * segment, where "Nothing before today" truncates at ordinary text size.
 * 03's sentence survives as {@link SHARING_COPY.helper}.
 */
export const HISTORY_OPTIONS: SegmentedOptions<HistorySharing> = [
  { value: 'nothing', label: 'Nothing' },
  { value: 'twelve_weeks', label: '12 weeks' },
  { value: 'everything', label: 'Everything' },
];

/**
 * Every string this control says, as module constants — one line each,
 * greppable, and ready to extract for localisation (`product-copy` §6).
 *
 * **Nothing here persuades.** No "recommended", no "most clients choose",
 * and no wording that makes sharing more sound better than sharing less:
 * training history, body metrics and food logs are Sensitive
 * (`CLAUDE.md` §21.1), and a nudge on a consent surface is a defect rather
 * than a conversion tactic.
 */
export const SHARING_COPY = {
  fieldLabel: 'Training history',
  helper: (coachFirstName: string) =>
    `Workouts and logged sets from before you joined ${coachFirstName}.`,
  metricsLabel: 'Body metrics',
  // NOT "Weight, measurements, progress photos." — see this file's header
  // and `SharingControls.test.tsx`. Photos are never shared under any
  // setting, so naming them here promised a coach something the server
  // does not give them.
  metricsHint: 'Your weight and measurements from before today.',
  nutritionLabel: 'Nutrition',
  nutritionHint: 'Your food diary and macro history from before today.',
  toggleHint: (coachFirstName: string) => `Changes what ${coachFirstName} can see`,
  neverSharedTitle: 'Never shared, whatever you choose',
  neverSharedBody:
    'Your messages, check-ins, and progress photos from a previous coach. There is no setting for these.',
} as const;

/**
 * A first name, and never `businessName`: both surfaces address a PERSON
 * ("what Marcus can see"), and a white-labelled gym brand in that sentence
 * would name the wrong party.
 *
 * Lives here because this module is what both sharing surfaces already
 * import. `LeaveCoachRow.tsx` carries an identical copy for its own
 * dialog — that file belongs to `relationship-controls/02` and is left
 * alone by this change; folding it into this one is a one-line follow-up,
 * not a reason to leave a third copy behind.
 */
export function coachFirstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? fullName;
}

/**
 * Past this OS font scale "Everything" (~152px at 30px type) no longer
 * fits a 121.6px segment, and `SegmentedControl` pins its label to
 * `numberOfLines={1}` — so it would truncate to "Everythi…", failing 03's
 * own "legible at 200%" criterion. 1.5 rather than 2.0 for the same reason
 * `SessionFiguresCard` picks it: the collision starts well before 200%.
 */
const RADIO_ROWS_FONT_SCALE = 1.5;

/** `DESIGN.md` §9's list-row glyph column, and the never-shared lock. */
const GLYPH_SIZE = 20;

export interface SharingControlsProps {
  /** First name only — never `businessName`; a gym brand names the wrong party. */
  coachFirstName: string;
  /** `null` selects no segment. The settings screen cannot always derive the stored choice, and a control claiming a state it does not know is worse than one claiming none. */
  historySharing: HistorySharing | null;
  onHistorySharingChange: (value: HistorySharing) => void;
  shareMetrics: boolean;
  onShareMetricsChange: (value: boolean) => void;
  shareNutrition: boolean;
  onShareNutritionChange: (value: boolean) => void;
  /**
   * Rendered directly beneath the history helper, above the toggles — the
   * settings screen's truth line, its forward-only note, and its write
   * error. Acceptance passes nothing: there is no "current" state to
   * report and no earlier decision to have narrowed.
   *
   * A slot rather than props because what goes here is three different
   * screen-owned blocks, and folding them in would give this component a
   * reason to know about mutations.
   */
  historyFooter?: ReactNode;
  /** True while a write is in flight. Every control refuses; nothing is hidden. */
  disabled?: boolean;
}

export function SharingControls({
  coachFirstName,
  historySharing,
  onHistorySharingChange,
  shareMetrics,
  onShareMetricsChange,
  shareNutrition,
  onShareNutritionChange,
  historyFooter,
  disabled = false,
}: SharingControlsProps) {
  const { fontScale } = useWindowDimensions();
  const asRadioRows = fontScale >= RADIO_ROWS_FONT_SCALE;

  return (
    <View style={styles.block}>
      <View style={styles.field}>
        {/* `header`, so a screen reader can jump straight to the control
            and hears the field named immediately before the group it
            labels (`accessibility` §2). */}
        <Text size="label" accessibilityRole="header">
          {SHARING_COPY.fieldLabel}
        </Text>

        {asRadioRows ? (
          <HistoryOptionRows
            value={historySharing}
            onChange={onHistorySharingChange}
            disabled={disabled}
          />
        ) : (
          <SegmentedControl
            options={HISTORY_OPTIONS}
            value={historySharing}
            onChange={onHistorySharingChange}
            testID="sharing-history-segmented"
          />
        )}

        {/* `muted` (5.6:1), not `subtle` (3.1:1) as the acceptance screen
            shipped it: on a privacy surface the helper is the control's
            definition, so `accessibility` §4's 4.5:1 body floor governs.
            One component, one choice — the acceptance screen changes with
            it. */}
        <Text size="body-sm" tone="muted">
          {SHARING_COPY.helper(coachFirstName)}
        </Text>
      </View>

      {historyFooter}

      <Divider />

      <ShareToggleRow
        label={SHARING_COPY.metricsLabel}
        hint={SHARING_COPY.metricsHint}
        coachFirstName={coachFirstName}
        value={shareMetrics}
        onChange={onShareMetricsChange}
        disabled={disabled}
        testID="sharing-toggle-metrics"
      />
      <ShareToggleRow
        label={SHARING_COPY.nutritionLabel}
        hint={SHARING_COPY.nutritionHint}
        coachFirstName={coachFirstName}
        value={shareNutrition}
        onChange={onShareNutritionChange}
        disabled={disabled}
        testID="sharing-toggle-nutrition"
      />
    </View>
  );
}

/**
 * The 200% shape. Three rows, `radio` inside a `radiogroup`, each label
 * verbatim from {@link HISTORY_OPTIONS} — an option renamed for the other
 * shape would be two vocabularies for one choice.
 */
function HistoryOptionRows({
  value,
  onChange,
  disabled,
}: {
  value: HistorySharing | null;
  onChange: (next: HistorySharing) => void;
  disabled: boolean;
}) {
  const theme = useTheme();
  const themed = useThemedStyles();

  return (
    <View style={styles.optionRows} accessibilityRole="radiogroup" testID="sharing-history-options">
      {HISTORY_OPTIONS.map((option) => {
        const checked = option.value === value;
        const Glyph = checked ? CircleCheck : Circle;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            disabled={disabled}
            accessibilityRole="radio"
            accessibilityLabel={option.label}
            accessibilityState={{ checked, disabled }}
            style={[themed.optionRow, { borderRadius: radius.card }]}
            testID={`sharing-history-${option.value}`}
          >
            {/* Decorative: the row's own label and checked state already
                say which option this is and whether it is chosen, so the
                glyph is the visual half of a fact already announced. */}
            <View
              accessible={false}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            >
              <Glyph
                size={GLYPH_SIZE}
                color={checked ? theme.colors.brand.DEFAULT : theme.colors.fg.faint}
              />
            </View>
            <Text size="label" tone={checked ? 'bright' : 'default'} style={styles.optionLabel}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * `ListRow.tsx` rule 1 and rule 2, applied to a row that is not a
 * `ListRow`: label and hint merge into one accessibility label (a row that
 * reads as two fragments is the failure `accessibility` §2 names), and the
 * WHOLE ROW is the switch. The thumb is 51×31 — under `accessibility` §1's
 * 48 floor — so it is drawn `pointerEvents="none"` and is never the target.
 *
 * Not `ListRow` itself: these two rows carry a two-line hint at body size
 * inside a form, where `ListRow`'s `caption` secondary line and 16pt
 * gutters are the settings-list rhythm rather than this one.
 */
function ShareToggleRow({
  label,
  hint,
  coachFirstName,
  value,
  onChange,
  disabled,
  testID,
}: {
  label: string;
  hint: string;
  coachFirstName: string;
  value: boolean;
  onChange: (next: boolean) => void;
  disabled: boolean;
  testID: string;
}) {
  const theme = useTheme();

  return (
    <Pressable
      onPress={() => onChange(!value)}
      disabled={disabled}
      accessibilityRole="switch"
      accessibilityLabel={`${label}, ${hint}`}
      accessibilityHint={SHARING_COPY.toggleHint(coachFirstName)}
      accessibilityState={{ checked: value, disabled }}
      style={styles.toggleRow}
      testID={testID}
    >
      <View style={styles.toggleText}>
        <Text size="label" tone={disabled ? 'faint' : 'default'}>
          {label}
        </Text>
        <Text size="body-sm" tone={disabled ? 'faint' : 'muted'} style={styles.toggleHint}>
          {hint}
        </Text>
      </View>
      {/* `trackColor`/`thumbColor` passed, and that is the point: a bare
          `<Switch>` draws the platform's system green, a hue `DESIGN.md`
          §1.1 does not contain ("the palette has NO GREEN"). The values are
          `ListRow`'s, so the two switch shapes in the product agree. */}
      <View
        pointerEvents="none"
        accessible={false}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Switch
          value={value}
          disabled={disabled}
          trackColor={{ false: theme.colors.bg.inset, true: theme.colors.brand.DEFAULT }}
          thumbColor={theme.colors.fg.glass}
          ios_backgroundColor={theme.colors.bg.inset}
        />
      </View>
    </Pressable>
  );
}

/**
 * The standing line, and the reason a client can trust the rest of the
 * screen. Placed by each surface — the settings screen pins it to the
 * floor behind a `flex:1` spacer so it reads as a statement rather than
 * fine print; acceptance puts it above the accept button.
 *
 * Deliberately **not** three disabled toggles: a greyed control implies a
 * control that could be un-greyed, and these three have no column to write
 * to (`account-lifecycle/07`'s table). The absence is the feature.
 *
 * L1 inset with a `strong` border: true before any query returns, true
 * after one fails, and never a skeleton.
 */
export function NeverSharedNote({ testID = 'sharing-never-shared' }: { testID?: string } = {}) {
  const theme = useTheme();
  const themed = useThemedStyles();

  return (
    <Card elevation="inset" padded={false}>
      <View
        style={themed.neverShared}
        accessible
        accessibilityLabel={`${SHARING_COPY.neverSharedTitle}. ${SHARING_COPY.neverSharedBody}`}
        testID={testID}
      >
        <View style={styles.neverSharedHeading}>
          <View
            accessible={false}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            <Lock size={16} color={theme.colors.fg.muted} />
          </View>
          {/* Full contrast, not muted: the heading is the promise, and a
              promise set in the disabled tone reads as a disclaimer. */}
          <Text size="label" style={styles.neverSharedTitle}>
            {SHARING_COPY.neverSharedTitle}
          </Text>
        </View>
        <Text size="body-sm" tone="muted">
          {SHARING_COPY.neverSharedBody}
        </Text>
      </View>
    </Card>
  );
}

// Scheme-invariant geometry only; every colour comes through `Text`'s
// tone, `useTheme()`, or `createThemedStyles` (`createThemedStyles`'
// contract). Every box is a `minHeight`/padding, never a `height` — at
// 200% a sentence grows instead of clipping (`accessibility` §3).
const styles = StyleSheet.create({
  block: { gap: spacing(18) },
  field: { gap: spacing(8) },
  optionRows: { gap: spacing(8) },
  optionLabel: { flex: 1 },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(14),
    // `accessibility` §1's floor, and `minHeight` rather than `height` so
    // the row grows around a wrapped hint at 200% instead of clipping it.
    minHeight: LIST_ROW_MIN_HEIGHT,
    paddingVertical: spacing(13),
  },
  toggleText: { flex: 1, minWidth: 0 },
  toggleHint: { marginTop: spacing(3) },
  neverSharedHeading: { flexDirection: 'row', alignItems: 'center', gap: spacing(8) },
  neverSharedTitle: { flex: 1 },
});

const useThemedStyles = createThemedStyles((theme) => ({
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing(12),
    minHeight: LIST_ROW_MIN_HEIGHT,
    paddingHorizontal: spacing(14),
    paddingVertical: spacing(13),
    backgroundColor: theme.colors.bg.raised,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border.DEFAULT,
  },
  neverShared: {
    gap: spacing(6),
    padding: spacing(14),
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border.strong,
  },
}));
