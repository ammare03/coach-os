// The package barrel. Everything a screen may import from `@coachos/ui`
// appears here; nothing reaches into `src/components/*` directly.
//
// These are presentation components with no knowledge of the product —
// none imports tRPC, none knows what a client or a workout is, and none
// reads a route (`code-conventions` §1). The test of whether something
// belongs here is whether the marketing site could plausibly use it.

// ── Text ────────────────────────────────────────────────────────────────
// Words go through `Text`, numbers through `Metric`. No component in the
// product renders a raw React Native `Text` (`DESIGN.md` §1.2).
export { Text, type TextProps, type TextTone } from './components/Text.tsx';
export { Metric, type MetricProps } from './components/Metric.tsx';

// ── Pressables ──────────────────────────────────────────────────────────
export {
  Pressable,
  type PressableProps,
  type PressableRenderState,
} from './components/Pressable.tsx';
export {
  Button,
  resolveButtonVariantVisuals,
  type ButtonProps,
  type ButtonSize,
  type ButtonVariant,
} from './components/Button.tsx';
export { IconButton, type IconButtonProps, type IconButtonSize } from './components/IconButton.tsx';

// ── Surfaces ────────────────────────────────────────────────────────────
export { Card, type CardProps, type CardElevation } from './components/Card.tsx';
export { Divider, type DividerProps } from './components/Divider.tsx';
export {
  GlassSurface,
  GlassSurfaceGroup,
  type GlassSurfaceProps,
  type GlassSurfaceGroupProps,
  type GlassTint,
  type GlassTier,
} from './surfaces/GlassSurface.tsx';
export { useGlassAvailable, type GlassAvailability } from './surfaces/useGlassAvailable.ts';

// ── Forms ───────────────────────────────────────────────────────────────
export { Input, type InputProps, type InputState } from './components/Input.tsx';
export { FormField, type FormFieldProps } from './components/FormField.tsx';
// The core input of the workout logger. Controlled, one step size per
// instance, no internal value state — the contract is documented on the
// component and every consumer that wants a mode is asking for a slower
// logger (`ui-primitives-data/01`).
export { NumberStepper, type NumberStepperProps } from './components/NumberStepper.tsx';

// ── Overlays ────────────────────────────────────────────────────────────
// A sheet is for *doing* something; a modal is for *stopping* something.
// `CLAUDE.md` §7.5 bans the native `Alert`, and these are what make that
// rule followable.
export { Sheet, type SheetProps, type SheetSnap } from './components/Sheet.tsx';
export { SheetHeader, type SheetHeaderProps } from './components/SheetHeader.tsx';
export { SheetFooter, type SheetFooterProps } from './components/SheetFooter.tsx';
export { Modal, type ModalProps } from './components/Modal.tsx';
export { ConfirmModal, type ConfirmModalProps } from './components/ConfirmModal.tsx';

// ── Toasts ──────────────────────────────────────────────────────────────
// `CLAUDE.md` §7.5 / `ui-conventions` §5's undo rule, made real: a
// destructive action performs immediately and offers a five-second window —
// it does not ask first. A confirm dialog interrupts the flow and gets
// dismissed reflexively without being read; an undo toast is the opposite
// trade.
//
// The two exceptions §7.5 names — account deletion and client archival —
// use `ConfirmModal`'s typed confirmation above and never `useUndoToast`.
// Both are irreversible in a way five seconds cannot honestly cover.
//
// `ToastProvider` mounts once at the app root. The optimistic change is the
// caller's; the server mutation is deferred until the window closes, so
// `onUndo` only has to put local state back — there is nothing to reverse
// server-side.
export {
  ToastProvider,
  useToast,
  MAX_VISIBLE_TOASTS,
  TOAST_BOTTOM_OFFSET,
  TOAST_DEFAULT_DURATION_MS,
  type ToastProviderProps,
  type ToastContextValue,
  type ToastResolution,
  type ShowToastOptions,
} from './toast/ToastProvider.tsx';
export { Toast, type ToastProps, type ToastAction } from './toast/Toast.tsx';
export {
  useUndoToast,
  UNDO_WINDOW_MS,
  type UndoToastOptions,
  type ShowUndoToast,
} from './toast/useUndoToast.ts';

// ── Small labelled shapes ───────────────────────────────────────────────
export { Chip, type ChipProps } from './components/Chip.tsx';
export { Badge, type BadgeProps, type BadgeSize, type BadgeTone } from './components/Badge.tsx';
export {
  SegmentedControl,
  type SegmentedControlProps,
  type SegmentOption,
  type SegmentedOptions,
} from './components/SegmentedControl.tsx';

// ── Dates ───────────────────────────────────────────────────────────────
// Every date crossing this boundary is a `"yyyy-MM-dd"` string, never a JS
// `Date` — a `Date` is an instant, and an instant is a different calendar
// day either side of midnight (`code-conventions` §6).
export {
  Calendar,
  CALENDAR_CELL_GEOMETRY,
  type CalendarProps,
  type CalendarMarker,
  type CalendarRange,
} from './components/Calendar.tsx';
export type { WeekStart } from './components/calendar-grid.ts';

// ── Proportion of a target ──────────────────────────────────────────────
// Two components, deliberately not one with a `shape` prop: `ProgressRing`
// answers "how much of *this one* target is left?" (one value, one target,
// 1–4 per screen, drawn on a Skia canvas); `MacroBar` answers "how was
// *this day* composed?" (three values against each other, one per row,
// thirty rows per screen, three plain views). Neither may use
// `colors.state.*` — going over a calorie target is not an adherence
// signal and never renders red (`DESIGN.md` §7, §8).
export {
  ProgressRing,
  progressRingSweep,
  type ProgressRingProps,
  type ProgressRingSize,
  type ProgressRingSweep,
} from './components/ProgressRing.tsx';
export {
  MacroBar,
  macroBarSegments,
  macroBarFill,
  type MacroBarProps,
  type MacroSegments,
  type MacroBarFill,
} from './components/MacroBar.tsx';

// ── A line over time ────────────────────────────────────────────────────
// Two components, deliberately not one with a `variant` prop: `LineChart`
// is the full chart (axes, one reference line, touch-to-inspect, an
// optional second series); `Sparkline` is the axis-less, touch-less,
// state-less variant that sits in a list row, where `CLAUDE.md` §19 asks
// for ≥55fps over 100 rows and every capability it lacks is a capability
// that cannot cost a frame.
//
// Both refuse a `Date`. A point is a LOCAL CALENDAR DATE string, because a
// weigh-in stored as an instant and bucketed in the device's timezone puts
// a Sunday-night weigh-in on Monday for a coach in another country
// (`code-conventions` §6, `CLAUDE.md` §25.5). Any phase passing timestamps
// converts at its own boundary, never here.
//
// The two rules in `chartDomain.ts` are product decisions, not styling: the
// y-domain never anchors at zero, and a line is never drawn through a gap.
export {
  LineChart,
  type LineChartProps,
  type LineChartSeries,
  type LineChartSelection,
} from './components/LineChart.tsx';
export { Sparkline, type SparklineProps } from './components/Sparkline.tsx';
export {
  CHART_MIN_SPAN,
  DEFAULT_GAP_DAYS,
  chartSeriesShape,
  chartSummary,
  chartTrend,
  chartYDomain,
  type ChartDomain,
  type ChartPoint,
  type ChartSeriesShape,
  type ChartTrend,
} from './components/chartDomain.ts';

// ── Adherence ───────────────────────────────────────────────────────────
// The only components in `packages/ui` permitted to name `colors.state.*`
// (`DESIGN.md` §8, enforced by the `adherence-colors-only` lint rule). Both
// take a state NAME from `@coachos/utils`, never a score — the §8.2
// thresholds live in `adherenceState()` and nowhere else.
export {
  AdherenceDot,
  ADHERENCE_STATE_LABEL,
  type AdherenceDotProps,
  type AdherenceDotSize,
} from './components/AdherenceDot.tsx';
export {
  AdherenceDotRow,
  type AdherenceDotRowProps,
  type AdherenceDay,
  type AdherenceMetric,
} from './components/AdherenceDotRow.tsx';

// ── People ──────────────────────────────────────────────────────────────
export {
  Avatar,
  type AvatarProps,
  type AvatarSize,
  type AvatarPresence,
} from './components/Avatar.tsx';
export {
  AvatarStack,
  type AvatarStackProps,
  type AvatarStackPerson,
} from './components/AvatarStack.tsx';
export {
  getAvatarFallback,
  getAvatarInitials,
  type AvatarFallback,
} from './components/avatar-fallback.ts';

// ── Loading ─────────────────────────────────────────────────────────────
// `DESIGN.md` §5 forbids "spinners where a skeleton belongs". A skeleton is
// shaped like the content it stands in for and reserves that content's box,
// so nothing shifts when the data lands (`UI-UX.md` §UX4).
export { Skeleton, type SkeletonProps, type SkeletonRadius } from './components/Skeleton.tsx';
export { SkeletonText, type SkeletonTextProps } from './components/SkeletonText.tsx';
export { SkeletonCircle, type SkeletonCircleProps } from './components/SkeletonCircle.tsx';

// ── Screen states ───────────────────────────────────────────────────────
// `ui-conventions` §4 — every screen that loads data handles four states,
// and a blank screen is not one of them. `EmptyState` takes exactly ONE
// `primaryAction`, by type: the singular prop is what stops a later feature
// phase shipping an empty state with two competing next steps, or none.
export {
  EmptyState,
  type EmptyStateProps,
  type EmptyStateAction,
} from './components/EmptyState.tsx';

// `LoadingState` is the first of the four and the one with a hard rule
// behind it: `DESIGN.md` §5 forbids a spinner where a skeleton belongs, so
// this composes `Skeleton` shapes and has none at any shape. Its
// `accessibilityLabel` is required — it IS the loading region, and an
// unlabelled region is silent to a screen reader (`accessibility` §2).
export {
  LoadingState,
  type LoadingStateProps,
  type LoadingShape,
} from './components/LoadingState.tsx';

// Two components, deliberately not one with a `reason` prop. `CLAUDE.md`
// §9.2 requires an id-route to distinguish "this isn't here" from "this
// isn't yours to open", and collapsing them into a generic error is the
// shortcut a rushed feature takes — two components make the distinction
// the path of least resistance. Both compose `EmptyState`, so both inherit
// its single-action rule, and on both the recovery handler is REQUIRED:
// neither state may be a dead end.
//
// The one sanctioned overlap runs the other way and is decided at the API:
// `ERRORS.md` ER§2.1 makes another coach's resource return `NOT_FOUND`, so
// it renders `NotFoundState`. A real 403 there would confirm the resource
// exists and turn id-walking into an enumeration oracle.
export {
  NotFoundState,
  NOT_FOUND_COPY,
  type NotFoundStateProps,
} from './components/NotFoundState.tsx';
export {
  ForbiddenState,
  FORBIDDEN_COPY,
  type ForbiddenStateProps,
} from './components/ForbiddenState.tsx';

// ── Haptics ─────────────────────────────────────────────────────────────
// Three functions, and deliberately no generic `triggerHaptic`. `CLAUDE.md`
// §7.5 sanctions exactly three haptics in the product — `Light` on set
// logged, `Success` on session complete, `Warning` on validation failure —
// and naming each for its USE CASE rather than its waveform is what makes a
// fourth kind of feedback visible in review instead of arriving one
// defensible call site at a time. Nothing outside `src/haptics/index.ts`
// may import `expo-haptics`.
export {
  hapticSetLogged,
  hapticSessionComplete,
  hapticValidationFailure,
} from './haptics/index.ts';

// ── Theme ───────────────────────────────────────────────────────────────
export {
  ThemeProvider,
  type ThemeProviderProps,
  type ThemeContextValue,
} from './theme/ThemeProvider.tsx';
export { useTheme } from './theme/useTheme.ts';
export type { Scheme } from './theme/schemes.ts';
// Values, for the genuine non-Tailwind consumers — SVG fills, gradient
// stops, Reanimated colour targets. A component that reads these to build
// a `style` object is doing by hand what `className` does for free.
export {
  colors,
  radius,
  spacing,
  spacingSteps,
  density,
  tapTarget,
  elevation,
  glass,
  selectionPill,
  skeleton,
  duration,
  easing,
  stagger,
  scrim,
  fontFamily,
  fontSize,
  type Density,
  type ElevationLevel,
  type TextSize,
} from './theme/tokens.ts';
