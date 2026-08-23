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
| `mapforge-persist.js` | Saving and loading: browser saves, `.mapforge` files, autosave, the recovery popup, saved-map thumbnails, the overwrite warning. |
| `mapforge-blobstore.js` | Where uploaded/cropped base-map pictures live: re-encoded losslessly to WebP and kept in IndexedDB, so saves reference a picture instead of carrying it. |
| `mapforge-library.js` | The live map library: reads `live-library/index.json` and builds the cards for the ready-made live-map regions. Read-only — entries are made by a local-only tool that is not in this repo. |
| `live-library/` | The live map library's entries — one `.mapforge` file each, listed in `index.json`. The app writes both. See its README. |
| `mapforge-server.py` | The local server the launcher runs: no-cache, byte-serving for the live map, and the two requests that add/remove library entries on the maintainer's machine. |
| `mapforge-export.js` | PNG / PDF / print export, the export preview, and save thumbnails. |
| `maplibre-basemap.js` | Everything about the live world map: map style, layers, the globe/flat toggle, and the dynamic label engine. |
| `maplibre-map/` | The live map's data: vector tiles (`.pmtiles`), GeoJSON (coastlines, rivers, lakes, label data), fonts, icons. |
| `Base Maps/` | The PNG base maps. Only the US History set is still in the picker; the world/ancient ones were retired in favour of live map regions but the FILES stay, because saved maps reference them by filename. |

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

**A library entry is just a saved map.** The ready-made live-map regions in
the Map Library are ordinary `.mapforge` project files kept in `live-library/`.
Choosing one runs the same restore path as opening a file, so the student lands
on the real live map, framed as the author framed it, with the author's marks already there —
as ordinary annotations they can edit, not a locked layer. Nothing about the
library is a separate code path, which is why it costs so little.

`live-library/index.json` lists the entries. Reading it is all this app does;
entries are MADE by a separate local-only file on the maintainer's machine,
through the launcher's server — the only part of MapForge that writes to disk.
The published site has neither the file nor the server, so the library is
read-only everywhere it is deployed. If you are wondering why the server has
POST routes that nothing here calls, that is why.

**Uploaded pictures are stored once, by reference.** A library map is saved as
a filename, and a live map as a frame — both tiny. Only an uploaded or cropped
map has a picture to keep, and that picture is re-encoded losslessly to WebP
(35-45% smaller, pixel-identical) and put in IndexedDB. The save then holds its
id, which is derived from the bytes, so two saves of the same map share one
copy. This keeps localStorage — capped near 5MB — holding only text: an
uploaded-map save went from about 1MB to 15KB.

**The app asks to keep its storage.** After the first successful save it calls
`requestPersistentStorage()`, which exempts the app's data from the browser's
"clear this when space is tight" policy and from Safari's habit of discarding
site data after about a week idle. It fires after a save, not at load, because
Firefox shows the user a permission prompt and it should arrive when the answer
is obviously yes. Chrome and Safari decide silently, largely on whether the user
looks invested in the site — bookmarking it is the single best signal. A refusal
changes nothing functionally; the data is simply evictable again.

A `.mapforge` FILE is the exception: it has to open on someone else's computer,
so `serializeProjectForFile()` puts the picture back inside it. If IndexedDB is
unavailable (private browsing, a locked-down profile), everything falls back to
the old inline-base64 behaviour.

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
