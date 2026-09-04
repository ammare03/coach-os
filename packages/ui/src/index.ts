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

// ── Small labelled shapes ───────────────────────────────────────────────
export { Chip, type ChipProps } from './components/Chip.tsx';
export { Badge, type BadgeProps, type BadgeSize, type BadgeTone } from './components/Badge.tsx';
export {
  SegmentedControl,
  type SegmentedControlProps,
  type SegmentOption,
  type SegmentedOptions,
} from './components/SegmentedControl.tsx';

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
