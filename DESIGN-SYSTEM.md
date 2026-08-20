# DESIGN-SYSTEM.md — CoachOS

> **The visual system: colour, type, space, elevation, density, motion, and icons.**
>
> The `ui-conventions` skill owns the *rules* an engineer follows while building a screen.
> This file owns the *values* those rules refer to and the reasoning behind them. When a
> token's value is in question, this file is the source; when a usage rule is in question,
> the skill is.
>
> `UI-UX.md` owns page composition and data flow. `COPY.md` owns the words.
> `docs/screens/` owns individual screen layouts.

---

## DS§0. The design brief

**Data-rich athletic, at two densities.**

The product reads like serious training software: large legible numerals, generous dark
canvas, colour used as information rather than decoration. Whoop and Apple Fitness are the
reference for how data is presented; Linear and Superhuman are the reference for how fast it
feels; Hevy is the reference for how a set gets logged.

Two densities, one system:

| | **Coach** | **Client** |
|---|---|---|
| Density | **Informative** — more per screen, never cramped | **Spacious** — one idea at a time |
| Read in | A 20-minute review block, seated | 30 seconds, mid-set, one-handed |
| Row height | 56px | 72px |
| Body text | 15pt | 17pt |
| Section gap | 16px | 24px |

> **"Informative, not cramped" is the brief for the coach app.** This is a coach-centric
> platform and the coach is the buyer. Density serves them — it must never tip into the
> spreadsheet feeling they are leaving behind. The test: a coach should be able to scan
> thirty client rows without leaning in, and should never feel the screen is shouting.

**Density is a prop, never a fork** (`ui-conventions` §1). One `Row`, one `Card`, one
`ListItem` — parameterised. A second component named `CoachRow` is a bug.

---

## DS§1. The judgement constraint on visuals

This is a design rule, not a copy rule, and it is the one thing that separates our visual
language from Whoop's.

**`COPY.md` §CO1 forbids the product from making a judgement about a person.** Whoop's
central visual device — a single score out of 100 summarising a human being — is exactly
that judgement, rendered as a ring.

So we take the *presentation language* and reject the *semantic*:

| ✓ Take | ✗ Reject |
|---|---|
| Large numerals for facts — `12,450 kg`, `4 of 5`, `62 min` | A composite "readiness" or "recovery" score |
| Arcs and rings showing **progress toward a target the coach set** | Rings showing a computed judgement of the person |
| Colour encoding **adherence state**, which is a defined formula | Colour encoding "how good you are" |
| Trend lines of raw logged data | Predictive or prescriptive overlays |
| A PR moment — a real, factual achievement | Congratulation or commiseration for a pattern |

**A ring in CoachOS always answers "how much of the thing you planned has happened?"** It
never answers "how are you doing?"

---

## DS§2. Colour

### DS§2.1 The structural decision

**The neutrals carry the design. The brand is an accent.**

`brand` is overridable per coach on Studio+ (white-label, `CLAUDE.md` §15.2). A coach can set
it to magenta. The app must still look deliberate.

That constraint forces a discipline that is good anyway: **brand appears on primary actions,
active navigation state, focus rings, and selected states — nothing else.** Every surface,
every border, every piece of text, and every chart baseline is neutral. Adherence colour is
semantic and is never overridden.

If you are reaching for brand colour to make a screen look less plain, the screen has a
hierarchy problem, not a colour problem.

### DS§2.2 Neutrals — dark (default theme)

A cool, slightly blue-black. Warmer greys read as dated; pure `#000` crushes elevation and
banding shows on OLED gradients.

| Token | Hex | Use |
|---|---|---|
| `bg.sunken` | `#06080B` | Behind scroll content, modal scrim base |
| `bg.base` | `#0A0D12` | App background |
| `bg.raised` | `#12161D` | Cards, list rows, tab bar |
| `bg.overlay` | `#1A1F28` | Sheets, menus, popovers |
| `bg.inset` | `#0E1218` | Inputs, wells, code-like surfaces |
| `border.subtle` | `#1E242E` | Row dividers |
| `border.default` | `#2A323F` | Card and input borders |
| `border.strong` | `#3A4553` | Focus rings, selected outlines |
| `fg.default` | `#F2F5F9` | Primary text — 16.1:1 on `bg.base` |
| `fg.muted` | `#97A2B4` | Secondary text — 7.2:1 |
| `fg.subtle` | `#5F6C7E` | Tertiary, placeholders — 4.6:1 |
| `fg.onBrand` | `#FFFFFF` | Text on a brand fill |

### DS§2.3 Neutrals — light

Not an inversion. Light mode needs its own ramp or it looks washed out.

| Token | Hex | Use |
|---|---|---|
| `bg.sunken` | `#EEF2F7` | Behind scroll content |
| `bg.base` | `#FFFFFF` | App background |
| `bg.raised` | `#FFFFFF` | Cards — separated by border, not fill |
| `bg.overlay` | `#FFFFFF` | Sheets, menus |
| `bg.inset` | `#F4F7FA` | Inputs, wells |
| `border.subtle` | `#EAEEF4` | Row dividers |
| `border.default` | `#D9E0EA` | Card and input borders |
| `border.strong` | `#B8C4D4` | Focus rings |
| `fg.default` | `#0A0D12` | Primary text — 18.4:1 |
| `fg.muted` | `#566274` | Secondary — 7.4:1 |
| `fg.subtle` | `#8794A6` | Tertiary — 3.4:1 — **decorative and placeholder only, never body text** |

> **The inversion trap.** In dark mode, elevation is expressed by getting *lighter*
> (`bg.base` → `bg.raised` → `bg.overlay`). In light mode, surfaces are all white and
> elevation is expressed by **border and shadow**, not by getting darker. A light theme built
> by inverting the dark ramp produces grey cards on a white page, which looks broken. See
> DS§5.

### DS§2.4 Brand

**Default: Indigo.** Chosen over blue deliberately — Trainerize, TrueCoach, and Everfit are
all blue, and it is the most generic choice in the category. Indigo reads as premium on a
dark canvas, sits far from every adherence hue, and does not collide with the realtime cyan.

| Step | Hex | Use |
|---|---|---|
| `brand.50` | `#EEF0FF` | Light-mode tint backgrounds |
| `brand.100` | `#E0E3FF` | |
| `brand.200` | `#C7CBFE` | |
| `brand.300` | `#A5A9FB` | Dark-mode text on dark |
| `brand.400` | `#868CF8` | Dark-mode icons |
| **`brand.500`** | **`#6366F1`** | **Default. Primary fill.** |
| `brand.600` | `#4F52E0` | Pressed |
| `brand.700` | `#4144BE` | |
| `brand.800` | `#373A9A` | |
| `brand.900` | `#31347A` | |

**White-label rule.** A coach supplies one hex; the ramp is **generated** from it, not stored.
Generate in `packages/utils` so the app and any future web surface agree, and clamp the
result: if the supplied colour fails 4.5:1 against `fg.onBrand`, darken the fill step until it
passes. A coach must not be able to make their own client's buttons unreadable.

### DS§2.5 Semantic colour — adherence

**Green, amber, and red mean adherence state and nothing else** (`ui-conventions` §2). Never
decorative, never a success toast, never a "save" button.

| Token | Dark | Light | Meaning |
|---|---|---|---|
| `state.onTrack` | `#10B981` | `#059669` | On or above plan |
| `state.drifting` | `#F59E0B` | `#D97706` | Slipping |
| `state.offTrack` | `#F43F5E` | `#E11D48` | Missed / off plan |
| `state.noData` | `#6B7280` | `#94A3B8` | **No data yet — never red** |

Two deliberate choices:

- **Emerald rather than pure green, rose-red rather than pure red.** Shifting green toward
  blue and red toward magenta widens the separation under deuteranopia and protanopia, the
  most common colour-vision deficiencies and precisely the red/green pairing.
- **`noData` is grey and is never rendered as `offTrack`.** A brand-new client with no logged
  sessions is not failing. Rendering them red on day one is the single most damaging
  first impression the coach app can make.

**Colour is never the only encoding.** `AdherenceDot` carries a shape as well:

```
●  on track      ◐  drifting      ○  off track      ◌  no data
   filled           half             outline           dashed
```

### DS§2.6 Other semantics

| Token | Dark | Light | Use |
|---|---|---|---|
| `realtime` | `#06B6D4` | `#0891B2` | Live session, presence, typing, active recording |
| `danger` | `#F43F5E` | `#E11D48` | Destructive **actions** only — same hue as `offTrack` by design, since both mean "this is bad" |
| `pr` | `#FBBF24` | `#D97706` | Personal record moments. **Only** here. |

> `pr` gold is the one purely celebratory colour in the product, and it is rationed to a
> single event so it keeps meaning something.

---

## DS§3. Typography

**Inter** (UI, body) and **Inter Tight** (numerals, display). Both SIL Open Font License —
`CLAUDE.md` §3.4.3 forbids a licensed font, and this pairing gives us a display face without
one.

### DS§3.1 Scale

| Name | Size / line | Face & weight | Use |
|---|---|---|---|
| `display` | 64 / 64 | Inter Tight 700 | The logger's weight readout. One per screen, ever. |
| `hero` | 48 / 48 | Inter Tight 700 | Ring centres, session summary headline metric |
| `metric` | 32 / 36 | Inter Tight 600 | Stat tiles |
| `metric-sm` | 24 / 28 | Inter Tight 600 | Inline stats, row-level numbers |
| `title` | 20 / 28 | Inter 600 | Screen titles |
| `heading` | 17 / 24 | Inter 600 | Section headings |
| `body` | 16 / 24 | Inter 400 | Default. **Client-app minimum.** |
| `body-sm` | 15 / 22 | Inter 400 | Coach-app body |
| `label` | 13 / 18 | Inter 500 | Field labels, chips, tab bar |
| `caption` | 12 / 16 | Inter 400 | Timestamps, footnotes. Never for anything essential. |

**Rules**

- **Never more than three sizes on one screen** (`ui-conventions` §3). A screen using five is
  a hierarchy failure wearing a typography costume.
- **`fontVariant: ['tabular-nums']` on every number that changes** — timers, weights, rep
  counts, volume. Without it digits jitter as they tick and the whole screen feels cheap.
- Numerals use Inter Tight; body uses Inter. Mixing them inside one sentence is fine —
  `12,450 kg this week` is Tight then Inter — and is the house look.
- Letter-spacing: `-0.02em` on `display`/`hero`/`metric`, `0` elsewhere. Large type needs
  tightening; body does not.
- **`allowFontScaling` stays on.** Everything must survive 200% (`ui-conventions` §8). The
  `display` size is the one at risk — cap its scale factor rather than let it clip.

---

## DS§4. Space and layout

4-point scale. `space.1` = 4px … `space.16` = 64px.

| Context | Coach | Client |
|---|---|---|
| Screen horizontal padding | 16 | 20 |
| Card padding | 12–16 | 16–20 |
| Section gap | 16 | 24 |
| List row height (single line) | 56 | 72 |
| List row height (two lines) | 68 | 84 |
| Gap between related items | 8 | 12 |
| Tap target minimum | **48 × 48, both** | **48 × 48, both** |

The tap target minimum does not scale with density. A coach's finger is the same size.

**Radius:** `sm` 8 · `md` 12 · `lg` 16 · `xl` 24 · `full` 999.
Cards `lg`, buttons and inputs `md`, chips and dots `full`, sheets `xl` top-only.

**Grid.** Stat tiles are a 2-column grid on phones, 3 on tablets. Never 3 on a phone — at
that width a metric truncates, and a truncated number is worse than no number.

---

## DS§5. Elevation

**Dark: lightness. Light: shadow and border.** Two different mechanisms, one API.

| Level | Dark | Light | Use |
|---|---|---|---|
| 0 | `bg.base` | `bg.base` | Screen |
| 1 | `bg.raised` | `bg.base` + `border.subtle` | Cards, rows |
| 2 | `bg.raised` + `border.default` | `bg.base` + shadow-sm + `border.subtle` | Interactive cards |
| 3 | `bg.overlay` | `bg.base` + shadow-md | Sheets, menus |
| 4 | `bg.overlay` + border + scrim | `bg.base` + shadow-lg + scrim | Modals |

Shadows in dark mode are near-invisible and cost GPU. **Do not render them there.** One
`<Surface level={n}>` primitive resolves the right mechanism per theme so no screen has to
know which one it is in.

Scrim: `rgba(0,0,0,0.6)` dark, `rgba(10,13,18,0.4)` light.

---

## DS§6. Motion

**Purposeful only** (`ui-conventions` §7). Motion communicates a state change. Nothing
animates to be pleasant.

### DS§6.1 Durations and curves

| Token | Duration | Curve | Use |
|---|---|---|---|
| `micro` | 120ms | ease-out | Press states, checkbox, toggle |
| `fast` | 180ms | ease-out | Chip select, tab switch, toast in |
| `standard` | 240ms | ease-out (enter) / ease-in (exit) | Screen push, card expand |
| `sheet` | spring `damping 22, stiffness 240` | — | Bottom sheets, drag-dismiss |
| `celebrate` | 420ms | spring `damping 14` | **PR only.** Once. |

Anything gesture-driven follows the finger with a spring; anything triggered by a tap uses a
duration. Mixing those is what makes an app feel unresponsive.

### DS§6.2 The permitted list

Motion exists in exactly these places:

1. **Screen transitions** — platform default push/pop. Do not customise.
2. **Shared element** — a client's avatar from the list into their detail header. One shared
   element per transition; more reads as chaotic.
3. **Sheets** — spring physics with drag-to-dismiss and real velocity.
4. **Press feedback** — 120ms scale to 0.97 plus opacity. On every tappable thing.
5. **Number transitions** — a metric that changes rolls to its new value over 180ms.
   **Never the logger's live weight readout**, which must be instant.
6. **Ring and bar fills** — animate on first appearance only, 240ms. Not on every re-render.
7. **Skeleton shimmer** — a slow, low-contrast sweep. Not a pulsing opacity, which reads as
   an error.
8. **Toast** — slide and fade, 180ms.
9. **PR celebration** — the one expressive moment. Fires once, never blocks the next set.

**Not on the list, therefore forbidden:** staggered list entrances (they delay the content on
the screen people open most), parallax headers, animated tab-bar icons, loading spinners that
spin decoratively, page-turn effects, anything on a scroll position that is not a worklet.

### DS§6.3 Non-negotiables

- **Reanimated worklets** for anything driven by scroll or gesture. JS-driven animation on the
  main thread drops frames on exactly the mid-range Android we budget for.
- **Respect reduced motion.** Replace movement with a cross-fade; never remove the state
  change itself. This app is used by people while physically exerting themselves, and
  vestibular sensitivity is real.
- **Never animate layout during set entry.** A number stepper that reflows while a thumb is
  on it is the worst possible interaction in this product.

---

## DS§7. Icons

**Lucide** (`lucide-react-native`) — ISC licensed, consistent 24px grid, comprehensive.

- Sizes: 16 (inline), 20 (default), 24 (nav and actions), 32 (empty states).
- Stroke 1.75 at 20–24px, 2 at 16px. Uniform stroke is what makes an icon set look like a set.
- **Icons are never the only label** on a primary action. An unlabelled icon row is a memory
  test.
- One icon per concept, product-wide. A registry in `packages/ui/icons.ts` maps semantic name
  → glyph, so "the video icon" is decided once.

---

## DS§8. Illustration and imagery

- **No illustration carries meaning.** Empty states are typography plus one icon; a decorative
  drawing that says what the text says is a translation and accessibility burden for nothing.
- **Progress photos are never decorative.** They appear only where the client explicitly put
  them, never in a header, a card background, or a share graphic.
- **Blurhash placeholders** on every remote image (`expo-image`), so a slow list never flashes
  grey boxes.
- **Avatars** fall back to initials on a deterministic neutral, never a random colour — a
  colour that changes between renders looks like a bug.

---

## DS§9. Component anatomy

Full inventory in `ui-conventions` §9. The three that carry the product:

### `NumberStepper` — the most important component in CoachOS

The core input of the workout logger, used mid-set with chalky hands.

```
┌─────────────────────────────────────────┐
│   ┌───────┐                 ┌───────┐   │
│   │   −   │    60.0  kg     │   +   │   │
│   └───────┘                 └───────┘   │
│    56×56      display 48     56×56      │
│                                          │
│   [ 2.5 ]  [ 5 ]  [ 10 ]   increments   │
└─────────────────────────────────────────┘
```

- Hit areas 56×56, larger than the 48 minimum. This one earns the extra.
- Long-press repeats with acceleration.
- Tapping the number opens a numeric keypad — never the full keyboard.
- Increments are **native to the unit** (2.5 kg / 5 lb), never converted
  (`DATABASE.md` DB§5.1.1).
- `Light` haptic on each step.
- **Never animates its own layout.** See DS§6.3.

### `StatTile`

```
┌──────────────────┐
│ SESSIONS         │  label · 13 · fg.muted · uppercase · 0.04em
│ 4 / 5            │  metric · 32 · Inter Tight · tabular
│ ●●●●○            │  optional micro-viz
└──────────────────┘
```

The atom of the data-rich look. Two per row on phones. The label is always a plain noun —
never a judgement (`COPY.md` §CO1).

### `AdherenceDot`

Colour plus shape (DS§2.5), with an `accessibilityLabel` carrying the word: "on track",
"drifting", "off track", "no data".

---

## DS§10. What this system rejects

Written down so they do not arrive later as "small improvements":

| Rejected | Why |
|---|---|
| Gradients on surfaces | Band on OLED, fight white-label, date quickly |
| **Emulated** glassmorphism — blur-behind faked on cards and content surfaces | Expensive on mid-range Android, hurts contrast. **Apple's native Liquid Glass on floating chrome is a different thing and is used — see DS§12.** |
| A composite score for a person | `COPY.md` §CO1 — the core constraint |
| Decorative use of green/amber/red | Destroys the scan-for-colour affordance the coach dashboard depends on |
| More than one accent hue per screen | Two accents means neither is an accent |
| Custom-drawn tab bars | Platform navigation is muscle memory; ours is not better |
| Emoji as UI | Render inconsistently across platforms and versions |
| A second font family | Two faces are the budget |
| Dark shadows in dark mode | Invisible, and they cost GPU |

---

## DS§12. Liquid Glass

**Apple's Liquid Glass, on iOS 26+, on floating chrome only.**

This is not a reversal of DS§10 — it is the distinction DS§10 was always drawing. What that
section rejects is *emulated* glassmorphism: faking a frosted surface with a blur layer behind
a card, which costs GPU on every frame, degrades contrast, and looks approximately right at
best. Liquid Glass is a **native material composited by the OS** — it refracts and reflects the
content behind it rather than blurring it, and on a device that supports it the cost is
effectively zero, because the system was going to composite that layer anyway.

The rule that keeps the two apart:

> **Glass is chrome that floats above content. It is never the content, and never the surface
> content sits on.**

### DS§12.1 Where it is used

| Surface | Style | Why it earns it |
|---|---|---|
| **Tab bar** — both apps | `regular` | Apple's flagship use. Content scrolls beneath and stays visible, which makes a 5-tab bar feel lighter than an opaque one. |
| **Navigation bar and back control** | `regular` | The `‹` and header actions float over scrolling content |
| **Video annotator toolbar** | `clear` | **The best use in the product.** Transport controls and the drawing palette sit over video; glass keeps the frame visible while the controls stay legible. |
| **Sheet header and grabber** | `regular` | The sheet's own top edge, over its scrolling content |
| **Toast** | `regular`, interactive | Floats over everything, briefly |
| **Live session controls** | `clear` | Same argument as the annotator — chrome over video |

`regular` is the default. `clear` is for chrome over video or imagery, where more of what sits
behind should read through.

### DS§12.2 Where it is forbidden

Each of these is a rule with a reason, not a preference.

| Never | Why |
|---|---|
| **The workout logger's set-entry surface** — stepper, weight readout, target line | Legibility beats beauty on the one screen used mid-set, one-handed, in bad gym lighting. It also runs 90 minutes with `expo-keep-awake` against a 25% battery budget (`CLAUDE.md` §19). |
| **Progress photos** | Glass over someone's body photos is both a contrast problem and a taste one |
| **Stat tiles, adherence dots, charts** | Glass tints shift perceived hue. The coach dashboard's entire scan-for-colour affordance depends on green/amber/red reading true (DS§2.5). |
| **Cards, list rows, any content surface** | This is the emulated-glassmorphism failure DS§10 rejects. Content sits on `bg.raised`. |
| **Glass over glass** | Apple's own guidance. Nesting compounds refraction into mud — use one container for adjacent elements instead. |
| **Anything on Android** | There is no native equivalent, and emulating it is precisely the expensive, low-contrast thing we rejected |

### DS§12.3 The three-way fallback

Glass is an **enhancement on one platform and one OS version**. Every glass surface resolves
through one primitive that answers three cases:

```
                    ┌─ iOS 26+, transparency allowed ──→  Liquid Glass
<GlassSurface> ─────┼─ iOS < 26, or Android ───────────→  bg.raised + border  (DS§5)
                    └─ Reduce Transparency ON ─────────→  bg.raised + border  (DS§5)
```

`expo-glass-effect`'s `isLiquidGlassAvailable()` decides the first branch; the OS accessibility
setting decides the third. **The fallback is the elevation model that already exists** — not a
blur emulation, not a translucent approximation. An opaque tab bar is a perfectly good tab bar.

> **iOS and Android chrome will look different, deliberately.** Each looks native to its own
> platform. That is a better outcome than one compromise that looks slightly wrong on both, and
> it costs nothing, because both paths had to exist anyway.

### DS§12.4 Accessibility — non-negotiable

- **`Reduce Transparency` collapses every glass surface to opaque.** Not "less blur" — opaque,
  via the DS§5 fallback. People enable that setting because they need it.
- **`Increase Contrast` does the same.**
- **Contrast is measured against the fallback, not against glass.** A label that passes 4.5:1
  only because of a favourable background behind the glass fails the moment content scrolls.
- Glass never carries meaning. Nothing is communicated by the material alone.

### DS§12.5 Tint and white-label

`GlassView` accepts a `tintColor`. **Use it sparingly or not at all.**

A coach's white-label brand may tint navigation glass at **low opacity only**, clamped by the
same contrast rule that clamps the brand ramp (DS§2.4). A heavily tinted glass tab bar is
unreadable over light content, and a coach must not be able to do that to their own client.

**Semantic colour is never a glass tint.** Adherence state is a dot with a shape (DS§2.5), not
a tinted surface.

### DS§12.6 Performance rules

- **Do not animate glass geometry per frame.** Position and size may change on a transition;
  they may not track a scroll offset or a gesture. Glass recomposites when its geometry changes.
- **Merge adjacent glass into one container.** Two separate glass views side by side is both
  more expensive and visually wrong — they will not blend at their shared edge.
- Never place glass over a video that is simultaneously the most expensive thing on screen
  **and** animating. The annotator toolbar is static chrome; that is why it is allowed.
- Budget unchanged: **≥55fps** scrolling with a glass tab bar over a FlashList. If glass costs
  frames on the target device, the fallback is correct and glass is dropped for that surface.

---

## DS§11. Implementation

**Source of truth:** `packages/ui/src/theme/tokens.ts`, consumed by `tailwind.config.js`
(`phase-04-design-system/theme-tokens/02`). Tokens are exported as a typed object; a hardcoded
hex in a component fails review.

Both themes are defined side by side, resolved by a `ThemeProvider` reading system preference
with a manual override in settings. **Every token has a value in both themes** — a token that
only exists in dark is a light-mode bug waiting for a release.

The rendered system — palette, type specimens, component states, and the coach/client density
comparison in both themes — is published as an artifact for visual review. `docs/screens/`
carries the layouts that use it.

---

*Companions: `ui-conventions` skill (usage rules) · `UI-UX.md` (page composition and data
flow) · `COPY.md` (words) · `docs/screens/` (layouts) ·
Owner: Ammar · Last updated: 16 August 2026*
