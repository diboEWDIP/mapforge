// maplibre-basemap.js — the live MapLibre base map for MapForge's Custom Region.
//
// SOURCE OF TRUTH for the cartography is the standalone build at
// ../maplibre/ (style + WORKLOG.md). Assets are synced with:
//   rsync -a --delete maplibre/vendor maplibre/fonts maplibre/data \
//     maplibre/tiles maplibre/label-overrides.json CLONE/maplibre-map/
// Style/behavior changes made in maplibre/index.html must be mirrored here
// by hand (this file is that style with URLs prefixed 'maplibre-map/' and
// the map instance passed in instead of module globals).
//
// Public API (global MLB):
//   MLB.create(containerEl)            -> maplibregl.Map (preserveDrawingBuffer)
//   MLB.lockView(map) / unlockView(map)
//   MLB.getToggleState() / applyToggleState(map, state)
//   MLB.snapshotToCanvas(map)          -> offscreen 2D canvas at backing size
//   MLB.wirePills(map, ids, onSettled) -> attach pill handlers
//   MLB.awaitIdle(map)                 -> Promise (safe when already idle)
//   MLB.destroy()

(function () {
'use strict';

const ASSET = 'maplibre-map/';

// ---- Palette (matches globe_v2 prototype) ----
const OCEAN = '#C4E1F0', WATER = '#236992', LAND = '#f8f9fa';   // WATER 25% darker (Maddy 2026-09-09; was #2E8CC2)
// Land when Terrain is OFF: the average tone of relief-over-land, so the page
// stays the same cream instead of jumping to white (Maddy 2026-09-09).
const LAND_NO_RELIEF = '#F3F1EE';
const INK = '#1C6690';
// Political boundaries (Phase 2): countries near-black and heavier, states
// a light warm grey and thinner — two clear ranks, both distinct from the
// water blue (Maddy 2026-09-09).
const BORDER = '#1F1F1F', BORDER_STATE = '#A89C8C', BORDER_INK = '#5C5145';
const SHADOW = '#b4d5e8';
const HALO = '#f3f1ee';
const GREY = { OCEAN: '#dcdcdc', WATER: '#424242', INK: '#303030', SHADOW: '#c8c8c8',
               LAND: '#f9f9f9', HALO: '#f1f1f1' };

const TIER_A = 3;
// Land/ocean shapes switch to the 50m tier EARLIER than rivers/labels do:
// 110m omits small islands entirely, so at continent-scale page zooms (2-3)
// islands neither drew nor shaded (Maddy 2026-08-14). Rivers keep TIER_A —
// their band tuning is unchanged.
const LAND_TIER = 2;
const TIER_Z = 5;
const BOLD_RANK = 3, BOLD_FACTOR = 1.35;

const RIVERS_110M = ['Amazon','Brahmaputra','Congo','Danube','Lena','Mekong',
  'Mississippi','Nile','Ob','Paraná','Paraná River','Peace','Yangtze'];
const EXTRA_RIVERS = ['Ebro','Tagus','Tiber','Po','Thames','Loire','Godavari',
  'Hudson','Chattahoochee','Savannah','Willamette'];
const NA_RANK = 5;
const EXCLUDE_RIVERS = ['Salween', 'Hongshui', 'Nanpan', 'Xi', 'Qianjiang', 'Sprague'];

function blendHex(a, b, t) {
  const p = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const [ar, ag, ab] = p(a), [br, bg, bb] = p(b);
  const c = v => Math.round(v).toString(16).padStart(2, '0');
  return '#' + c(ar + (br - ar) * t) + c(ag + (bg - ag) * t) + c(ab + (bb - ab) * t);
}
function riverTaperExpr(base) {
  return ['interpolate', ['linear'], ['line-progress'],
    0, blendHex(base, LAND, 0.55), 0.45, base, 1, base];
}
function vignetteColorExpr(base, target) {
  target = target || OCEAN;
  return ['match', ['get', 'r'], 1, blendHex(base, target, 0.34),
          2, blendHex(base, target, 0.67), target];
}
function riverFilter(v) {
  return ['all',
    ['!', ['in', ['get', 'name'], ['literal', EXCLUDE_RIVERS]]],
    ['any',
      ['<=', ['get', 'scalerank'], v],
      ['in', ['get', 'name'], ['literal', EXTRA_RIVERS]],
      ['all', ['==', ['get', 'na'], 1], ['<=', ['get', 'scalerank'], NA_RANK]],
    ]];
}
function riverWidthExpr(mult) {
  const base = ['max', 0.6 * mult,
    ['*', mult, ['+', 0.6, ['*', 0.54, ['ln', ['/', ['max', ['get', 'sw'], 0.15], 0.15]]]]]];
  const fade = ['+', 1, ['*', BOLD_FACTOR - 1,
    ['min', 1, ['/', ['max', ['get', 'sw'], 0.15], 0.6]]]];
  return ['case', ['<=', ['get', 'scalerank'], BOLD_RANK],
    ['*', fade, base], base];
}

function graticule() {
  const f = [];
  for (let lon = -180; lon <= 180; lon += 10) {
    const c = []; for (let lat = -85; lat <= 85; lat += 2) c.push([lon, lat]);
    f.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: c } });
  }
  for (let lat = -85; lat <= 85; lat += 5) {
    if (lat > -85 && lat < 85 && lat % 10 !== 0) continue;
    const c = []; for (let lon = -180; lon <= 180; lon += 2) c.push([lon, lat]);
    f.push({ type: 'Feature', properties: { eq: lat === 0 ? 1 : 0 },
      geometry: { type: 'LineString', coordinates: c } });
  }
  return { type: 'FeatureCollection', features: f };
}

const BAND_DEFS = [
  { b: 'b2', tier: '110m', min: 2,     max: TIER_A, extra: ['in', ['get', 'name'], ['literal', RIVERS_110M]] },
  { b: 'b3', tier: '50m', min: TIER_A, max: 4,      extra: riverFilter(4) },
  { b: 'b4', tier: '50m', min: 4,      max: TIER_Z, extra: riverFilter(4) },
  { b: 'b5', tier: '10m', min: TIER_Z, max: 6,      extra: riverFilter(4) },
  { b: 'b6', tier: '10m', min: 6,      max: 7,      extra: riverFilter(4) },
  { b: 'b7', tier: '10m', min: 7,      max: 24,     extra: riverFilter(4) },
];

function labelLayer(band, tier, minz, maxz, extraFilter) {
  return { id: `river-labels-${band}`, type: 'symbol', source: `riverlabels-${tier}`,
    minzoom: minz, maxzoom: maxz,
    filter: ['all', ['==', ['get', 'zb'], band], extraFilter],
    layout: {
      'symbol-placement': 'line',
      'symbol-spacing': 2000,
      'text-field': ['case',
        ['==', ['get', 'name'], 'Grande'], 'Rio Grande',
        ['any',
          ['in', 'River', ['get', 'name']],
          ['==', ['slice', ['get', 'name'], 0, 4], 'Rio '],
          ['==', ['slice', ['get', 'name'], 0, 4], 'Río '],
        ],
        ['get', 'name'],
        ['concat', ['get', 'name'], ' River']],
      'text-font': ['Jost Medium Italic'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 1, 6.6, 4, 8.2, 6, 9.1],
      'text-letter-spacing': ['interpolate', ['linear'],
        ['coalesce', ['get', 'len'], 3], 1, 0.08, 8, 0.15, 30, 0.28],
      'text-max-angle': 110,
      'text-padding': 1,
    },
    paint: { 'text-color': INK, 'text-halo-color': HALO, 'text-halo-width': 3.2 } };
}

function riverLayers(tier, minzoom, maxzoom) {
  const zoomProps = {};
  if (minzoom != null) zoomProps.minzoom = minzoom;
  if (maxzoom != null) zoomProps.maxzoom = maxzoom;
  return [
    { id: `rivers-${tier}`, type: 'line', source: `rivers-${tier}`, ...zoomProps,
      filter: riverFilter(4),
      paint: { 'line-color': WATER, 'line-width': riverWidthExpr(1) },
      layout: { 'line-cap': 'round', 'line-join': 'round' } },
  ];
}

// The six heavy 10m-tier layers live in one PMTiles vector archive
// (built by maplibre/build-pmtiles.sh) instead of ~41MB of GeoJSON parsed at
// startup — tiles stream per-view via HTTP range requests. Labels,
// rivers-texture, and rivers-110m (line-gradient taper needs lineMetrics)
// stay GeoJSON on purpose; see the build script header.
const TILE10 = {
  'land-10m': 'land', 'ocean-10m': 'ocean', 'rivers-10m': 'rivers',
  'lakes-10m': 'lakes', 'vignette-10m': 'vignette',
  'vignette-lakes-10m': 'vignette-lakes',
};
// 110m/50m tiers + the z2-3 river texture live in tierlow.pmtiles
// (source-layer names match the old source names 1:1).
// 110m-tier fills come from DIRECT geojson, not tierlow tiles: MapLibre's
// globe fails tile-cover at pole-adjacent views, dropping every tiled layer
// while geojson/raster keep drawing (the "blank blue pole" bug, Maddy
// 2026-08-14). GeoJSON sources render everywhere, poles included.
// The ENTIRE 110m tier serves as direct geojson (572KB once, cached):
// globe tile-cover fails for the WHOLE view once the pole is visible, so a
// partially-tiled tier makes the map's tone jump at ~75°N as ocean/vignette
// drop (Maddy 2026-08-14). 50m/10m tiers — the heavy data — stay tiled.
const TILELOW = [
  'rivers-texture','land-50m','ocean-50m','lakes-50m','rivers-50m',
  'vignette-50m','vignette-lakes-50m'];

// ---- Political boundaries (Phase 2, 2026-09) ---------------------------------
// Country borders + US state borders, tiered like the basemap, plus name
// labels. Solid = settled international boundary; dashed = disputed/indefinite
// /lease (NE featurecla). States dotted, lighter. Labels ride NE's curated
// label points and its per-feature min_label zoom.
const BOUNDARY_SOLID = ['==', ['get', 'featurecla'], 'International boundary (verify)'];
function boundaryLayers(kind) {   // 'state' | 'country'
  const tiers = [
    ['110m', { source: 'boundaries-110m' }, null, TIER_A],
    ['50m',  { source: 'boundaries', 'source-layer': 'countries-50m' }, TIER_A, TIER_Z],
    ['10m',  { source: 'boundaries', 'source-layer': 'countries-10m' }, TIER_Z, null],
  ];
  const out = [];
  for (const [t, src, min, max] of tiers) {
    const zoom = {}; if (min != null) zoom.minzoom = min; if (max != null) zoom.maxzoom = max;
    const kindC = t === '110m' ? ['==', ['get', 'kind'], 'country'] : null;
    const kindS = t === '110m' ? ['==', ['get', 'kind'], 'state'] : null;
    const srcS = t === '110m' ? src : { source: 'boundaries', 'source-layer': `states-${t}` };
    const and = (...f) => ['all', ...f.filter(Boolean)];
    // Draw order (Maddy 2026-09-09): STATES sit beneath the rivers; COUNTRIES
    // above rivers and lakelines. So the country stroke always tops the state
    // stroke where they share a line (the US national border).
    if (kind === 'state') { out.push(
      { id: `states-${t}`, type: 'line', ...srcS, ...zoom,
        ...(kindS ? { filter: kindS } : {}),
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': BORDER_STATE, 'line-width': 1.0 } }); continue; }   // +25% (Maddy 2026-09-15); sync w/ setPageScale
    out.push(
      { id: `countries-${t}`, type: 'line', ...src, ...zoom,
        filter: and(kindC, BOUNDARY_SOLID),
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': BORDER, 'line-width': 1.4 } },
      { id: `countries-${t}-dashed`, type: 'line', ...src, ...zoom,
        filter: and(kindC, ['!', BOUNDARY_SOLID]),
        layout: { 'line-join': 'round' },
        paint: { 'line-color': BORDER, 'line-width': 1.4, 'line-dasharray': [3, 2] } });
  }
  return out;
}
// Boundary NAME labels go at the TOP of the symbol stack: MapLibre places
// higher layers first, so country names must outrank river/water labels or
// "United States of America" loses its spot to a river name (Maddy 2026-09-09).
// Countries sit ABOVE states so a country name beats a state name too.
function boundaryLabelLayers() {
  return [
    { id: 'state-labels', type: 'symbol', source: 'boundarylabels',   // no minzoom: names arrive WITH the state lines (Maddy 2026-09-15)
      filter: ['==', ['get', 'kind'], 'state'],
      layout: {
        'text-field': ['get', 'label'],   // full name, or the postal code where the name won't fit
        'text-font': ['Jost Medium'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 4, 8, 7, 10.5],   // 8px ≈ 6.7pt printed (was 7 ≈ 5.9pt); keep in sync w/ setPageScale
        'text-max-width': 6,
        'text-padding': 4,
        'text-variable-anchor': ['center', 'top', 'bottom', 'left', 'right'],
        'text-radial-offset': 0.7,
      },
      paint: { 'text-color': BORDER_INK, 'text-halo-color': HALO, 'text-halo-width': 1.4,
               'text-opacity': 0.9 } },
    { id: 'country-labels', type: 'symbol', source: 'boundarylabels', minzoom: 2.5,   // names 0.5 after the lines (Maddy 2026-09-15)
      filter: ['==', ['get', 'kind'], 'country'],
      layout: {
        'text-field': ['get', 'name'],
        'text-font': ['Colus Regular'],        // display face (caps-only), Maddy 2026-09-09
        'text-transform': 'uppercase',
        'text-letter-spacing': 0.12,
        // Per-country size from the placement engine (Maddy 2026-09-15): the
        // zoom curve × 1.2 for roomy countries, ×0.85/×0.7 (stacked) where the
        // name won't fit at full size. Already includes the page scale.
        'text-size': ['coalesce', ['get', 'size'], 9],
        'text-max-width': 7,
        'text-padding': 6,
        // may slide a little off the computed centre to clear a river name
        'text-variable-anchor': ['center', 'top', 'bottom', 'left', 'right'],
        'text-radial-offset': 0.9,
      },
      paint: { 'text-color': BORDER, 'text-halo-color': HALO, 'text-halo-width': 1.6 } },   // ink = country line
  ];
}
const COUNTRY_LINES = ['110m','50m','10m'].flatMap(t => [`countries-${t}`, `countries-${t}-dashed`]);
const STATE_LINES   = ['110m','50m','10m'].map(t => `states-${t}`);
const BOUNDARY_LINES = [...COUNTRY_LINES, ...STATE_LINES];

function buildStyle() {
  const D = f => ASSET + 'data/' + f;
  const style = {
    version: 8,
    glyphs: ASSET + 'fonts/{fontstack}/{range}.pbf',
    projection: { type: 'vertical-perspective' },
    sources: {
      'rivers-110m':{ type: 'geojson', data: D('rivers-110m.geojson'), lineMetrics: true },
      // 110m land+lakes as direct geojson (120KB total, one cached fetch):
      // tiled layers vanish at pole-adjacent globe views; geojson renders
      // everywhere. The vignette (348KB, cosmetic) stays tiled — a missing
      // coastal glow at the poles is invisible; 350KB is not.
      'land-110m':    { type: 'geojson', data: D('land-110m.geojson') },
      'lakes-110m':   { type: 'geojson', data: D('lakes-110m.geojson') },
      'ocean-110m':   { type: 'geojson', data: D('ocean-110m.geojson') },
      'vignette-110m':{ type: 'geojson', data: D('vignette-110m.geojson') },
      // Coarse tiling + fat buffers + tolerance 0: label windows must stay
      // whole per tile and unsimplified, or labels silently never render.
      // Keep in sync with build-rivers.sh's tile-safety assertion CFG.
      'riverlabels-110m': { type: 'geojson', data: D('riverlabels-110m.geojson'),
        buffer: 512, maxzoom: 2, tolerance: 0 },
      'riverlabels-50m': { type: 'geojson', data: D('riverlabels-50m.geojson'),
        buffer: 512, maxzoom: 2, tolerance: 0 },
      'riverlabels-10m': { type: 'geojson', data: D('riverlabels-10m.geojson'),
        buffer: 512, maxzoom: 4, tolerance: 0 },
      'dynlabels': { type: 'geojson', buffer: 512, maxzoom: 4,
        data: { type: 'FeatureCollection', features: [] } },
      'graticule':  { type: 'geojson', data: graticule() },
      // Present-day political boundaries (build-boundaries.sh). 110m as direct
      // geojson (pole-adjacent globe views drop tiled layers); 50m/10m tiled.
      'boundaries-110m': { type: 'geojson', data: D('boundaries-110m.geojson') },
      // Boundary names are placed at RUNTIME (startBoundaryLabels): one point
      // per visible country/state at the visual centre of its visible part.
      'boundarylabels':  { type: 'geojson', buffer: 512, maxzoom: 4,
        data: { type: 'FeatureCollection', features: [] } },
      'marinelabels': { type: 'geojson', data: D('marinelabels.geojson'),
        buffer: 512, maxzoom: 2 },
      'lakelabels':   { type: 'geojson', data: D('lakelabels.geojson'),
        buffer: 256, maxzoom: 3 },
      'relief':     { type: 'raster', tiles: [ASSET + 'tiles/relief/{z}/{x}/{y}.png'],
                      tileSize: 256, minzoom: 0, maxzoom: 6 },
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': OCEAN } },
      { id: 'land-110m', type: 'fill', source: 'land-110m', maxzoom: LAND_TIER,
        paint: { 'fill-color': LAND } },
      { id: 'land-50m', type: 'fill', source: 'land-50m', minzoom: LAND_TIER, maxzoom: TIER_Z,
        paint: { 'fill-color': LAND } },
      { id: 'land-10m', type: 'fill', source: 'land-10m', minzoom: TIER_Z,
        paint: { 'fill-color': LAND } },
      { id: 'relief', type: 'raster', source: 'relief',
        paint: { 'raster-opacity': 0.35, 'raster-fade-duration': 150 } },
      { id: 'ocean-110m', type: 'fill', source: 'ocean-110m', maxzoom: LAND_TIER,
        paint: { 'fill-color': OCEAN } },
      { id: 'ocean-50m', type: 'fill', source: 'ocean-50m', minzoom: LAND_TIER, maxzoom: TIER_Z,
        paint: { 'fill-color': OCEAN } },
      { id: 'ocean-10m', type: 'fill', source: 'ocean-10m', minzoom: TIER_Z,
        paint: { 'fill-color': OCEAN } },
      { id: 'vignette-110m', type: 'fill', source: 'vignette-110m', maxzoom: LAND_TIER,
        paint: { 'fill-color': vignetteColorExpr(SHADOW) } },
      { id: 'vignette-50m', type: 'fill', source: 'vignette-50m', minzoom: LAND_TIER, maxzoom: TIER_Z,
        paint: { 'fill-color': vignetteColorExpr(SHADOW) } },
      { id: 'vignette-10m', type: 'fill', source: 'vignette-10m', minzoom: TIER_Z,
        paint: { 'fill-color': vignetteColorExpr(SHADOW) } },
      { id: 'coast-110m', type: 'line', source: 'land-110m', maxzoom: LAND_TIER,
        paint: { 'line-color': WATER, 'line-width': 1.25 } },
      { id: 'coast-50m', type: 'line', source: 'land-50m', minzoom: LAND_TIER, maxzoom: TIER_Z,
        paint: { 'line-color': WATER, 'line-width': 1.25 } },
      { id: 'coast-10m', type: 'line', source: 'land-10m', minzoom: TIER_Z,
        paint: { 'line-color': WATER, 'line-width': 1.25 } },
      // DOTTED (Maddy 2026-09-15): solid grey read too much like state lines.
      // Zero-length dashes + round caps = dots one line-width across; width and
      // opacity bumped so the dots don't vanish. Dash units scale with width.
      { id: 'graticule', type: 'line', source: 'graticule',
        layout: { 'line-cap': 'round' },
        paint: { 'line-color': '#5a5a5a', 'line-opacity': 0.5,
          'line-width': ['case', ['==', ['get', 'eq'], 1], 1.8, 1.2],
          'line-dasharray': [0, 2.5] } },
      ...boundaryLayers('state'),       // beneath every river layer
      { id: 'rivers-texture', type: 'line', source: 'rivers-texture', maxzoom: TIER_A,
        filter: riverFilter(4),
        paint: { 'line-color': WATER,
          'line-opacity': ['case', ['<=', ['get', 'scalerank'], BOLD_RANK],
            ['+', 0.5, ['*', 0.15,
              ['-', 1, ['min', 1, ['/', ['max', ['get', 'sw'], 0.15], 0.6]]]]],
            0.5],
          'line-width': 0.6 },
        layout: { 'line-cap': 'round', 'line-join': 'round' } },
      { id: 'rivers-110m', type: 'line', source: 'rivers-110m', maxzoom: TIER_A,
        paint: { 'line-color': WATER, 'line-width': 1.25,
          'line-gradient': riverTaperExpr(WATER) },
        layout: { 'line-cap': 'round', 'line-join': 'round' } },
      ...riverLayers('50m', TIER_A, TIER_Z).filter(l => l.id === 'rivers-50m'),
      ...riverLayers('10m', TIER_Z, null).filter(l => l.type === 'line'),
      { id: 'lakes-50m', type: 'fill', source: 'lakes-50m', maxzoom: TIER_Z,
        paint: { 'fill-color': OCEAN } },
      { id: 'lakes-10m', type: 'fill', source: 'lakes-10m', minzoom: TIER_Z,
        paint: { 'fill-color': OCEAN } },
      { id: 'vignette-lakes-50m', type: 'fill', source: 'vignette-lakes-50m', maxzoom: TIER_Z,
        paint: { 'fill-color': vignetteColorExpr(SHADOW) } },
      { id: 'vignette-lakes-10m', type: 'fill', source: 'vignette-lakes-10m', minzoom: TIER_Z,
        paint: { 'fill-color': vignetteColorExpr(SHADOW) } },
      { id: 'lakeline-50m', type: 'line', source: 'lakes-50m', maxzoom: TIER_Z,
        paint: { 'line-color': WATER, 'line-width': 1.25 } },
      { id: 'lakeline-10m', type: 'line', source: 'lakes-10m', minzoom: TIER_Z,
        paint: { 'line-color': WATER, 'line-width': 1.25 } },
      ...boundaryLayers('country'),
      ...BAND_DEFS.map(d => labelLayer(d.b, d.tier, d.min, d.max, d.extra)),
      { id: 'ocean-labels', type: 'symbol', source: 'marinelabels',
        filter: ['all', ['==', ['get', 'featurecla'], 'ocean'],
          ['>=', ['zoom'], ['get', 'min_label']]],
        layout: {
          'symbol-placement': 'line-center',
          'text-field': ['get', 'name'],
          'text-font': ['Jost Medium'],
          'text-transform': 'uppercase',
          'text-letter-spacing': 0.5,
          'text-size': ['interpolate', ['linear'], ['zoom'], 1.5, 9.7, 4, 14],
          'text-max-angle': 120,
        },
        paint: { 'text-color': INK,
          'text-halo-color': OCEAN, 'text-halo-width': 2 } },
      { id: 'sea-labels', type: 'symbol', source: 'marinelabels',
        filter: ['all',
          ['>=', ['zoom'], ['get', 'min_label']],
          ['<=', ['get', 'min_label'], 4.5],
          ['in', ['get', 'featurecla'], ['literal', ['sea', 'gulf', 'bay']]]],
        layout: {
          'symbol-placement': 'line-center',
          'text-field': ['get', 'name'],
          'text-font': ['Jost Medium'],
          'text-transform': 'uppercase',
          'text-letter-spacing': 0.22,
          'text-size': ['interpolate', ['linear'], ['zoom'], 3, 7.5, 6, 9.7],
          'text-max-angle': 120,
        },
        paint: { 'text-color': INK,
          'text-halo-color': OCEAN, 'text-halo-width': 2 } },
      { id: 'dyn-marine-labels', type: 'symbol', source: 'dynlabels',
        filter: ['all', ['!=', ['get', 'featurecla'], 'lake'],
                        ['!=', ['get', 'stacked'], 1]],
        layout: {
          'symbol-placement': 'line-center',
          'text-field': ['get', 'name'],
          'text-font': ['Jost Medium'],
          'text-transform': 'uppercase',
          'text-letter-spacing': ['case', ['==', ['get', 'featurecla'], 'ocean'], 0.5, 0.22],
          // zoom interpolate must be TOP-LEVEL (blank-map trap)
          'text-size': ['interpolate', ['linear'], ['zoom'],
            1.5, ['case', ['==', ['get', 'featurecla'], 'ocean'], 9.7, 7.5],
            3,   ['case', ['==', ['get', 'featurecla'], 'ocean'], 12.3, 7.5],
            4,   ['case', ['==', ['get', 'featurecla'], 'ocean'], 14, 8.2],
            6,   ['case', ['==', ['get', 'featurecla'], 'ocean'], 14, 9.7]],
          'text-max-angle': 120,
        },
        paint: { 'text-color': INK,
          'text-halo-color': OCEAN, 'text-halo-width': 2 } },
      { id: 'dyn-lake-stacked', type: 'symbol', source: 'dynlabels',
        filter: ['all', ['==', ['get', 'stacked'], 1], ['==', ['get', 'featurecla'], 'lake']],
        layout: {
          'text-field': ['case',
            ['==', ['slice', ['get', 'name'], 0, 6], 'Great '],
            ['concat', ['get', 'name'], ' Lake'],
            ['concat', 'Lake ', ['get', 'name']]],
          'text-font': ['Jost Medium Italic'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 3.5, 7, 6, 9.3],
          'text-letter-spacing': 0.12,
          'text-max-width': 7,
          'text-line-height': 1.4,
        },
        paint: { 'text-color': INK,
          'text-halo-color': OCEAN, 'text-halo-width': 4 } },
      { id: 'dyn-marine-stacked', type: 'symbol', source: 'dynlabels',
        filter: ['all', ['==', ['get', 'stacked'], 1], ['!=', ['get', 'featurecla'], 'lake']],
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['Jost Medium'],
          'text-transform': 'uppercase',
          'text-letter-spacing': ['case', ['==', ['get', 'featurecla'], 'ocean'], 0.4, 0.2],
          'text-max-width': 5,          /* forces ATLANTIC / OCEAN onto two lines */
          'text-line-height': 1.5,
          'text-size': ['interpolate', ['linear'], ['zoom'],
            1.5, ['case', ['==', ['get', 'featurecla'], 'ocean'], 8.2, 6.4],
            3,   ['case', ['==', ['get', 'featurecla'], 'ocean'], 10.5, 6.4],
            4,   ['case', ['==', ['get', 'featurecla'], 'ocean'], 11.9, 7],
            6,   ['case', ['==', ['get', 'featurecla'], 'ocean'], 11.9, 8.2]],
        },
        paint: { 'text-color': INK,
          'text-halo-color': OCEAN, 'text-halo-width': 2 } },
      { id: 'dyn-lake-labels', type: 'symbol', source: 'dynlabels', minzoom: 3.5,
        filter: ['==', ['get', 'featurecla'], 'lake'],
        layout: {
          'symbol-placement': 'line-center',
          'text-max-angle': 120,
          'text-field': ['case',
            ['==', ['slice', ['get', 'name'], 0, 6], 'Great '],
            ['concat', ['get', 'name'], ' Lake'],
            ['concat', 'Lake ', ['get', 'name']]],
          'text-font': ['Jost Medium Italic'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 3.5, 7, 6, 9.3],
          'text-letter-spacing': 0.12,
        },
        paint: { 'text-color': INK,
          'text-halo-color': OCEAN, 'text-halo-width': 4 } },
      { id: 'lake-labels-pt', type: 'symbol', source: 'lakelabels', minzoom: 3.5,
        filter: ['all', ['<=', ['get', 'scalerank'], 2], ['==', ['get', 'stack'], 1],
          ['>=', ['zoom'], ['get', 'zfit']]],
        layout: {
          'text-field': ['case',
            ['==', ['slice', ['get', 'name'], 0, 6], 'Great '],
            ['concat', ['get', 'name'], ' Lake'],
            ['concat', 'Lake ', ['get', 'name']]],
          'text-font': ['Jost Medium Italic'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 3.5, 7, 6, 9.3],
          'text-letter-spacing': 0.12,
          'text-max-width': ['coalesce', ['get', 'tmw'], 6],
          'text-line-height': 1.25,
          'text-anchor': ['case', ['==', ['get', 'beside'], 1], 'left', 'center'],
          'text-justify': ['case', ['==', ['get', 'beside'], 1], 'left', 'center'],
        },
        paint: { 'text-color': INK,
          'text-halo-color': ['case', ['==', ['get', 'beside'], 1], HALO, OCEAN],
          'text-halo-width': 4 } },
      { id: 'lake-labels', type: 'symbol', source: 'lakelabels', minzoom: 3.5,
        filter: ['all', ['<=', ['get', 'scalerank'], 2], ['!=', ['get', 'stack'], 1]],
        layout: {
          'symbol-placement': 'line-center',
          'text-max-angle': 120,
          'text-field': ['case',
            ['==', ['slice', ['get', 'name'], 0, 6], 'Great '],
            ['concat', ['get', 'name'], ' Lake'],
            ['concat', 'Lake ', ['get', 'name']]],
          'text-font': ['Jost Medium Italic'],
          'text-size': ['interpolate', ['linear'], ['zoom'], 3.5, 7, 6, 9.3],
          'text-letter-spacing': 0.12,
          'text-max-width': 7,
        },
        paint: { 'text-color': INK,
          'text-halo-color': OCEAN, 'text-halo-width': 4 } },
      ...boundaryLabelLayers(),
    ],
  };
  for (const l of style.layers) if (l.filter) { l.metadata = { ...(l.metadata || {}), baseFilter: l.filter }; }
  style.sources.tier10 = { type: 'vector',
    url: 'pmtiles://' + new URL(ASSET + 'data/tier10.pmtiles', location.href).href };
  style.sources.tierlow = { type: 'vector',
    url: 'pmtiles://' + new URL(ASSET + 'data/tierlow.pmtiles', location.href).href };
  style.sources.boundaries = { type: 'vector',
    url: 'pmtiles://' + new URL(ASSET + 'data/boundaries.pmtiles', location.href).href };
  for (const l of style.layers) {
    if (TILE10[l.source]) { l['source-layer'] = TILE10[l.source]; l.source = 'tier10'; }
    else if (TILELOW.includes(l.source)) { l['source-layer'] = l.source; l.source = 'tierlow'; }
  }
  return style;
}

// ---- Toggle state + appliers ------------------------------------------------

const RIVER_LINE = ['rivers-texture', 'rivers-110m', 'rivers-50m', 'rivers-10m'];
const WATER_LABELS = ['ocean-labels', 'sea-labels', 'lake-labels', 'lake-labels-pt',
                      'dyn-marine-labels', 'dyn-marine-stacked', 'dyn-lake-labels', 'dyn-lake-stacked'];
const RIVER_LABELS = ['b2','b3','b4','b5','b6','b7'].map(b => `river-labels-${b}`);
const FILL_OCEAN = ['ocean-110m','ocean-50m','ocean-10m','lakes-50m','lakes-10m'];
const FILL_LAND  = ['land-110m','land-50m','land-10m'];
const LINES_W    = ['coast-110m','coast-50m','coast-10m','lakeline-50m','lakeline-10m',
                    'rivers-texture','rivers-110m','rivers-50m','rivers-10m'];
const VIGNETTES  = ['vignette-110m','vignette-50m','vignette-10m',
                    'vignette-lakes-50m','vignette-lakes-10m'];

// AUTO ZOOM LAYERS (Maddy 2026-09-15, fixed zooms chosen against the dev
// readout): a fresh map starts in an automatic state —
//   z <  2     graticule only
//   z >= 2     + country lines (names from 2.5 — country-labels minzoom)
//   z >= 3     + US states, graticule off
// The first manual Graticule/States/Countries toggle ends the automatic state
// for all three (state.autoZoomLayers = false) and the user's choices stand.
const AUTO_COUNTRIES_Z = 2;
const AUTO_STATES_Z = 3;
// State NAMES: codes only from AUTO_STATES_Z; full name preferred (code where
// space is short) from STATE_FULLNAME_Z.
const STATE_FULLNAME_Z = 3.75;
const state = { globe: true, greyOn: false, riversOn: true, labelsOn: true,
  autoZoomLayers: true,
  countriesOn: true, statesOn: true, graticuleOn: true, reliefOn: true,   // Phase 2 layer toggles
  minorLakesOn: true,   // lakes under MINOR_LAKE_KM2 (major lakes always show)
  // GROUP switches (Photoshop-style): gate every row in the group without
  // changing the rows' own keys, so re-enabling restores the last per-row state.
  layersGroupOn: true, labelsGroupOn: true,
  // per-layer NAME switches (Maddy 2026-09-09: every layer gets lines + labels
  // eyes). labelsOn now means the WATER names (oceans, seas, lakes).
  riverLabelsOn: true, countryLabelsOn: true, stateLabelsOn: true,
  // Page mode: static ocean/sea labels off, dynamic engine places ALL marine
  // names inside the visible page — guaranteed on-page, no duplicates.
  marineDynOnly: false };
// Pristine defaults, captured before anything (incl. the automatic zoom state
// on map load) mutates `state`. Older saves only carry the keys that existed
// when they were made; their missing keys must come from HERE, not from
// whatever the live state happens to be (2026-09-15: all 54 library maps lack
// countriesOn/statesOn and were opening with borders hidden).
const DEFAULT_STATE = { ...state };

function applyGrey(map) {
  const g = state.greyOn;
  const ocean = g ? GREY.OCEAN : OCEAN, water = g ? GREY.WATER : WATER;
  const ink = g ? GREY.INK : INK, land = g ? GREY.LAND : LAND;
  const halo = g ? GREY.HALO : HALO;
  map.setPaintProperty('background', 'background-color', ocean);
  FILL_OCEAN.forEach(id => map.getLayer(id) && map.setPaintProperty(id, 'fill-color', ocean));
  FILL_LAND.forEach(id => map.getLayer(id) && map.setPaintProperty(id, 'fill-color', land));
  LINES_W.forEach(id => map.getLayer(id) && map.setPaintProperty(id, 'line-color', water));
  RIVER_LABELS.forEach(id => { if (!map.getLayer(id)) return;
    map.setPaintProperty(id, 'text-color', ink);
    map.setPaintProperty(id, 'text-halo-color', halo); });
  ['ocean-labels','sea-labels','lake-labels','dyn-marine-labels','dyn-marine-stacked','dyn-lake-labels','dyn-lake-stacked'].forEach(id => {
    if (!map.getLayer(id)) return;
    map.setPaintProperty(id, 'text-color', ink);
    map.setPaintProperty(id, 'text-halo-color', ocean); });
  if (map.getLayer('lake-labels-pt')) {
    map.setPaintProperty('lake-labels-pt', 'text-color', ink);
    map.setPaintProperty('lake-labels-pt', 'text-halo-color',
      ['case', ['==', ['get', 'beside'], 1], halo, ocean]);
  }
  map.setPaintProperty('rivers-110m', 'line-gradient',
    riverTaperExpr(g ? GREY.WATER : WATER));
  const shad = g ? GREY.SHADOW : SHADOW;
  VIGNETTES.forEach(id => map.getLayer(id) && map.setPaintProperty(id, 'fill-color',
    vignetteColorExpr(shad, g ? GREY.OCEAN : OCEAN)));
  map.setPaintProperty('relief', 'raster-saturation', g ? -1 : 0);
}

function applyLabelVis(map) {
  WATER_LABELS.forEach(id => {
    if (!map.getLayer(id)) return;
    const staticMarine = (id === 'ocean-labels' || id === 'sea-labels' ||
                          id === 'lake-labels');   // in-lake statics; beside-points stay
    const vis = state.labelsGroupOn && state.labelsOn && !(staticMarine && state.marineDynOnly);
    map.setLayoutProperty(id, 'visibility', vis ? 'visible' : 'none');
  });
  RIVER_LABELS.forEach(id => map.getLayer(id) && map.setLayoutProperty(id,
    'visibility', (state.labelsGroupOn && state.riverLabelsOn && state.riversOn) ? 'visible' : 'none'));
  applyBoundaryVis(map);
}

// Boundary lines follow their own switches; their labels also need Labels on.
function applyBoundaryVis(map) {
  const G = state.layersGroupOn, L = state.labelsGroupOn;
  COUNTRY_LINES.forEach(id => map.getLayer(id) && map.setLayoutProperty(id, 'visibility',
    (G && state.countriesOn) ? 'visible' : 'none'));
  STATE_LINES.forEach(id => map.getLayer(id) && map.setLayoutProperty(id, 'visibility',
    (G && state.statesOn) ? 'visible' : 'none'));
  if (map.getLayer('country-labels')) map.setLayoutProperty('country-labels', 'visibility',
    (L && state.countryLabelsOn && state.countriesOn) ? 'visible' : 'none');
  if (map.getLayer('state-labels')) map.setLayoutProperty('state-labels', 'visibility',
    (L && state.stateLabelsOn && state.statesOn) ? 'visible' : 'none');
}
// Minor lakes: lakes (and their vignettes) under MINOR_LAKE_KM2 hide; the
// great lakes / seas always show. Lake LABELS follow via the major-name list
// (data/major-lakes.json, built by add-lake-area.sh).
const MINOR_LAKE_KM2 = 5000;
const LAKE_AREA_LAYERS = ['lakes-50m', 'lakes-10m', 'lakeline-50m', 'lakeline-10m',
                          'vignette-lakes-50m', 'vignette-lakes-10m', 'lakes-110m'];
let MAJOR_LAKE_NAMES = null;
fetch(ASSET + 'data/major-lakes.json').then(r => r.json()).then(d => { MAJOR_LAKE_NAMES = d.names; }).catch(() => {});
function applyLakeVis(map) {
  const minorOn = state.layersGroupOn && state.minorLakesOn;
  const major = ['>=', ['coalesce', ['get', 'area_km2'], 1e9], MINOR_LAKE_KM2];
  LAKE_AREA_LAYERS.forEach(id => {
    if (!map.getLayer(id)) return;
    const base = map.getLayer(id).metadata && map.getLayer(id).metadata.baseFilter;
    const f = minorOn ? (base || null) : (base ? ['all', base, major] : major);
    map.setFilter(id, f);
  });
  const names = MAJOR_LAKE_NAMES || [];
  ['lake-labels', 'lake-labels-pt', 'dyn-lake-labels', 'dyn-lake-stacked'].forEach(id => {
    if (!map.getLayer(id)) return;
    const base = map.getLayer(id).metadata && map.getLayer(id).metadata.baseFilter;
    const nf = ['in', ['get', 'name'], ['literal', names]];
    map.setFilter(id, minorOn ? (base || null) : (base ? ['all', base, nf] : nf));
  });
}
function applyReliefVis(map) {
  const on = state.layersGroupOn && state.reliefOn;
  if (map.getLayer('relief')) map.setLayoutProperty('relief', 'visibility', on ? 'visible' : 'none');
  if (!state.greyOn) FILL_LAND.forEach(id => map.getLayer(id) &&
    map.setPaintProperty(id, 'fill-color', on ? LAND : LAND_NO_RELIEF));
}
// While the map is in its automatic state, zoom decides: graticule when zoomed
// out, US states when zoomed in. Returns true if anything changed.
function applyAutoZoomLayers(map) {
  if (!state.autoZoomLayers || !map || !map.getZoom) return false;
  const z = map.getZoom();
  const countries = z >= AUTO_COUNTRIES_Z;
  const states = z >= AUTO_STATES_Z;                // graticule leaves when states arrive
  if (state.graticuleOn === !states && state.statesOn === states &&
      state.countriesOn === countries) return false;
  state.graticuleOn = !states;
  state.statesOn = states;
  state.countriesOn = countries;
  applyGraticuleVis(map);
  applyBoundaryVis(map);
  if (MLB.onAutoLayers) MLB.onAutoLayers();   // app re-syncs its switches
  return true;
}

function applyGraticuleVis(map) {
  if (map.getLayer('graticule')) map.setLayoutProperty('graticule', 'visibility',
    (state.layersGroupOn && state.graticuleOn) ? 'visible' : 'none');
}

function applyRiverVis(map) {
  RIVER_LINE.forEach(id => map.getLayer(id) && map.setLayoutProperty(id, 'visibility',
    (state.layersGroupOn && state.riversOn) ? 'visible' : 'none'));
  applyLabelVis(map);
}

function applyProjection(map) {
  // setProjection throws before the style finishes loading — restoreLiveMap
  // can call applyToggleState on a cold cache in exactly that window, which
  // aborted the whole restore (found 2026-08-13 by the regression harness).
  // Defer to style.load; last-write-wins if called again meanwhile.
  const apply = () =>
    map.setProjection({ type: state.globe ? 'vertical-perspective' : 'mercator' });
  if (map.style && map.style._loaded) apply();
  else map.once('style.load', apply);
}

// ---- Dynamic marine labels (moveend engine) --------------------------------
// When a named water body intersects the view but its static label line is
// off-screen, lay a temporary chord label across the visible piece of it.

function startDynLabels(map) {
  let POLYS = null;
  let LAKEPOLYS = null;  // named lake polygons (dyn-only page mode labels them)
  let LAKEMETA = null;   // name -> min zoom ('from') for line-placed lake labels
  let STATIC = null;   // name -> [{min_label, bb}] from marinelabels baselines
  fetch(ASSET + 'data/marinelabels.geojson').then(r => r.json()).then(d => {
    STATIC = new Map();
    for (const f of d.features) {
      const name = f.properties && f.properties.name;
      if (!name) continue;
      let bb = [180, 90, -180, -90];
      const walk = c => {
        if (typeof c[0] === 'number') {
          bb = [Math.min(bb[0], c[0]), Math.min(bb[1], c[1]),
                Math.max(bb[2], c[0]), Math.max(bb[3], c[1])];
        } else c.forEach(walk);
      };
      walk(f.geometry.coordinates);
      if (!STATIC.has(name)) STATIC.set(name, []);
      STATIC.get(name).push({ min_label: f.properties.min_label ?? 0, bb,
        featurecla: f.properties.featurecla,
        geom: f.geometry });   // curated curve — reused when it fits the page
    }
  });
  // Lake data: polygons carry only names; zoom gates + placement class come
  // from the curated lakelabels baselines (stack==1 = beside-point label,
  // which stays static — the dyn engine only owns the IN-lake line labels).
  fetch(ASSET + 'data/lakelabels.geojson').then(r => r.json()).then(d => {
    LAKEMETA = new Map();
    for (const f of d.features) {
      const p = f.properties || {};
      if (!p.name || p.stack === 1 || (p.scalerank !== undefined && p.scalerank > 2)) continue;
      const cur = LAKEMETA.get(p.name);
      const from = p.from ?? 3.5;
      if (cur === undefined || from < cur) LAKEMETA.set(p.name, from);
    }
  });
  fetch(ASSET + 'data/lakes-50m.geojson').then(r => r.json()).then(d => {
    LAKEPOLYS = d.features.filter(f => f.properties && f.properties.name).map(f => {
      const rings = f.geometry.type === 'Polygon' ? [f.geometry.coordinates]
                                                  : f.geometry.coordinates;
      let bb = [180, 90, -180, -90];
      for (const poly of rings) for (const [x, y] of poly[0]) {
        bb = [Math.min(bb[0], x), Math.min(bb[1], y), Math.max(bb[2], x), Math.max(bb[3], y)];
      }
      // Polygons say "Lake Superior"; the label baselines (and the layer's
      // Lake-prefix text logic) use the bare "Superior" — normalize here.
      const bare = f.properties.name.replace(/^Lake /, '').replace(/ Lake$/, '');
      return { name: bare, rings, bb };
    });
  });
  fetch(ASSET + 'data/marinepolys.geojson').then(r => r.json()).then(d => {
    POLYS = d.features.map(f => {
      const rings = f.geometry.type === 'Polygon' ? [f.geometry.coordinates]
                                                  : f.geometry.coordinates;
      let bb = [180, 90, -180, -90];
      for (const poly of rings) for (const [x, y] of poly[0]) {
        bb = [Math.min(bb[0], x), Math.min(bb[1], y), Math.max(bb[2], x), Math.max(bb[3], y)];
      }
      return { p: f.properties, rings, bb };
    });
    refresh();
  });

  // GLOBE TRIAL (Maddy 2026-08-14): build the label guide with EVEN SCREEN
  // spacing. Sample the parallel densely, project to px, then pick points at
  // equal pixel arc-length — MapLibre then sets type along the curve with
  // uniform letter spacing at the limb and the center alike. (In geo-space
  // guides, projection compression bunches the glyphs near the globe edge.)
  function evenScreenCoords(lngA, lngB, lat) {
    const M = 120, pts = [], px = [];
    for (let i = 0; i <= M; i++) {
      const lng = lngA + (lngB - lngA) * i / M;
      pts.push([lng, lat]);
      const p = map.project([lng, lat]);
      px.push([p.x, p.y]);
    }
    const cum = [0];
    for (let i = 1; i <= M; i++)
      cum.push(cum[i - 1] + Math.hypot(px[i][0] - px[i-1][0], px[i][1] - px[i-1][1]));
    const total = cum[M];
    if (!(total > 0)) return null;
    const K = 24, out = [];
    for (let k = 0; k <= K; k++) {
      const t = total * k / K;
      let i = 1; while (i < M && cum[i] < t) i++;
      const f = (t - cum[i-1]) / Math.max(1e-9, cum[i] - cum[i-1]);
      out.push([pts[i-1][0] + (pts[i][0] - pts[i-1][0]) * f, lat]);
    }
    return out;
  }

  function inside(rings, x, y) {
    let inn = false;
    for (const poly of rings) for (const ring of poly) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i], [xj, yj] = ring[j];
        if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inn = !inn;
      }
    }
    return inn;
  }

  function refresh() {
    // Not ready → RETRY at next idle, or stale labels placed for the previous
    // viewport survive onto the new one (cut off at the page edge).
    if (!POLYS || !map.isStyleLoaded()) {
      setTimeout(refresh, 300);
      return;
    }
    const z = map.getZoom();
    const cw = map.getContainer().clientWidth, chh = map.getContainer().clientHeight;
    // 5%: enough to keep labels off the neatline without discarding edge
    // features entirely (12% swallowed Hudson Bay's whole visible slice).
    const PAD = Math.min(100, Math.round(Math.min(cw, chh) * 0.05));
    // Geo bounds of the inset viewport, sampled around the WHOLE border — on
    // the globe the viewport is not a geo rectangle (top-center reaches far
    // higher latitude than the corners; Hudson Bay lived in that bulge).
    let W = 999, E = -999, S = 999, N = -999;
    const KB = 8;
    for (let i = 0; i <= KB; i++) {
      const fx = PAD + (cw - 2 * PAD) * i / KB, fy = PAD + (chh - 2 * PAD) * i / KB;
      for (const pt of [[fx, PAD], [fx, chh - PAD], [PAD, fy], [cw - PAD, fy]]) {
        const u = map.unproject(pt);
        W = Math.min(W, u.lng); E = Math.max(E, u.lng);
        S = Math.min(S, u.lat); N = Math.max(N, u.lat);
      }
    }
    const shown = new Set(
      map.queryRenderedFeatures({ layers: ['ocean-labels', 'sea-labels'] })
        .map(f => f.properties.name));
    const feats = [];
    for (const f of POLYS) {
      const pr = f.p;
      if (z < pr.min_label) continue;
      if (pr.featurecla !== 'ocean' && pr.min_label > 4.5) continue;
      if (shown.has(pr.name)) continue;
      // Static-engine ownership (deterministic): if statics are visible and a
      // static baseline for this name is in view at this zoom, it labels — not us.
      if (!state.marineDynOnly && STATIC && STATIC.has(pr.name) &&
          STATIC.get(pr.name).some(s => z >= s.min_label &&
            s.bb[2] >= W && s.bb[0] <= E && s.bb[3] >= S && s.bb[1] <= N)) continue;
      if (f.bb[2] < W || f.bb[0] > E || f.bb[3] < S || f.bb[1] > N) continue;
      // Placement preference (Maddy 2026-08-14): 1) the CURATED curved
      // baseline, verbatim, when it fits entirely on the page (mercator —
      // on the globe curves compress at the limb, so the even-screen guides
      // take over there); 2) a flat single-line run; 3) stacked point.
      if (STATIC && STATIC.has(pr.name)) {
        const fit = STATIC.get(pr.name).find(b => z >= b.min_label &&
          b.bb[0] >= W && b.bb[2] <= E && b.bb[1] >= S && b.bb[3] <= N &&
          b.geom && b.geom.type === 'LineString');
        // Globe: the curated curve serves ONLY while legible — every point on
        // the near hemisphere and total projected bend under the limb
        // threshold (narrow diagonal seas keep their native axes mid-disc).
        let curatedOK = !!fit;
        if (fit && state.globe) {
          const cs = fit.geom.coordinates;
          let turn = 0, prevA = null;
          for (let i = 0; i < cs.length && curatedOK; i++) {
            if (!MLB.isVisible(map, cs[i])) { curatedOK = false; break; }
            if (i > 0) {
              const pa = map.project(cs[i - 1]), pb = map.project(cs[i]);
              const a = Math.atan2(pb.y - pa.y, pb.x - pa.x);
              if (prevA !== null) {
                let d = Math.abs(a - prevA); if (d > Math.PI) d = 2 * Math.PI - d;
                turn += d;
              }
              prevA = a;
            }
          }
          if (turn > 0.45) curatedOK = false;
        }
        if (curatedOK) {
          feats.push({ type: 'Feature',
            properties: { name: pr.name, featurecla: pr.featurecla },
            len: 999,   // curated placement always wins the per-name dedupe
            geometry: fit.geom });
          continue;
        }
      }
      const x0 = Math.max(W, f.bb[0]), x1 = Math.min(E, f.bb[2]);
      const y0 = Math.max(S, f.bb[1]), y1 = Math.min(N, f.bb[3]);
      if (x1 - x0 < 1e-6 || y1 - y0 < 1e-6) continue;
      let best = null, bestScore = 0;
      const rowRuns = [];   // widest run per sampled row — fuels the stacked fallback
      for (let r = 0; r < 11; r++) {
        const y = y0 + (y1 - y0) * (0.12 + 0.76 * r / 10);
        let run = null, bestRun = null;
        for (let c = 0; c <= 60; c++) {
          const x = x0 + (x1 - x0) * c / 60;
          // Globe: a lng∕lat inside the bbox can still be BEHIND the sphere —
          // runs must stay on the visible hemisphere or guides wrap the limb.
          const vis = !state.globe || MLB.isVisible(map, [x, y]);
          if (vis && inside(f.rings, x, y)) { run = run || [x, x]; run[1] = x; }
          else {
            if (run && (!bestRun || run[1] - run[0] > bestRun[1] - bestRun[0])) bestRun = run;
            run = null;
          }
        }
        if (run && (!bestRun || run[1] - run[0] > bestRun[1] - bestRun[0])) bestRun = run;
        if (!bestRun) continue;
        rowRuns.push({ y, x0: bestRun[0], x1: bestRun[1], r });
        // Globe scores in SCREEN pixels (geo-degrees overvalue high-latitude
        // rows on the sphere — the mockup parked the Atlantic at the limb).
        let len = bestRun[1] - bestRun[0];
        if (state.globe) {
          const pa = map.project([bestRun[0], y]), pb = map.project([bestRun[1], y]);
          len = Math.hypot(pb.x - pa.x, pb.y - pa.y);
        }
        const central = 1 - Math.abs((y - y0) / (y1 - y0) - 0.5);
        if (len * (0.5 + 0.5 * central) > bestScore) {
          bestScore = len * (0.5 + 0.5 * central);
          best = [bestRun[0], bestRun[1], y];
        }
      }
      if (!best) continue;
      const ocean = pr.featurecla === 'ocean';
      const size = ocean ? Math.min(16, Math.max(11, 11 + 5 * (z - 1.5) / 2.5))
                         : Math.min(11, Math.max(8.5, 8.5 + 2.5 * (z - 3) / 3));
      const perChar = size * (ocean ? 1.2 : 0.95);
      const ins = (best[1] - best[0]) * 0.05;
      const pxA = map.project([best[0] + ins, best[2]]);
      const pxB = map.project([best[1] - ins, best[2]]);
      // Ladder on BOTH projections: curve → single line → stacked point.
      // Globe LEGIBILITY RULE (Maddy 2026-08-14): a line that qualifies on
      // width can still be a limb-hugger whose curvature makes it illegible —
      // measure the guide's on-screen bend; past ~29° end-to-end it renders
      // as a flat stacked label instead. Mid-globe arcs (Mediterranean, Black
      // Sea) bend gently and keep their curves.
      let lineOK = Math.hypot(pxB.x - pxA.x, pxB.y - pxA.y) >= pr.name.length * perChar * 1.15;
      let gcoords = null;
      if (lineOK && state.globe) {
        gcoords = evenScreenCoords(best[0] + ins, best[1] - ins, best[2]);
        if (!gcoords) lineOK = false;
        else {
          // TOTAL accumulated turn along the guide (the half-chord version
          // underestimated bend by ~2× and let limb-huggers through).
          let turn = 0, prevA = null;
          for (let i = 1; i < gcoords.length; i++) {
            const pa = map.project(gcoords[i - 1]), pb = map.project(gcoords[i]);
            const a = Math.atan2(pb.y - pa.y, pb.x - pa.x);
            if (prevA !== null) {
              let d = Math.abs(a - prevA); if (d > Math.PI) d = 2 * Math.PI - d;
              turn += d;
            }
            prevA = a;
          }
          if (turn > 0.45) lineOK = false;   // >~26° total bend → flat stacked
        }
      }
      if (!lineOK) {
        // STACKED FALLBACK (atlas style): "ATLANTIC / OCEAN" on two lines at
        // the deepest open-water pocket of polygon ∩ page. Handles the narrow
        // coastal bands where no single-line run ever fits (Maddy 2026-08-14).
        const words = pr.name.split(' ');
        const longest = words.reduce((m, w) => Math.max(m, w.length), 0);
        const ptSize = size * 0.85;
        // True rendered width: uppercase glyph ~0.72em + the stacked layer's
        // letter-spacing (0.4em oceans / 0.2em seas) PER CHARACTER — the old
        // 0.75 estimate undersized ocean boxes ~40% and let real label edges
        // reach land past the sampled footprint.
        const perCh = ptSize * (0.72 + (pr.featurecla === 'ocean' ? 0.4 : 0.2));
        const needW = longest * perCh;                 // widest word, uppercase
        const needH = words.length * ptSize * 1.6;     // stacked lines
        const rowLat = 0.076 * (y1 - y0);              // sampled row spacing
        // Labels sit at the VISUAL CENTER of the visible water (Maddy
        // 2026-08-14, replaces the seaward bias): weight each row's midpoint
        // by its run length to get the slice centroid, then among pockets
        // that fit, take the one closest to it.
        let cgx = 0, cgy = 0, cgw = 0;
        for (const rr of rowRuns) {
          const wgt = rr.x1 - rr.x0;
          cgx += ((rr.x0 + rr.x1) / 2) * wgt; cgy += rr.y * wgt; cgw += wgt;
        }
        if (cgw > 0) { cgx /= cgw; cgy /= cgw; }
        const pcg = cgw > 0 ? map.project([cgx, cgy]) : null;
        let bestPt = null, bestPtDist = Infinity;
        let anyPt = null, anyPtScore = -Infinity;
        for (const rr of rowRuns) {
          const cx = (rr.x0 + rr.x1) / 2;
          // vertical extent: contiguous sampled rows whose run covers cx
          let up = 0, dn = 0;
          for (const o of rowRuns) {
            if (o === rr || o.x0 > cx || o.x1 < cx) continue;
            if (o.r < rr.r) up = Math.max(up, rr.r - o.r);
            else dn = Math.max(dn, o.r - rr.r);
          }
          const pa = map.project([rr.x0, rr.y]), pb = map.project([rr.x1, rr.y]);
          const wPx = Math.hypot(pb.x - pa.x, pb.y - pa.y);
          const pv1 = map.project([cx, Math.max(y0, rr.y - dn * rowLat)]);
          const pv2 = map.project([cx, Math.min(y1, rr.y + up * rowLat)]);
          const hPx = Math.hypot(pv2.x - pv1.x, pv2.y - pv1.y);
          const scorePt = Math.min(wPx - needW, hPx - needH);
          if (scorePt > 0 && pcg) {
            // The label's REAL footprint must be water: sample a 3×3 grid of
            // the box in screen px, unproject, require inside-polygon (sparse
            // row sampling alone let the Atlantic label sit on Iberia).
            const pc2 = map.project([cx, rr.y]);
            let wet = true;
            for (let gy = -1; gy <= 1 && wet; gy++)
              for (let gx = -1; gx <= 1 && wet; gx++) {
                const u = map.unproject([pc2.x + gx * needW / 2, pc2.y + gy * needH / 2]);
                if (!inside(f.rings, u.lng, u.lat)) wet = false;
              }
            if (wet) {
              const dist = Math.hypot(pc2.x - pcg.x, pc2.y - pcg.y);
              if (dist < bestPtDist) { bestPtDist = dist; bestPt = [cx, rr.y]; }
            }
          }
          // least-bad pocket: must at least fit the longest word's width
          if (wPx >= needW * 0.8 && scorePt > anyPtScore) {
            anyPtScore = scorePt; anyPt = [cx, rr.y];
          }
        }
        if (!bestPt && anyPt) bestPt = anyPt;   // stack SOMEWHERE over dropping the name
        if (bestPt) {
          // Never partially cropped: pull the label box fully inside the page
          // (screen-space clamp; matters most on the globe, where geo bounds
          // don't guarantee pixel insets).
          const wetAt = (px, py) => {
            for (let gy = -1; gy <= 1; gy++)
              for (let gx = -1; gx <= 1; gx++) {
                const u = map.unproject([px + gx * needW / 2, py + gy * needH / 2]);
                if (!inside(f.rings, u.lng, u.lat)) return false;
              }
            return true;
          };
          const pp = map.project(bestPt);
          // Breathing room, not just crop-avoidance: ~4% of the page per side
          // (min 26px) so edge oceans sit comfortably inboard of the neatline.
          const bx = Math.max(26, cw * 0.04), by = Math.max(26, chh * 0.04);
          const mX = needW / 2 + bx, mY = needH / 2 + by;
          const qx = Math.max(mX, Math.min(cw - mX, pp.x));
          const qy = Math.max(mY, Math.min(chh - mY, pp.y));
          if (qx !== pp.x || qy !== pp.y) {
            // Walk from the clamped (on-page) spot toward the wet original;
            // take the first fully-wet position. PRIORITY: on-page beats
            // fully-wet — if nothing along the walk is wet, use the CLAMPED
            // spot anyway. A label brushing the coast reads fine; a label
            // cut in half by the page edge does not (Maddy 2026-08-14).
            let placed = false;
            for (let t = 0; t <= 1.0001 && !placed; t += 0.2) {
              const tx = qx + (pp.x - qx) * t, ty = qy + (pp.y - qy) * t;
              if (wetAt(tx, ty)) {
                const uu = map.unproject([tx, ty]);
                bestPt = [uu.lng, uu.lat];
                placed = true;
              }
            }
            if (!placed) {
              const uu = map.unproject([qx, qy]);
              bestPt = [uu.lng, uu.lat];
            }
          }
        }
        if (bestPt) {
          feats.push({ type: 'Feature',
            properties: { name: pr.name, featurecla: pr.featurecla, stacked: 1 },
            len: 0.1,
            geometry: { type: 'Point', coordinates: bestPt } });
        }
        continue;
      }
      let coords = gcoords;   // globe guide already built (and bend-checked)
      if (!coords) {
        const n = Math.max(2, Math.round((best[1] - best[0]) / 1.5));
        coords = [];
        for (let i = 0; i <= n; i++)
          coords.push([best[0] + ins + (best[1] - best[0] - 2 * ins) * i / n, best[2]]);
      }
      feats.push({ type: 'Feature', properties: { name: pr.name, featurecla: pr.featurecla },
                   len: best[1] - best[0],
                   geometry: { type: 'LineString', coordinates: coords } });
    }
    // Lakes — dyn-only page mode: the engine owns in-lake labels, re-seated
    // into lake ∩ page exactly like the marine names. (Outside page mode the
    // static curated placements render and this block stays idle.)
    if (state.marineDynOnly && LAKEPOLYS && LAKEMETA) {
      for (const f of LAKEPOLYS) {
        const from = LAKEMETA.get(f.name);
        if (from === undefined || z < Math.max(3.5, from)) continue;
        if (f.bb[2] < W || f.bb[0] > E || f.bb[3] < S || f.bb[1] > N) continue;
        const x0 = Math.max(W, f.bb[0]), x1 = Math.min(E, f.bb[2]);
        const y0 = Math.max(S, f.bb[1]), y1 = Math.min(N, f.bb[3]);
        if (x1 - x0 < 1e-6 || y1 - y0 < 1e-6) continue;
        let best = null, bestScore = 0;
        for (let r = 0; r < 11; r++) {
          const y = y0 + (y1 - y0) * (0.12 + 0.76 * r / 10);
          let run = null, bestRun = null;
          for (let c = 0; c <= 60; c++) {
            const x = x0 + (x1 - x0) * c / 60;
            if (inside(f.rings, x, y)) { run = run || [x, x]; run[1] = x; }
            else {
              if (run && (!bestRun || run[1] - run[0] > bestRun[1] - bestRun[0])) bestRun = run;
              run = null;
            }
          }
          if (run && (!bestRun || run[1] - run[0] > bestRun[1] - bestRun[0])) bestRun = run;
          if (!bestRun) continue;
          const len = bestRun[1] - bestRun[0];
          const central = 1 - Math.abs((y - y0) / (y1 - y0) - 0.5);
          if (len * (0.5 + 0.5 * central) > bestScore) {
            bestScore = len * (0.5 + 0.5 * central);
            best = [bestRun[0], bestRun[1], y];
          }
        }
        if (!best) continue;
        // Display string matches the layer's Lake-prefix logic for width math.
        const disp = f.name.startsWith('Great ') ? f.name + ' Lake' : 'Lake ' + f.name;
        const size = Math.min(9.3, Math.max(7, 7 + 2.3 * (z - 3.5) / 2.5));
        const perChar = size * 0.62;
        const ins = (best[1] - best[0]) * 0.05;
        const pxA = map.project([best[0] + ins, best[2]]);
        const pxB = map.project([best[1] - ins, best[2]]);
        if (Math.hypot(pxB.x - pxA.x, pxB.y - pxA.y) < disp.length * perChar) continue;
        const n = Math.max(2, Math.round((best[1] - best[0]) / 1.5));
        const coords = [];
        for (let i = 0; i <= n; i++)
          coords.push([best[0] + ins + (best[1] - best[0] - 2 * ins) * i / n, best[2]]);
        if (state.globe) {
          feats.push({ type: 'Feature',
            properties: { name: f.name, featurecla: 'lake', stacked: 1 },
            len: best[1] - best[0],
            geometry: { type: 'Point', coordinates: [(best[0] + best[1]) / 2, best[2]] } });
        } else {
          feats.push({ type: 'Feature', properties: { name: f.name, featurecla: 'lake' },
                       len: best[1] - best[0],
                       geometry: { type: 'LineString', coordinates: coords } });
        }
      }
    }

    if (window.MF_DYN_DEBUG) console.log('[dyn]', JSON.stringify({
      z: +z.toFixed(2), dynOnly: state.marineDynOnly,
      lakesLoaded: !!(LAKEPOLYS && LAKEMETA), polys: POLYS && POLYS.length,
      feats: feats.map(f => f.properties.featurecla + ':' + f.properties.name) }));
    const byName = new Map();
    for (const f of feats)
      if (!byName.has(f.properties.name) || f.len > byName.get(f.properties.name).len)
        byName.set(f.properties.name, f);
    map.getSource('dynlabels').setData(
      { type: 'FeatureCollection', features: [...byName.values()] });
  }
  let t = null;
  const queueRefresh = () => {
    // Dedupe against static labels only AFTER symbol placement settles ('idle')
    // — at moveend+150ms placement is still running, the static Gulf of Mexico
    // isn't in queryRenderedFeatures yet, and both engines label it (dupes).
    clearTimeout(t);
    t = setTimeout(() => { map.once('idle', refresh); map.triggerRepaint(); }, 120);
  };
  map.on('moveend', queueRefresh);
  map.on('load', queueRefresh);
  map._dynRefresh = queueRefresh;
}

// ---- Dynamic boundary names (moveend engine, Phase 2) -----------------------
// Country and US-state names are placed per view at the visual centre (pole
// of inaccessibility) of the polygon's VISIBLE part: a country half off the
// page is named in the half you can see, and names never sit on a coast or
// in a neck. Polygons = 50m (build-boundaries.sh). Screen-space throughout,
// so globe and Mercator share one path; far-side globe vertices are culled.
function startBoundaryLabels(map) {
  let COUNTRIES = null, STATES = null;
  const load = (file, kind) => fetch(ASSET + 'data/' + file).then(r => r.json()).then(d =>
    d.features.map(f => ({
      kind, name: f.properties.name, min_label: f.properties.min_label ?? 0,
      postal: f.properties.postal || null,   // states: 2-letter code, the fallback label
      rings: f.geometry.type === 'Polygon' ? [f.geometry.coordinates[0]]
                                           : f.geometry.coordinates.map(p => p[0]),   // outer rings only
    })));
  load('country-polys-50m.geojson', 'country').then(a => { COUNTRIES = a; refresh(); });
  load('state-polys-50m.geojson', 'state').then(a => { STATES = a; refresh(); });

  // Sutherland-Hodgman clip of a screen-space ring to a rectangle
  function clipRect(ring, x0, y0, x1, y1) {
    const edges = [
      [p => p[0] >= x0, (a, b) => [x0, a[1] + (b[1] - a[1]) * (x0 - a[0]) / (b[0] - a[0])]],
      [p => p[0] <= x1, (a, b) => [x1, a[1] + (b[1] - a[1]) * (x1 - a[0]) / (b[0] - a[0])]],
      [p => p[1] >= y0, (a, b) => [a[0] + (b[0] - a[0]) * (y0 - a[1]) / (b[1] - a[1]), y0]],
      [p => p[1] <= y1, (a, b) => [a[0] + (b[0] - a[0]) * (y1 - a[1]) / (b[1] - a[1]), y1]],
    ];
    let out = ring;
    for (const [inside, cross] of edges) {
      const inp = out; out = [];
      if (!inp.length) break;
      let prev = inp[inp.length - 1];
      for (const cur of inp) {
        if (inside(cur)) { if (!inside(prev)) out.push(cross(prev, cur)); out.push(cur); }
        else if (inside(prev)) out.push(cross(prev, cur));
        prev = cur;
      }
    }
    return out;
  }
  const area = r => { let a = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]); return Math.abs(a) / 2; };
  const segDist = (p, a, b) => { let x = a[0], y = a[1], dx = b[0] - x, dy = b[1] - y;
    if (dx || dy) { const t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy);
      if (t > 1) { x = b[0]; y = b[1]; } else if (t > 0) { x += dx * t; y += dy * t; } }
    return Math.hypot(p[0] - x, p[1] - y); };
  function pointToPoly(p, ring) {
    let inside = false, d = Infinity;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i], b = ring[j];
      if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
      d = Math.min(d, segDist(p, a, b));
    }
    return inside ? d : -d;
  }
  // polylabel (Mapbox, MIT) — pole of inaccessibility by quadtree refinement
  function polylabel(ring, precision = 1) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of ring) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
    const w = maxX - minX, h = maxY - minY, cs = Math.min(w, h);
    if (cs === 0) return { x: minX, y: minY, d: 0 };
    let hh = cs / 2;
    const cell = (x, y, hh) => { const d = pointToPoly([x, y], ring); return { x, y, hh, d, max: d + hh * Math.SQRT2 }; };
    const queue = [];
    for (let x = minX; x < maxX; x += cs) for (let y = minY; y < maxY; y += cs) queue.push(cell(x + hh, y + hh, hh));
    let best = cell(minX + w / 2, minY + h / 2, 0);
    while (queue.length) {
      queue.sort((a, b) => a.max - b.max);
      const c = queue.pop();
      if (c.d > best.d) best = c;
      if (c.max - best.d <= precision) continue;
      const q = c.hh / 2;
      queue.push(cell(c.x - q, c.y - q, q), cell(c.x + q, c.y - q, q), cell(c.x - q, c.y + q, q), cell(c.x + q, c.y + q, q));
    }
    return best;
  }

  function refresh() {
    if (!COUNTRIES || !STATES || !map.isStyleLoaded()) { setTimeout(refresh, 300); return; }
    const z = map.getZoom();
    const cw = map.getContainer().clientWidth, chh = map.getContainer().clientHeight;
    const PAD = Math.min(100, Math.round(Math.min(cw, chh) * 0.05));
    const feats = [];
    const riverLayers = RIVER_LINE.filter(id => map.getLayer(id));
    let usVisible = false;   // any US state polygon has ground inside the inset view
    for (const f of [...COUNTRIES, ...STATES]) {
      if (f.kind === 'state' && !usVisible) {
        for (const ring of f.rings) {
          const scr = [];
          for (const ll of ring) { if (state.globe && !MLB.isVisible(map, ll)) continue; const p = map.project(ll); scr.push([p.x, p.y]); }
          if (scr.length >= 3 && clipRect(scr, PAD, PAD, cw - PAD, chh - PAD).length >= 3) { usVisible = true; break; }
        }
      }
      // Countries keep NE's per-feature min_label. States get NO zoom gate
      // (Maddy 2026-09-15: every state is named the moment state lines show;
      // the fit test + postal fallback decide name vs code).
      if (f.kind === 'country' && z < f.min_label) continue;
      // est. label footprint (px) for the fit test: chars x size x width-factor
      const size = f.kind === 'country'
        ? (z <= 2 ? 7.5 : z >= 6 ? 12 : 7.5 + (z - 2) * (z < 4 ? 1.0 : 1.25))
        : (z <= 4 ? 8 : z >= 7 ? 10.5 : 8 + (z - 4) * 2.5 / 3);   // keep in sync w/ state-labels text-size
      // Project + clip each ring ONCE; the fit test below runs per candidate text.
      const rings = [];
      for (const ring of f.rings) {
        // project; cull far-side globe vertices (round-trip test, see isVisible)
        const scr = [];
        for (const ll of ring) {
          if (state.globe && !MLB.isVisible(map, ll)) continue;
          const p = map.project(ll); scr.push([p.x, p.y]);
        }
        if (scr.length < 3) continue;
        const clipped = clipRect(scr, PAD, PAD, cw - PAD, chh - PAD);
        if (clipped.length >= 3) rings.push(clipped);
      }
      if (!rings.length) continue;
      // Label candidates, first fit wins. States (Maddy 2026-09-15): below
      // STATE_FULLNAME_Z the 2-letter postal code ONLY; from there the full
      // name, falling back to the code where space is short ("RI").
      // Countries (Maddy 2026-09-15): full size first, then 85% and 70% (the
      // layer stacks long names) so tight countries still get a name; a
      // country with room to spare steps UP to 120%.
      let candidates = [{ text: f.name, k: 1 }];
      if (f.kind === 'country') candidates = [1, 0.85, 0.7].map(k => ({ text: f.name, k }));
      else if (f.postal) candidates = (z < STATE_FULLNAME_Z ? [f.postal] : [f.name, f.postal]).map(text => ({ text, k: 1 }));
      const fitOf = (text, k) => {
        const s = size * k;
        const wpx = text.length * s * (f.kind === 'country' ? 0.78 : 0.56);
        const maxW = s * (f.kind === 'country' ? 7 : 6) * 1.6;
        const lines = Math.max(1, Math.ceil(wpx / maxW));
        const w = Math.min(wpx, maxW), h = s * 1.25 * lines;
        let b = null;
        for (const clipped of rings) {
          const A = area(clipped);
          if (A < w * h * 1.3) continue;
          const c = polylabel(clipped, 2);
          if (c.d < h * 0.55) continue;            // too thin for this text here
          if (!b || A > b.A) b = { A, c, ring: clipped };
        }
        return b && { best: b, w, h };
      };
      let best = null, label = null, needW = 0, needH = 0, sizeK = 1;
      for (const { text, k } of candidates) {
        const r = fitOf(text, k);
        if (r) { best = r.best; label = text; needW = r.w; needH = r.h; sizeK = k; break; }
      }
      if (!best) continue;
      if (f.kind === 'country' && sizeK === 1) {           // roomy? step up
        const r = fitOf(f.name, 1.2);
        // 20× the label box = genuinely large countries only (6× gave 19 of
        // 24 European countries the bump at z3.5).
        if (r && r.best.A >= r.w * r.h * 20) { best = r.best; needW = r.w; needH = r.h; sizeK = 1.2; }
      }
      // Prefer a spot that does not cross a river line (Maddy 2026-09-09):
      // step outward from the visual centre in rings of candidates, keep the
      // first whose label box (a) stays inside the polygon and (b) has no
      // rendered river under it. Falls back to the centre.
      let cx = best.c.x, cy = best.c.y;
      if (state.riversOn && riverLayers.length) {
        const clear = (x, y) => !map.queryRenderedFeatures(
          [[x - needW / 2, y - needH / 2], [x + needW / 2, y + needH / 2]], { layers: riverLayers }).length;
        if (!clear(cx, cy)) {
          let found = null;
          for (let r = needH; r <= needH * 4 && !found; r += needH) {
            for (let k = 0; k < 12 && !found; k++) {
              const a = k * Math.PI / 6, x = best.c.x + Math.cos(a) * r, y = best.c.y + Math.sin(a) * r;
              if (pointToPoly([x, y], best.ring) < needH * 0.55) continue;   // must stay well inside
              if (clear(x, y)) found = [x, y];
            }
          }
          if (found) { cx = found[0]; cy = found[1]; }
        }
      }
      const ll = map.unproject([cx, cy]);
      feats.push({ type: 'Feature', properties: { name: f.name, label, kind: f.kind,
                     size: f.kind === 'country' ? +(size * sizeK * (state.pageScale || 1)).toFixed(2) : undefined },
                   geometry: { type: 'Point', coordinates: [ll.lng, ll.lat] } });
    }
    if (window.MF_DYN_DEBUG) console.log('[bnd-labels]', feats.length, feats.map(f => f.properties.name).join(', '));
    map.getSource('boundarylabels').setData({ type: 'FeatureCollection', features: feats });
    // tell the app whether the US is in frame (US States rows hide when not)
    if (map._usVisible !== usVisible) { map._usVisible = usVisible; if (MLB.onUsVisible) MLB.onUsVisible(usVisible); }
  }
  let t = null;
  const queue = () => { clearTimeout(t); t = setTimeout(refresh, 120); };
  map.on('moveend', queue);
  map.on('load', queue);
  map._bndRefresh = queue;
}

// ---- Public API -------------------------------------------------------------
// (setMarineDynOnly lives on MLB below)

// Multiply every numeric output in a size expression by k (interpolate stops
// and case branches; leaves structure/getters untouched).
function scaleSizeExpr(expr, k) {
  if (typeof expr === 'number') return expr * k;
  if (!Array.isArray(expr)) return expr;
  const op = expr[0];
  if (op === 'interpolate') {
    return expr.map((e, i) => (i >= 3 && i % 2 === 0) ? scaleSizeExpr(e, k) : e);
  }
  if (op === 'case') {
    return expr.map((e, i) => (i >= 2) ? scaleSizeExpr(e, k) : e);
  }
  return expr;
}

const HANDLERS = ['dragPan', 'scrollZoom', 'doubleClickZoom', 'touchZoomRotate',
                  'keyboard', 'boxZoom', 'dragRotate'];

let _map = null;

let _pmtilesWired = false;
const MLB = {
  onUsVisible: null,   // app hook: (bool) => void, fired when US-in-frame changes
  // Page locked → static marine labels off, dyn engine owns all marine names
  // (places them inside the viewport by construction). Unlock → statics back.
  setMarineDynOnly(map, on) {
    state.marineDynOnly = !!on;
    applyLabelVis(map);
    if (map._dynRefresh) map._dynRefresh();
    if (map._bndRefresh) map._bndRefresh();
  },
  create(containerEl) {
    if (!_pmtilesWired) {
      maplibregl.addProtocol('pmtiles', new pmtiles.Protocol().tile);
      _pmtilesWired = true;
    }
    // Release the previous instance FIRST — every Map holds a WebGL context,
    // and stacking them gets the page blocked from creating any ("context
    // loss" cap, ~16 per page). Real incident 2026-08-14: repeated live-map
    // opens leaked contexts until Chrome refused WebGL entirely.
    if (_map) { try { _map.remove(); } catch (e) {} _map = null; }
    const map = new maplibregl.Map({
      container: containerEl, style: buildStyle(),
      center: [-98.5, 39.8], zoom: 3, minZoom: 2, maxZoom: 6,
      maxPitch: 0, attributionControl: { compact: true },
      preserveDrawingBuffer: true,   // REQUIRED for snapshot/export readback
    });
    map.on('webglcontextrestored', () => {
      MLB.applyToggleState(map, state);
    });
    // Automatic zoom state (graticule out / states in) follows every settled
    // view while it lasts; a manual toggle clears state.autoZoomLayers.
    map.on('load', () => applyAutoZoomLayers(map));
    map.on('moveend', () => applyAutoZoomLayers(map));
    // DEV-ONLY zoom readout (Maddy 2026-09-15): bottom-left of the desk, shows
    // the live zoom + the US-framed threshold the auto ladder keys off.
    // Localhost or `?zoom` in the URL only — never on the hosted site.
    if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname) || /[?&]zoom\b/.test(location.search)) {
      let el = document.getElementById('mf-zoom-readout');
      if (!el) {
        el = document.createElement('div');
        el.id = 'mf-zoom-readout';
        el.style.cssText = 'position:absolute;left:10px;bottom:10px;z-index:35;pointer-events:none;' +
          'font:600 11px/1 Jost,Georgia,serif;letter-spacing:.03em;color:#FAF5EA;' +
          'background:rgba(42,31,14,.75);padding:5px 9px;border-radius:999px;';
        (document.getElementById('canvas-wrap') || document.body).appendChild(el);
      }
      const upd = () => { el.textContent = 'z ' + map.getZoom().toFixed(2); };
      map.on('move', upd); map.on('load', upd); map.on('resize', upd);
    }
    // POLAR GUARD: Web Mercator data ends at ±85.05° — staring at the pole
    // shows the projection void ("all map data lost", Maddy 2026-08-14).
    // Softly ease the camera back when the center crosses ±80°.
    map.on('moveend', () => {
      const c = map.getCenter();
      if (Math.abs(c.lat) > 80) {
        map.easeTo({ center: [c.lng, Math.sign(c.lat) * 80], duration: 350 });
      }
    });
    startDynLabels(map);
    startBoundaryLabels(map);
    _map = map;
    return map;
  },

  // ---- Geo <-> canvas-backing-pixel conversion (geo-anchored annotations) ----
  // map.project works in CSS px; the annotation canvas backing store is DPR-
  // scaled, so convert through the backing/CSS ratio each call.
  toScreen(map, lnglat, canvas) {
    const p = map.project(lnglat);
    const k = canvas.width / map.getContainer().clientWidth;
    return { x: p.x * k, y: p.y * k };
  },
  toGeo(map, x, y, canvas) {
    const k = canvas.width / map.getContainer().clientWidth;
    const ll = map.unproject([x / k, y / k]);
    return [ll.lng, ll.lat];
  },
  // Far-side-of-globe cull, proven 2026-08-05: visible points round-trip
  // project->unproject with ~0 error; beyond-horizon points fail by >=5 deg
  // immediately. Longitude delta MUST be wrapped or Mercator false-culls.
  isVisible(map, lnglat) {
    const rt = map.unproject(map.project(lnglat));
    let dl = rt.lng - lnglat[0];
    dl = ((dl + 180) % 360 + 360) % 360 - 180;
    return Math.hypot(dl, rt.lat - lnglat[1]) < 0.5;
  },

  // Shade trial (2026-08-13): shades as a native fill layer. Kept below the
  // first symbol layer so labels stay on top. classificationSnapshot hides it.
  setShadeFeatures(map, features) {
    // Flattened per-(color,style) polygons from the app. Solid regions render
    // via fill-color; Pattern/Plus regions via generated sprite images —
    // same cells the canvas engine paints, so painting and committed shades
    // finally look identical. Both layers sit on top (halos tint under).
    const dpr = (typeof devicePixelRatio !== 'undefined' && devicePixelRatio) || 1;
    const ensurePattern = (style, color) => {
      const id = 'mfpat-' + style + '-' + color;
      if (map.hasImage && map.hasImage(id)) return id;
      const light42 = blendHex(color, '#ffffff', 0.42);
      const light52 = blendHex(color, '#ffffff', 0.52);
      const t = document.createElement('canvas');
      const tc2 = t.getContext('2d');
      if (style === 'speckle') {                // mirror makeSpecklePattern
        const N = 22; t.width = t.height = N;   // transparent ground — dots only
        tc2.fillStyle = color;
        [[3,4],[11,2],[18,6],[6,10],[14,12],[2,16],[10,19],[19,15],[16,20],[7,15]].forEach(([x,y],i) => {
          tc2.beginPath(); tc2.arc(x, y, i % 3 === 0 ? 1.4 : 1.0, 0, Math.PI * 2); tc2.fill();
        });
      } else if (style === 'stripe') {
        const W = 24, N = W * 2;                 // mirror makeStripePattern
        t.width = t.height = N;
        tc2.fillStyle = color; tc2.fillRect(0, 0, N, N);
        tc2.fillStyle = light42;
        tc2.beginPath(); tc2.moveTo(0, 0); tc2.lineTo(W, 0); tc2.lineTo(0, W); tc2.closePath(); tc2.fill();
        tc2.beginPath(); tc2.moveTo(W, N); tc2.lineTo(N, N); tc2.lineTo(N, W); tc2.closePath(); tc2.fill();
      } else {                                    // plus: light body + plus grid
        const SP = 14; t.width = t.height = SP;
        tc2.fillStyle = light52; tc2.fillRect(0, 0, SP, SP);
        tc2.strokeStyle = color; tc2.lineWidth = 1.5; tc2.lineCap = 'round';
        const cx = SP / 2, cy = SP / 2, r = 4;
        tc2.beginPath(); tc2.moveTo(cx - r, cy); tc2.lineTo(cx + r, cy);
        tc2.moveTo(cx, cy - r); tc2.lineTo(cx, cy + r); tc2.stroke();
      }
      map.addImage(id, tc2.getImageData(0, 0, t.width, t.height), { pixelRatio: dpr });
      return id;
    };
    features.forEach(f => {
      if (f.properties.style && f.properties.style !== 'solid')
        f.properties.pat = ensurePattern(f.properties.style, f.properties.color);
    });
    const data = { type: 'FeatureCollection', features };
    const apply = () => {
      if (!map.getSource('mf-shades')) {
        map.addSource('mf-shades', { type: 'geojson', data });
        map.addLayer({ id: 'mf-shades', type: 'fill', source: 'mf-shades',
          filter: ['==', ['get', 'style'], 'solid'],
          paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.38 } });
        map.addLayer({ id: 'mf-shades-pat', type: 'fill', source: 'mf-shades',
          filter: ['!=', ['get', 'style'], 'solid'],
          paint: { 'fill-pattern': ['get', 'pat'], 'fill-opacity': 0.38 } });
      } else {
        map.getSource('mf-shades').setData(data);
      }
      ['mf-shades', 'mf-shades-pat'].forEach(id => {
        if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'visible');
      });
    };
    if (map.style && map.style._loaded) apply(); else map.once('style.load', apply);
  },

  // Fills as a native fill layer (2026-09-19, same architecture as the shade
  // 'ml' engine above): committed fill polygons live INSIDE the map, inserted
  // beneath the coastlines — so rivers, lakes, boundary lines, and every name
  // label render on top of the fill instead of being painted over. The canvas
  // engine keeps rendering legacy (pre-vectorization) flood fills only.
  setFillFeatures(map, features) {
    const dpr = (typeof devicePixelRatio !== 'undefined' && devicePixelRatio) || 1;
    // Pattern sprites: same ids + same tile generation as the shade layer's
    // ensurePattern, so a stripe fill and a stripe shade share one image.
    const ensurePattern = (style, color) => {
      const id = 'mfpat-' + style + '-' + color;
      if (map.hasImage && map.hasImage(id)) return id;
      const light42 = blendHex(color, '#ffffff', 0.42);
      const light52 = blendHex(color, '#ffffff', 0.52);
      const t = document.createElement('canvas');
      const tc2 = t.getContext('2d');
      if (style === 'speckle') {
        const N = 22; t.width = t.height = N;
        tc2.fillStyle = color;
        [[3,4],[11,2],[18,6],[6,10],[14,12],[2,16],[10,19],[19,15],[16,20],[7,15]].forEach(([x,y],i) => {
          tc2.beginPath(); tc2.arc(x, y, i % 3 === 0 ? 1.4 : 1.0, 0, Math.PI * 2); tc2.fill();
        });
      } else if (style === 'stripe') {
        const W = 24, N = W * 2;
        t.width = t.height = N;
        tc2.fillStyle = color; tc2.fillRect(0, 0, N, N);
        tc2.fillStyle = light42;
        tc2.beginPath(); tc2.moveTo(0, 0); tc2.lineTo(W, 0); tc2.lineTo(0, W); tc2.closePath(); tc2.fill();
        tc2.beginPath(); tc2.moveTo(W, N); tc2.lineTo(N, N); tc2.lineTo(N, W); tc2.closePath(); tc2.fill();
      } else {
        const SP = 14; t.width = t.height = SP;
        tc2.fillStyle = light52; tc2.fillRect(0, 0, SP, SP);
        tc2.strokeStyle = color; tc2.lineWidth = 1.5; tc2.lineCap = 'round';
        const cx = SP / 2, cy = SP / 2, r = 4;
        tc2.beginPath(); tc2.moveTo(cx - r, cy); tc2.lineTo(cx + r, cy);
        tc2.moveTo(cx, cy - r); tc2.lineTo(cx, cy + r); tc2.stroke();
      }
      map.addImage(id, tc2.getImageData(0, 0, t.width, t.height), { pixelRatio: dpr });
      return id;
    };
    features.forEach(f => {
      if (f.properties.style && f.properties.style !== 'solid')
        f.properties.pat = ensurePattern(f.properties.style, f.properties.color);
    });
    const data = { type: 'FeatureCollection', features };
    const apply = () => {
      if (!map.getSource('mf-fills')) {
        // Below the lowest coast layer: above land + relief (a fill covers the
        // hillshade, as it always has), below every water line, border, label.
        const before = map.getLayer('coast-110m') ? 'coast-110m' : undefined;
        map.addSource('mf-fills', { type: 'geojson', data });
        map.addLayer({ id: 'mf-fills', type: 'fill', source: 'mf-fills',
          filter: ['==', ['get', 'style'], 'solid'],
          paint: { 'fill-color': ['get', 'color'] } }, before);
        map.addLayer({ id: 'mf-fills-pat', type: 'fill', source: 'mf-fills',
          filter: ['!=', ['get', 'style'], 'solid'],
          paint: { 'fill-pattern': ['get', 'pat'] } }, before);
        // Solid fills get a same-color outline: the flood stops at the edge of
        // the (wider) classification barrier, so the traced ring sits a
        // hairline short of the border ink — the stroke closes that gap and
        // smooths the pixel-lattice trace. Pattern fills go without (their
        // ground is open; an outline would draw a border that isn't there).
        map.addLayer({ id: 'mf-fills-line', type: 'line', source: 'mf-fills',
          filter: ['==', ['get', 'style'], 'solid'],
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: { 'line-color': ['get', 'color'], 'line-width': 1.5 } }, before);
      } else {
        map.getSource('mf-fills').setData(data);
      }
      ['mf-fills', 'mf-fills-pat', 'mf-fills-line'].forEach(id => {
        if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'visible');
      });
    };
    if (map.style && map.style._loaded) apply(); else map.once('style.load', apply);
  },

  lockView(map) { HANDLERS.forEach(h => map[h] && map[h].disable()); },
  unlockView(map) { HANDLERS.forEach(h => map[h] && map[h].enable()); },

  getToggleState() { return { ...state }; },
  // The land tone currently under the map's text: relief land when Terrain is
  // on, the flat cream otherwise. Used by the credit halo (page + export).
  landColor() { return (state.layersGroupOn && state.reliefOn) ? LAND : LAND_NO_RELIEF; },

  onAutoLayers: null,   // app hook: () => void, fired when the automatic state flips a layer
  autoLayerZoom(map) { return autoLayerZoom(map); },   // the US-framed zoom for this page size
  // A fresh map starts in the automatic zoom state, even if an earlier map in
  // this session was switched to manual.
  resetAutoZoomLayers(map) {
    state.autoZoomLayers = true;
    if (map && map.isStyleLoaded && map.isStyleLoaded()) applyAutoZoomLayers(map);
  },

  applyToggleState(map, s) {
    // Saves made before autoZoomLayers existed: honour their layer choices
    // exactly (manual, never re-derived from zoom), and fill any key they
    // predate from the PRISTINE defaults — not from the live state, which the
    // automatic zoom state may already have changed on map load.
    // Every restore starts from the pristine defaults, then the save's own
    // keys — so a key a save lacks never inherits the previous map's state
    // (library maps are opened with autoZoomLayers:true but no layer keys).
    const legacy = !s || !('autoZoomLayers' in s);
    Object.assign(state, DEFAULT_STATE, legacy ? { autoZoomLayers: false } : {}, s);
    // setProjection/setPaintProperty throw before the style loads, and
    // restoreLiveMap hits exactly that window on a cold cache — the thrown
    // exception aborted the whole restore (found 2026-08-13 by the
    // regression harness). Defer the full application until style.load.
    const run = () => {
      applyProjection(map);
      applyGrey(map);
      applyRiverVis(map);   // includes label + boundary-label visibility
      applyGraticuleVis(map);
      applyReliefVis(map);
      applyLakeVis(map);
      applyAutoZoomLayers(map);   // saves made in the automatic state keep it
    };
    if (map.style && map.style._loaded) run();
    else map.once('style.load', run);
  },

  // Toggle one of 'globe' | 'greyOn' | 'riversOn' | 'riverLabelsOn' | 'labelsOn'
  // (water names) | 'countriesOn' | 'countryLabelsOn' | 'statesOn' |
  // 'stateLabelsOn' | 'graticuleOn'; returns the new value.
  toggle(map, key) {
    // A manual Graticule/States/Countries choice ends the automatic zoom state for good.
    if (key === 'graticuleOn' || key === 'statesOn' || key === 'countriesOn') state.autoZoomLayers = false;
    state[key] = !state[key];
    // A layer's NAMES follow the layer, with MEMORY (Maddy 2026-09-15):
    // layer off → its names go off; layer back on → the names return to
    // whatever they were BEFORE the layer went off (names the user had
    // switched off stay off until they switch them on). Minor Lakes has no
    // own label key (lake names filter by MAJOR_LAKE_NAMES); water names have
    // no single layer.
    const PAIRED_LABEL = { riversOn: 'riverLabelsOn', countriesOn: 'countryLabelsOn', statesOn: 'stateLabelsOn' };
    const lab = PAIRED_LABEL[key];
    if (lab) {
      state._labelBeforeOff = state._labelBeforeOff || {};
      if (!state[key]) { state._labelBeforeOff[lab] = state[lab]; state[lab] = false; }
      else state[lab] = lab in state._labelBeforeOff ? state._labelBeforeOff[lab] : true;
    }
    if (key === 'globe') applyProjection(map);
    else if (key === 'greyOn') applyGrey(map);
    else if (key === 'riversOn') applyRiverVis(map);
    else if (key === 'countriesOn' || key === 'statesOn' ||
             key === 'countryLabelsOn' || key === 'stateLabelsOn') applyBoundaryVis(map);
    else if (key === 'graticuleOn') applyGraticuleVis(map);
    else if (key === 'reliefOn') applyReliefVis(map);
    else if (key === 'minorLakesOn') applyLakeVis(map);
    else if (key === 'layersGroupOn') { applyRiverVis(map); applyGraticuleVis(map); applyReliefVis(map); applyLakeVis(map); }
    else applyLabelVis(map);   // labelsGroupOn and every *LabelsOn key
    return state[key];
  },

  // Page-size multiplier: scales every label size, halo, and line width so the
  // map's type/strokes track the physical paper — a Figure carries chunkier
  // relative type than an 11×17, and PRINTED sizes come out consistent.
  // k = 1 reproduces the authored style.
  setPageScale(map, k) {
    if (!map.isStyleLoaded()) return;
    state.pageScale = k;
    const S = (expr) => scaleSizeExpr(expr, k);
    // River label bands
    RIVER_LABELS.forEach(id => { if (!map.getLayer(id)) return;
      map.setLayoutProperty(id, 'text-size',
        S(['interpolate', ['linear'], ['zoom'], 1, 6.6, 4, 8.2, 6, 9.1]));
      map.setPaintProperty(id, 'text-halo-width', 3.2 * k);
    });
    const T = (id, expr, halo) => { if (!map.getLayer(id)) return;
      map.setLayoutProperty(id, 'text-size', S(expr));
      map.setPaintProperty(id, 'text-halo-width', halo * k); };
    T('ocean-labels', ['interpolate', ['linear'], ['zoom'], 1.5, 9.7, 4, 14], 2);
    T('sea-labels',   ['interpolate', ['linear'], ['zoom'], 3, 7.5, 6, 9.7], 2);
    T('dyn-marine-labels', ['interpolate', ['linear'], ['zoom'],
      1.5, ['case', ['==', ['get', 'featurecla'], 'ocean'], 9.7, 7.5],
      3,   ['case', ['==', ['get', 'featurecla'], 'ocean'], 12.3, 7.5],
      4,   ['case', ['==', ['get', 'featurecla'], 'ocean'], 14, 8.2],
      6,   ['case', ['==', ['get', 'featurecla'], 'ocean'], 14, 9.7]], 2);
    T('lake-labels',    ['interpolate', ['linear'], ['zoom'], 3.5, 7, 6, 9.3], 4);
    T('lake-labels-pt', ['interpolate', ['linear'], ['zoom'], 3.5, 7, 6, 9.3], 4);
    // Linework
    ['coast-110m','coast-50m','coast-10m','lakeline-50m','lakeline-10m','rivers-110m']
      .forEach(id => map.getLayer(id) && map.setPaintProperty(id, 'line-width', 1.25 * k));
    ['rivers-50m','rivers-10m'].forEach(id =>
      map.getLayer(id) && map.setPaintProperty(id, 'line-width', riverWidthExpr(k)));
    if (map.getLayer('rivers-texture'))
      map.setPaintProperty('rivers-texture', 'line-width', 0.6 * k);
    if (map.getLayer('graticule'))
      map.setPaintProperty('graticule', 'line-width',
        ['case', ['==', ['get', 'eq'], 1], 1.8 * k, 1.2 * k]);   // keep in sync w/ style (dotted)
    // Boundaries
    COUNTRY_LINES.forEach(id => map.getLayer(id) && map.setPaintProperty(id, 'line-width', 1.4 * k));
    STATE_LINES.forEach(id => map.getLayer(id) && map.setPaintProperty(id, 'line-width', 1.0 * k));
    // Country sizes are per-feature (placement engine bakes in pageScale) —
    // only the halo is set here; re-place so the sizes pick up the new k.
    if (map.getLayer('country-labels')) map.setPaintProperty('country-labels', 'text-halo-width', 1.6 * k);
    if (map._bndRefresh) map._bndRefresh();
    T('state-labels',   ['interpolate', ['linear'], ['zoom'], 4, 8, 7, 10.5], 1.4);   // keep in sync w/ style
  },

  // Resolves when the map is fully rendered; safe to call while already idle.
  // ALWAYS trigger a repaint first — 'idle' only fires after a render, so on an
  // already-idle map the bare listener never resolves (observed 2026-08-04).
  awaitIdle(map, maxMs = 15000) {
    // Bounded: a wedged tile request or a repaint loop must never hang the
    // caller forever (exports chain several of these). On timeout we resolve
    // with whatever has rendered — imperfect beats infinite.
    // A brand-new map can emit 'idle' BEFORE its style.json arrives (no
    // sources yet = nothing in flight), so "idle" alone doesn't mean ready —
    // cold-cache restores crashed on this (harness find, 2026-08-13). Gate
    // on style.load first, then wait for real idle.
    const styleReady = (map.style && map.style._loaded)
      ? Promise.resolve()
      : new Promise(res => {
          map.once('style.load', res);
          setTimeout(res, maxMs);          // bounded, same contract as below
        });
    return styleReady.then(() => new Promise(res => {
      let done = false;
      const finish = () => { if (!done) { done = true; clearTimeout(t); res(); } };
      const t = setTimeout(() => {
        // Name the culprit: which sources are still not loaded at timeout
        try {
          const stuck = Object.keys(map.getStyle().sources)
            .filter(id => { try { return !map.isSourceLoaded(id); } catch (e) { return false; } });
          console.warn('[awaitIdle] timed out after', maxMs, 'ms; sources not loaded:', stuck,
                       'map.loaded()=', map.loaded());
        } catch (e) {}
        finish();
      }, maxMs);
      map.once('idle', finish);
      map.triggerRepaint();
    }));
  },

  // Resolves when the style itself is loaded — getStyle()/isStyleLoaded()
  // usable. awaitIdle is NOT enough: in a hidden/backgrounded tab the render
  // loop is throttled, so its bounded timeouts can resolve before the style
  // arrives and getStyle() is still undefined (restore crash, 2026-08-28).
  // 'styledata' can fire before isStyleLoaded() flips true, so a slow poll
  // backs up the listener; bounded like awaitIdle so a dead style fetch can't
  // hang the caller.
  awaitStyleLoaded(map, maxMs = 15000) {
    if (map.isStyleLoaded()) return Promise.resolve();
    return new Promise(res => {
      const t0 = Date.now();
      let timer = null;
      const check = () => {
        clearTimeout(timer);
        if (map.isStyleLoaded() || Date.now() - t0 >= maxMs) {
          map.off('styledata', check);
          res();
        } else {
          timer = setTimeout(check, 250);
        }
      };
      map.on('styledata', check);
      timer = setTimeout(check, 250);
    });
  },

  // High-resolution snapshot for PRINT/EXPORT: temporarily raises the map's
  // pixel ratio so the vector linework, halos, and labels re-render truly
  // sharp (the data is vector — this is a re-render, not an upscale), then
  // restores the on-screen ratio. Brief flicker during export is expected.
  async printSnapshot(map, ratio) {
    const orig = map.getPixelRatio();
    if (!ratio || ratio <= orig) return MLB.snapshotToCanvas(map);
    // A snapshot with no rendered frame (idle timeout before first paint at
    // the raised ratio) is fully transparent — NEVER return that. Verify
    // content; step the ratio down and retry; final fallback = the on-screen
    // buffer, which always has pixels.
    const hasInk = (c) => {
      try {
        const s = 64, t = document.createElement('canvas');
        t.width = s; t.height = s;
        const tc = t.getContext('2d');
        tc.drawImage(c, 0, 0, s, s);
        const d = tc.getImageData(0, 0, s, s).data;
        for (let i = 3; i < d.length; i += 16) if (d[i] > 0) return true;
        return false;
      } catch (e) { return true; }
    };
    for (const r of [ratio, Math.max(2, ratio / 2)]) {
      if (r <= orig) break;
      map.setPixelRatio(r);
      try {
        await MLB.awaitIdle(map);
        const snap = MLB.snapshotToCanvas(map);
        if (hasInk(snap)) return snap;
        console.warn('[printSnapshot] blank at ratio', r, '- stepping down');
      } finally {
        map.setPixelRatio(orig);
      }
      await MLB.awaitIdle(map, 5000);   // let the screen buffer repaint
    }
    console.warn('[printSnapshot] falling back to screen-resolution snapshot');
    return MLB.snapshotToCanvas(map);
  },

  // Snapshot for CLASSIFICATION (flood fill / land mask): renders only the
  // geographic fills and lines — relief, graticule, and every label are
  // temporarily hidden so terrain shading and cosmetic linework can never
  // become fill barriers or speckle holes. Restores visibilities afterwards.
  async classificationSnapshot(map) {
    // FREEZE-FRAME: the pass below strips relief/graticule/labels for seconds
    // while tiles settle — cover the map with its current image so the user
    // never sees the stripped state.
    const container = map.getContainer();
    const freeze = document.createElement('canvas');
    const src = map.getCanvas();
    freeze.width = src.width; freeze.height = src.height;
    freeze.getContext('2d').drawImage(src, 0, 0);
    freeze.style.cssText =
      'position:absolute;inset:0;width:100%;height:100%;z-index:5;pointer-events:none;';
    container.appendChild(freeze);
    try {
      // getStyle() is undefined until the style loads (hidden-tab restores
      // can get here that early) — wait, then tolerate an empty style.
      await MLB.awaitStyleLoaded(map);
      const style = map.getStyle();
      const symbolIds = ((style && style.layers) || [])
        .filter(l => l.type === 'symbol').map(l => l.id);
      // VIGNETTES must hide too: their soft water-glow radiates past the true
      // coastline and classifies as water, standing the fill/shade masks off
      // every coast and haloing small lakes (misaligned clip edges).
      const hideIds = ['relief', 'graticule', 'mf-shades',
                       'mf-fills', 'mf-fills-pat', 'mf-fills-line',   // committed fills must never classify
                       ...VIGNETTES, ...symbolIds];
      const prev = {};
      hideIds.forEach(id => {
        if (!map.getLayer(id)) return;
        prev[id] = map.getLayoutProperty(id, 'visibility') || 'visible';
        map.setLayoutProperty(id, 'visibility', 'none');
      });
      // BOUNDARY LINES stay in the pass, restyled as BARRIERS (2026-09-19):
      // hidden they can't stop the fill tool, and as-styled they can't either —
      // state lines are too light to classify and disputed borders are dashed
      // (a flood walks straight through the gaps). Repaint every VISIBLE
      // boundary layer solid magenta and a bit wider: buildLandMask reads
      // magenta as LAND (shade/land masks unchanged — Maddy's seam fix holds),
      // and the app lifts those pixels into a separate flood-barrier mask.
      // Hidden boundary layers stay hidden — invisible borders block nothing.
      const bPrev = {};
      const BARRIER_PAINT = { 'line-color': '#FF00FF', 'line-width': 2.5,
                              'line-dasharray': [1, 0] };
      BOUNDARY_LINES.forEach(id => {
        if (!map.getLayer(id)) return;
        if ((map.getLayoutProperty(id, 'visibility') || 'visible') === 'none') return;
        bPrev[id] = {};
        Object.entries(BARRIER_PAINT).forEach(([p, v]) => {
          bPrev[id][p] = map.getPaintProperty(id, p);
          map.setPaintProperty(id, p, v);
        });
      });
      await MLB.awaitIdle(map);
      const snap = MLB.snapshotToCanvas(map);
      Object.entries(bPrev).forEach(([id, props]) => {
        if (!map.getLayer(id)) return;
        Object.entries(props).forEach(([p, v]) => map.setPaintProperty(id, p, v));
      });
      Object.entries(prev).forEach(([id, v]) =>
        map.setLayoutProperty(id, 'visibility', v));
      // The captured visibility can be stale: if toggles/marineDynOnly changed
      // while this pass was in flight, restoring `prev` would resurrect layers
      // that should be hidden. State is truth — re-assert after every restore.
      // Graticule + relief too: the automatic zoom state flips the graticule on
      // moveend, the same moment this pass runs, so a stale `prev` could undo it.
      applyRiverVis(map);
      applyGraticuleVis(map);
      applyReliefVis(map);
      await MLB.awaitIdle(map);   // restored layers repainted BEFORE unfreezing
      return snap;
    } finally {
      freeze.remove();
    }
  },

  // Copy of the WebGL canvas at backing-store size (2D, survives context loss).
  snapshotToCanvas(map) {
    const src = map.getCanvas();
    const c = document.createElement('canvas');
    c.width = src.width; c.height = src.height;
    c.getContext('2d').drawImage(src, 0, 0);
    return c;
  },

  destroy() { if (_map) { _map.remove(); _map = null; } },
};

window.MLB = MLB;
})();
