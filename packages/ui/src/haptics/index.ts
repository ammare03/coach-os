// The only file in this repository that may import `expo-haptics`.
//
// **These three, nowhere else.** `CLAUDE.md` §7.5 (now `ui-conventions` §5)
// sanctions exactly three haptics in the product:
//
//   | Trigger              | Haptic                                        |
//   |----------------------|-----------------------------------------------|
//   | A set was logged     | `impactAsync(ImpactFeedbackStyle.Light)`      |
//   | A session completed  | `notificationAsync(...Success)`               |
//   | Validation failed    | `notificationAsync(...Warning)`               |
//
// There is no fourth, and there is deliberately no generic
// `triggerHaptic(type)`. A generic function is how a three-haptic policy
// becomes a thirty-haptic one: each call site is individually defensible
// and the aggregate is noise the user mutes — at which point the three
// that mattered are gone too. So each function is named for its *use
// case*, not its waveform, and a fourth kind of feedback requires editing
// this file and this comment, which is a conversation rather than an
// import.
//
// **Adding a function here needs a product decision, not a code review.**
// `CLAUDE.md` §0 rule 7: product decisions belong to Ammar.
//
// Every call is fire-and-forget. A haptic is an accompaniment to something
// that already happened on screen; nothing may await it, and nothing may
// branch on whether it fired.
import * as Haptics from 'expo-haptics';

/**
 * Fires and forgets.
 *
 * The rejection is swallowed rather than reported, which is the one
 * deliberate exception to `code-conventions` §8's no-silent-catch rule: a
 * device with no taptic engine, a simulator, and web all reject here, and
 * none of that is actionable, reportable, or visible to the user. What is
 * NOT acceptable is leaving the rejection unhandled — an unhandled
 * rejection from logging a set is a Sentry entry per set, and on Android
 * it can surface as a redbox in development.
 */
function fire(trigger: () => Promise<void>): void {
  void trigger().catch(() => undefined);
}

/** One set logged. The client's hands are chalked and their eyes are on the bar. */
export function hapticSetLogged(): void {
  fire(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
}

/** A whole session finished. Fires once, at the end — never per exercise. */
export function hapticSessionComplete(): void {
  fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
}

/**
 * A form or a logged value was rejected. `Warning`, never `Error` — a
 * mistyped weight is a correction, not a failure, and `COPY.md` §CO2's
 * no-shame rule applies to what the phone does as much as to what it says.
 */
export function hapticValidationFailure(): void {
  fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning));
}
