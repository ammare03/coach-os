import { Metric, Text, createThemedStyles, radius, spacing } from '@coachos/ui';
import { formatRelativeToNow } from '@coachos/utils';
import { memo } from 'react';
import { StyleSheet, View } from 'react-native';

import type { ClientFormCheck } from '../ClientVideosContract.ts';

// One cell of §8.3's form-check grid: the reserved frame, the duration, the
// unreviewed marker, and two caption lines.
//
// **The frame is a box P11 fills, not a picture P10 draws.** What renders here
// today is `DESIGN.md` §9's media placeholder — the recessed well with a
// caption naming what belongs there — and §9's rule about it is the one that
// matters: "never a fake photo". The placeholder is not scaffolding, either;
// it is the real treatment for a video still transcoding, which is exactly the
// state a client's newest upload is in for the minute a coach is most likely
// to look. `phase-11-media-pipeline/playback/` swaps ONE child of `frame` for
// an `expo-image` keyed on `thumbnailKey`, with `recyclingKey` and the
// blurhash placeholder (`frontend-performance` §5), and changes nothing else
// in this file.
//
// ⚠️ `DESIGN.md` §9 draws the placeholder as a 135° repeating hatch. React
// Native has no repeating gradient, and `expo-linear-gradient` can only fake
// one with a dozen hard stops — a dozen per tile, on a grid §19 budgets at
// ≥55fps. The port is the flat inset well plus §9's caption: the same
// elevation level, the same caption rule, without the per-frame cost.
//
// **No press handler, deliberately.** Playback is `phase-11-media-pipeline`
// and annotation is `phase-16-video-annotation`; a tap target that opens
// nothing is the failure the P10 README's Risks section names ("a genuinely
// inert, not broken, UI"). So the cell is one grouped, labelled, non-
// interactive element until there is somewhere for it to go — at which point
// it gains `Pressable`, a `button` role, and the 48×48 floor it already clears
// several times over.

export interface ClientVideosTileProps {
  video: ClientFormCheck;
  /** Injected so the relative caption is deterministic under test (`testing` §3). */
  now?: Date | undefined;
}

/**
 * `DESIGN.md` §1.4 puts the media frame on the 14–16px rung; `radius.card` is
 * that rung on the closed ladder (16). The grid's own 3:4 is portrait because
 * a form check is filmed on a phone propped against a rack, held the way a
 * phone is held — a 16:9 tile letterboxes every real upload.
 */
const FRAME_ASPECT_RATIO = 3 / 4;

/**
 * The second, non-colour channel for "unreviewed" — the border is the first,
 * and hue alone is a defect (`accessibility` §4, `DESIGN.md` §8). Both survive
 * greyscale; the word is also in the tile's accessibility label and in its
 * caption, so nothing here is the sole carrier of the state.
 */
const PIP_SIZE = 9;

export const ClientVideosTile = memo(function ClientVideosTile({
  video,
  now,
}: ClientVideosTileProps) {
  const themed = useThemedStyles();
  const isUnreviewed = !video.isReviewed;

  return (
    <View
      style={styles.cell}
      testID={`client-video-${video.mediaAssetId}`}
      accessible
      accessibilityLabel={describeFormCheck(video, now)}
    >
      <View
        style={[
          styles.frame,
          themed.frame,
          isUnreviewed ? themed.frameUnreviewed : themed.frameReviewed,
        ]}
      >
        {/* §9 — a caption naming what belongs there, never a fake photo and
            never a drawn figure. It is also the honest state while the
            transcode worker is still running. */}
        <Text size="micro" tone="subtle" style={styles.placeholder}>
          {PLACEHOLDER_CAPTION[video.processingStatus]}
        </Text>

        {video.durationSeconds === null ? null : (
          <View style={[styles.duration, themed.duration]}>
            {/* `Metric`, not `Text`: a timecode is a numeral, and numerals are
                Space Grotesk with tabular figures unconditionally (§1.2). */}
            <Metric value={formatDuration(video.durationSeconds)} size="micro" />
          </View>
        )}

        {isUnreviewed ? <View style={[styles.pip, themed.pip]} /> : null}
      </View>

      {/* `body-sm` (14/20) is the closed scale's step for §9's 13px caption;
          the meta line's 11/15 is `micro` exactly. */}
      <Text size="body-sm" numberOfLines={1} style={styles.name}>
        {describeSubject(video)}
      </Text>
      <Text size="micro" tone="subtle" numberOfLines={1}>
        {describeMeta(video, now)}
      </Text>
    </View>
  );
});

/** §9's placeholder caption, per status. Two words, because the frame is small. */
const PLACEHOLDER_CAPTION: Record<ClientFormCheck['processingStatus'], string> = {
  uploading: 'uploading',
  processing: 'processing',
  ready: 'video frame',
  failed: 'upload failed',
  deleted: 'removed',
};

/** "Back squat · set 3", "Form check" when the upload is tied to neither. */
export function describeSubject(video: ClientFormCheck): string {
  if (video.exerciseName === null) {
    return 'Form check';
  }
  if (video.setNumber === null) {
    return video.exerciseName;
  }
  return `${video.exerciseName} · set ${String(video.setNumber)}`;
}

/**
 * "2 days ago · not reviewed" / "7 days ago · reviewed, 2 comments".
 *
 * Facts, no verdict: "not reviewed" is a statement about the COACH's own
 * queue, which is the one place in the product a backlog may be named plainly
 * — it is never "overdue" and never about the client (`product-copy` §1, §3).
 */
export function describeMeta(video: ClientFormCheck, now?: Date): string {
  const when = formatRelativeToNow(video.capturedAt, now);

  if (!video.isReviewed) {
    return `${when} · not reviewed`;
  }
  if (video.commentCount === 0) {
    return `${when} · reviewed`;
  }
  const comments =
    video.commentCount === 1 ? '1 comment' : `${String(video.commentCount)} comments`;
  return `${when} · reviewed, ${comments}`;
}

/**
 * The whole cell as one sentence, because five fragments in the reading order
 * is what a grid of tiles becomes otherwise (`accessibility` §2). The duration
 * is read as words rather than as a timecode — "0:22" is announced by VoiceOver
 * as a time of day.
 */
export function describeFormCheck(video: ClientFormCheck, now?: Date): string {
  const duration =
    video.durationSeconds === null ? null : `${String(Math.round(video.durationSeconds))} seconds`;

  return [describeSubject(video), duration, describeMeta(video, now)]
    .filter((part): part is string => part !== null)
    .join('. ');
}

/** Seconds → "0:22". Floors, so a 22.9s clip never reads as 23 beside a 23s one. */
export function formatDuration(durationSeconds: number): string {
  const whole = Math.max(0, Math.floor(durationSeconds));
  const minutes = Math.floor(whole / 60);
  const seconds = whole % 60;
  return `${String(minutes)}:${String(seconds).padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  cell: { flex: 1, minWidth: 0 },
  frame: {
    aspectRatio: FRAME_ASPECT_RATIO,
    borderRadius: radius.card,
    borderWidth: 1,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholder: { textAlign: 'center' },
  duration: {
    position: 'absolute',
    bottom: spacing(7),
    left: spacing(7),
    paddingVertical: spacing(3),
    paddingHorizontal: spacing(8),
    borderRadius: radius.full,
    borderWidth: 1,
  },
  pip: {
    position: 'absolute',
    top: spacing(7),
    right: spacing(7),
    width: PIP_SIZE,
    height: PIP_SIZE,
    borderRadius: PIP_SIZE / 2,
  },
  name: { marginTop: spacing(7) },
});

const useThemedStyles = createThemedStyles((t) => ({
  frame: { backgroundColor: t.colors.bg.inset },
  // §8's warmth ramp carries "needs you"; the pip beside it is the second,
  // non-colour channel, so the distinction survives greyscale.
  frameUnreviewed: { borderColor: t.colors.brand.mid },
  frameReviewed: { borderColor: t.colors.border.strong },
  duration: {
    backgroundColor: t.colors.bg.DEFAULT,
    borderColor: t.colors.border.strong,
  },
  // §9's own "there is something here for you" mark — the dock badge — is the
  // brand ramp, not `urgent`. `urgent` is reserved for missed, overdue, and
  // destructive (§1.1), and a form check waiting in the coach's queue is none
  // of those: it is not the client being off plan, and colouring it as if it
  // were is exactly the misread §10.1 forbids. (The coach prototype draws this
  // pip in `urgent`; the `adherence-colors-only` rule is the later, binding
  // decision, and it lands on the right side of §10.1 here.)
  pip: { backgroundColor: t.colors.brand.DEFAULT },
}));
