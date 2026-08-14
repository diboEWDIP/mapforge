# MapForge — Developer Notes

Plain-language guide to how this codebase is put together. For the app itself,
just open it and click around — it explains itself. This file is for when you
want to change something.

## Running it

Double-click **Start MapForge.command**. It pulls the latest changes, starts a
local server on port 7800, and opens the app.

**Always use the launcher (or another no-cache server).** A plain
`python3 -m http.server` lets the browser keep serving old copies of files
after an update — you'll see bugs that were already fixed, or miss features
that are already there. The launcher's server disables caching.

## The files

| File | What it is |
|---|---|
| `index.html` | The app: all UI, tools, drawing, and page logic. One file on purpose — no build step, no framework. |
| `mapforge.css` | All styling. Every rule in it is live (dead rules were cleaned out Aug 2026) — if you change a value, it takes effect. |
| `mapforge-icons.js` | Canvas drawing functions for every stamp, line style, and toolbar icon. |
| `mapforge-registry.js` | The stamp catalog: every stamp type's name, group, default size, and which draw function it uses. Add a stamp here + an icon function, and the UI picks it up. |
| `mapforge-persist.js` | Saving and loading: browser saves, `.mapforge` files, autosave, the recovery popup, saved-map thumbnails. |
| `mapforge-export.js` | PNG / PDF / print export, the export preview, and save thumbnails. |
| `maplibre-basemap.js` | Everything about the live world map: map style, layers, the globe/flat toggle, and the dynamic label engine. |
| `maplibre-map/` | The live map's data: vector tiles (`.pmtiles`), GeoJSON (coastlines, rivers, lakes, label data), fonts, icons. |
| `Base Maps/` | The PNG map library. |

## Ideas the code is built on

**The page is paper.** When a student sets a page view, the map canvas becomes
the actual paper size at 96 pixels per inch — an 11×17 Sheet really is a
bigger canvas than a 5×5 Figure, and gets more map detail because of it.
Exploring before the lock uses the same paper-sized canvas, so what you see
while framing is what the page will be. The +/− page controls just magnify;
they never change the map.

**Sizes are stored in document pixels** (1/96 inch), not screen pixels. A save
made on a Retina laptop prints the same from a school Chromebook. The
conversion (× `devicePixelRatio`) happens at load/save time in
`mapforge-persist.js`.

**Annotations on the live map are pinned to geography.** Stamps, lines, and
labels store longitude/latitude and re-derive their screen positions when the
view changes. Shading stores its raw brush geometry unclipped — the coastline
clipping happens fresh at render time, against whatever coastline detail the
map is currently drawing.

**Map labels are placed at render time, on the page.** The dynamic label
engine (`startDynLabels` in `maplibre-basemap.js`) re-seats ocean/sea/lake
names inside the visible part of their water every time the view settles.
Order of preference: the hand-curated curved label if it fits on the page →
a straight line through the widest open water → a stacked two-line label at
the visual center of the visible water. On the globe, text never warps onto
the sphere: curves are rebuilt with even screen spacing, and anything too
close to the globe's edge renders flat instead.

**Saves carry a version number.** `migrateProject()` in `mapforge-persist.js`
upgrades old save files when the format changes. If you change what's saved,
bump the version and add a migration branch — students' old files must keep
opening.

## Things that will bite you if you don't know them

- **Colus (the display font) has no lowercase.** Anything set in Colus is
  uppercase no matter what the text says. That's why map titles use Jost.
- **The world map's data ends at 85° latitude** — that's a hard limit of the
  Web Mercator tile scheme, not a bug. The camera is gently held below 80° so
  students never stare into the empty zone.
- **Create map instances through `MLB.create()` only.** It disposes the
  previous instance first. Each map holds a WebGL context; leak enough of
  them and Chrome shuts WebGL off for the whole page until restart.
- **Don't trust a tab that's been open across an update.** Hard-reload
  (Cmd+Shift+R) before deciding something is broken.
- **The hidden-tab trap:** browsers pause animation frames in background
  tabs. Code that waits for a render (exports, thumbnails) uses bounded
  timeouts for this reason — keep that pattern if you add more.

## History

The detailed build log — every design decision, bug, and fix with dates —
lives in the project's working records (kept by Maddy). Ask her if you need
the story behind any piece of this.
