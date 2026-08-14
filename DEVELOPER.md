# MapForge — Design Rules

The rules in this file are settled decisions, not suggestions. `NOTES.md`
explains how the code works; this file lists what must not be changed without
a deliberate decision by Maddy and Eric together. If a change you're making
fights one of these rules, stop and ask.

## Identity

- **No frameworks, no build step.** The app is plain HTML/CSS/JS and must
  stay openable, readable, and editable as-is.
- **The map is the hero.** Panels and controls stay quiet; the composed page
  is the visual center of the app.
- **Tool immediacy.** A student clicks a tool, clicks the map, and has made a
  mark. No new feature may add a required step before a student can stamp.
- **WYSIWYG page.** What is composed on the page is what prints and exports.
  Never add UI or behavior that makes the export differ from the editing view.
- **The logo is the SVG wordmark** (`mapforge-logo.svg`), recolored via CSS
  mask. Never a text rendering of the word.

## Color and type

- Palette anchors: cream `#FAF5EA`, dark ink `#2A1F0E`, gold accent `#A06810`
  (light gold `#C8A030`), left-rail slate `#4C6472`, header-2 navy `#283740`
  with grey-teal text tint `#9FB6C2`.
- Map palette (WCAG-checked): ocean `#C4E1F0`, water ink `#1C6690`. Map-size
  text keeps a 4.5:1 contrast ratio.
- The 13-swatch annotation palette (black → plum) is THE color set — every
  color picker in the app shows exactly these, in this order.
- **Colus is display type and is caps-only** — it physically has no
  lowercase. Never set user-entered text (titles, labels, names) in Colus;
  user text uses Jost so typed case survives. Colus is for fixed headers only.
- Jost is the working typeface: every control, label, and input.

## Layout and chrome

- **8px corner radius everywhere** (buttons, segments, tiles, inputs).
  Modal cards are 14px. Color/fill swatches are 19×19px chips at 4px.
- **No gradients, no glows, no outlines on buttons** where avoidable.
  Selected states are gold, not outlined.
- Segmented toggles: the inner segment fills the outer pill (no inset gap),
  inner radius = outer minus border.
- Row 2 (the context bar): darker navy ground, bold uppercase Jost labels in
  the grey-teal tint, uniform 22px buffer between control groups, tool
  options left / page controls right.
- Popups share one chrome: cream card, slate header band with white Colus
  title, white ✕ on the band, band flush to the card's top corners.
- Hints: one system, one look — slate bubble, cream Jost text, no outline.
  Anything with a `title` attribute joins automatically; never add a second
  tooltip style.
- Destructive buttons are palette red (`#cc503e`).

## Cartography

- **Annotations are geographic.** On the live map every mark stores lng/lat
  (shading stores raw unclipped brush geometry) and re-derives at render.
  Never bake screen positions or clipped shapes into stored data.
- **Marine/lake label ladder** (both projections): curated curved baseline
  when it fits the page → single line through open water → stacked two-line
  label at the visual center of the visible water, clamped inside ~4% page
  margins. A name with visible water always renders; never silently dropped.
- **On the globe, text never warps onto the sphere.** Curved labels use
  even-screen-spacing guides; anything bending past ~26° total renders flat.
- **River names stay on their rivers** in both projections — a river's label
  following its course is the label's information.
- **Shade clipping is deterministic and tier-matched:** below zoom 2 the
  110m dataset (islands absent there, matching the world-zoom render), zoom
  2–5 the 50m dataset (every island), zoom 5+ the rendered 10m coastline.
  Store unclipped, clip at render — never the reverse.
- Web Mercator data ends at 85.05°N/S. The camera clamp (±80°) stays; the
  white polar wedge visible on far-north globe framings is a known,
  accepted limitation.
- **Paper space:** the page renders at 96 px/inch of real paper; map detail
  follows physical page size. Page +/− is magnification only. Explore mode
  renders on the same paper pixels as the locked page.
- Sizes persist in document pixels (1/96") so saves are device-independent.
  Defaults: stamps 16, labels 12. The key renders at fixed legend sizes
  (12px text, 12px icons) — uniform swatches, never samples.
- The key auto-populates from every mark family, one row per (type, color).

## Process

- **Saves must always open.** Any change to the save format bumps the
  version and adds a migration in `migrateProject()`.
- Map instances only via `MLB.create()` (WebGL context discipline).
- Serve with a no-cache server (the launcher). Never bare `http.server`.
- Old saved maps may contain retired stamp types (e.g. desert) — renderers
  and the key must keep supporting them even when the palette doesn't.
