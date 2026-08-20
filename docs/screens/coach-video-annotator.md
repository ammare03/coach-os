# Video annotator

| | |
|---|---|
| **Route** | `(coach)/video/[id]` |
| **Pattern** | C · Focus mode (`UI-UX.md` §UX2) |
| **Density** | Coach — but focus-mode rules override density |
| **Built in** | `phase-16-video-annotation/` |

---

## Job

**Let a coach draw on a client's squat at frame 00:04.2 and say what to fix — in under 60
seconds.**

The differentiator. `CLAUDE.md` §23's ship gate 2 measures it directly: annotation used on
**>40% of uploaded videos**. If this screen is slow or fiddly, the product's central claim
fails at the exact moment a coach is deciding whether it beats WhatsApp.

---

## Wireframe

### Review state

```
┌────────────────────────────────────────────┐
│ ✕   Priya · Squat · 2d ago           ⋯     │  minimal chrome, auto-hides
├════════════════════════════════════════════┤
│                                            │
│                                            │
│              [ video ]                     │  ~65% of screen
│                                            │  tap to play/pause
│         ✎ drawn annotation                 │  overlay renders here
│                                            │
├════════════════════════════════════════════┤
│  ◀◀   ⏸   ▶▶        00:04.2 / 00:12.8     │  frame-step ◀◀ ▶▶ = ±1 frame
│  ▬▬▬▬●▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬     │  scrubber
│      │    │        │                       │  ticks = existing annotations
├────────────────────────────────────────────┤
│  [ ✎ Draw ]  [ 🎤 Voice ]  [ 💬 Note ]     │  three ways to give feedback
│  [ ⇄ Compare ]                             │  side-by-side with a past video
└────────────────────────────────────────────┘
```

### Drawing state

```
┌────────────────────────────────────────────┐
│ ✕  Paused at 00:04.2            Undo  Done │  ← exiting draw ≠ exiting screen
├════════════════════════════════════════════┤
│                                            │
│              [ video, paused ]             │  playback LOCKED while drawing
│                                            │
│                ╭─────╮                     │  drawn shapes
│                │  ↗  │                     │
│                ╰─────╯                     │
│                                            │
├════════════════════════════════════════════┤
│  ● ● ●   ─ ━ ▬    ✎  ↗  ○  ⌫              │  colour · width · tool
└────────────────────────────────────────────┘
```

**Three feedback modes, equal weight.** Drawing is not always the answer — sometimes a coach
wants to say one sentence at a timestamp. Voice notes are often the fastest and the most
personal, and hiding them behind a menu suppresses their use.

---

## Data contract

| Query | Key | Fires | Notes |
|---|---|---|---|
| Asset + signed URL | `['media', assetId]` | Mount | Signed URL ≤1h; Redis-cached 55m (`ARCHITECTURE.md` §A11) |
| Existing annotations | `['media', assetId, 'annotations']` | Mount, **parallel** | Renders scrubber ticks |
| Comment thread | `['comments', 'media_asset', assetId]` | Mount, parallel | |
| Compare candidates | `['client', clientId, 'media', { exercise }]` | **On Compare tap only** | Never at mount — most sessions never compare |

**Prefetch this screen aggressively.** From the client-detail "Needs your attention" row and
from the video list, prefetch on press-in. A coach tapping a form check should find the video
already resolving.

**Writes are optimistic.** An annotation appears instantly and syncs behind. A voice note
records locally and uploads through the resumable pipeline (`ARCHITECTURE-ESSENTIALS.md`
§E15) — the coach is never blocked on the upload.

---

## Boundaries

```
┌─ Header ───────────────┐  fails → "Video" + back; annotator still works
├─ Video player ─────────┤  PRIMARY — no video, no screen. Full error + retry.
├─ Annotation overlay ───┤  fails → video plays normally, drawing disabled with a note
├─ Scrubber ticks ───────┤  fails → scrubber works, ticks absent
└─ Comment thread ───────┘  fails → inline error; drawing and voice still work
```

**The rule that matters:** a coach must be able to give *some* feedback even if a section
failed. If annotations cannot load, voice and text notes still work. If comments fail to
load, new ones can still be posted.

---

## States

| State | Treatment |
|---|---|
| **Processing** | "Still processing — usually under a minute." Poll. Not an error (`ERRORS.md` `MEDIA_STILL_PROCESSING`). |
| **Processing failed** | "We couldn't process this video." → Retry · Delete. The client is told too. |
| **Expired retention** | "Past your plan's 30-day storage window." → See plans. **Never blame the client.** |
| **Loading** | Poster frame immediately, then the stream. Never a black rectangle. |
| **Offline** | Playback unavailable with an honest message. **Drafted annotations and voice notes queue** and send on reconnect. |
| **Forbidden** | `NOT_FOUND` treatment |

---

## Interactions

| Action | Behaviour |
|---|---|
| Tap video | Play/pause. Largest target on the screen. |
| Scrub | Follows the finger via worklet. Frame-accurate on release. |
| ◀◀ / ▶▶ | **±1 frame, accurate at 30fps** — the P16 exit gate |
| Draw | Pauses playback and **locks it**. Timestamp frozen at the paused frame. |
| Undo | Removes the last stroke. Repeatable. No confirm. |
| Done | Saves optimistically, returns to review, adds a scrubber tick |
| Voice | Hold to record, release to stop. Waveform while recording. Attached to the current timestamp. |
| Compare | Opens a picker of the same exercise's past videos → side-by-side, **synchronised scrub** |
| Tap a tick | Seeks to that annotation and shows it |

**Haptics:** `Light` on frame-step, so a coach stepping frames feels the granularity.

---

## Chrome

**The transport controls and the drawing palette are `<GlassSurface style="clear">` —
this is the best use of Liquid Glass in the product** (`DESIGN-SYSTEM.md` DS§12.1). Chrome
sitting over video is exactly what the material is for: the coach keeps seeing the frame while
the controls stay legible over it.

Three constraints:

- **`clear`, not `regular`** — more of the video should read through.
- **The toolbar is static chrome.** It does not track the scrubber or animate its geometry per
  frame (DS§12.6). Glass recomposites on geometry change, and this screen is already decoding
  video.
- **One `GlassSurfaceGroup`** wraps the transport row and the tool palette so they merge into a
  single material rather than compositing separately and failing to blend at their shared edge.

On Android, on iOS < 26, and under Reduce Transparency this is an opaque bar — which is the
correct outcome, not a degraded one. Annotation accuracy does not depend on the material.

---

## Performance

**Budget: video first frame < 1.5s. Frame-step accurate to ±1 frame at 30fps.**

- HLS with a poster frame served first (`ARCHITECTURE.md` §A8.3).
- Orientation normalised at transcode — **if this is wrong, annotations land rotated 90° on
  one platform** (`CLAUDE.md` §25.10). This is the single most expensive bug this screen can
  have, and it is fixed in the pipeline, not here.
- Drawing overlay is a Skia/Reanimated canvas on the UI thread. A JS-thread canvas will drop
  strokes.
- Annotations are stored as **vectors with a normalised coordinate space**, never rasterised —
  so they render correctly at any playback size and on both platforms.
- The compare view decodes two streams; drop both to a lower variant while side-by-side.

---

## Risks

**Rotated annotations.** iOS and Android disagree on capture orientation metadata. Normalise
at transcode and verify with a real capture from each platform — a simulator will not
reproduce it.

**Coordinate space.** Storing pixel coordinates means an annotation drawn on a phone is wrong
on a tablet and wrong in the compare view. Normalise to 0–1 against the video's intrinsic
dimensions.

**Hiding voice notes.** They are often the fastest feedback a coach can give and the most
personal thing a client receives. Equal weight with drawing.

**Blocking on upload.** A coach who must wait for a voice note to upload before continuing
will stop recording them.

**Frame-step drift.** "Roughly a frame" is not the gate. ±1 frame at 30fps, verified against a
counter video.
