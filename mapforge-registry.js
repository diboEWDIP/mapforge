// STAMP_TYPES registry — the single source of per-type knowledge.
// Extracted 2026-08-13 (restructure Stage 3): every quirk that used to live
// twice (redraw + key) or in scattered helpers (movable/size-field/factor
// lists) is declared once here. Consumers: redraw(), the map key, select
// tool helpers, and — later — the layers panel (each type carries its
// annotation-layer `group` per the type-groups decision of 2026-08-05).
//
// Contract per entry:
//   kind      'point' | 'line' | 'arrow' | 'paint'
//   group     terrain | places | routes | trade | fills | shading
//   sizeField which stamp field holds its size ('size' | 'iconSize' | null)
//   factor    draw-size multiplier (the old STAMP_DRAW_FACTOR quirks)
//   defaultSize    slider default (document px)
//   keyFallback    median-size fallback when no stamps placed (legacy values)
//   movable   Select tool can move/resize it
//   draw(ctx, x, y, size, color)   point kinds — size already ×factor
//   drawStamp(ctx, s)              line/arrow kinds — full stamp object
// Classic script: loads after mapforge-icons.js (draw fns), before the core.

const STAMP_TYPES = {};

function registerStampType(type, def) { STAMP_TYPES[type] = def; }

// ---- Terrain ---------------------------------------------------------------
registerStampType('mountain', { kind: 'point', group: 'terrain', sizeField: 'size',
  factor: 1, defaultSize: 16, keyFallback: 16, movable: true,
  draw: (ctx, x, y, size, color) => drawMountainIcon(ctx, x, y, size, color || '#111') });
registerStampType('peak', { kind: 'point', group: 'terrain', sizeField: 'size',
  factor: 1.3, defaultSize: 16, keyFallback: 16, movable: true,
  draw: (ctx, x, y, size, color) => drawPeakIcon(ctx, x, y, size, color || '#111') });
registerStampType('desert', { kind: 'point', group: 'terrain', sizeField: null,
  factor: 1, defaultSize: null, keyFallback: null, movable: false,
  // Desert speckles take a SCALE (redraw passes 1; the key passes 1/dpr).
  draw: (ctx, x, y, scale, color) => drawDesertIcon(ctx, x, y, scale, color || '#111') });
registerStampType('oasis', { kind: 'point', group: 'terrain', sizeField: 'iconSize',
  factor: 1.2, defaultSize: 16, keyFallback: null, movable: true,
  draw: (ctx, x, y, size, color) => drawOasis(ctx, x, y, size, color) });

// ---- Places & events -------------------------------------------------------
registerStampType('city', { kind: 'point', group: 'places', sizeField: 'size',
  factor: 36 / 22, defaultSize: 16, keyFallback: 16, movable: true,
  draw: (ctx, x, y, size, color) => drawCityIcon(ctx, x, y, size, color || '#111') });
registerStampType('danger', { kind: 'point', group: 'places', sizeField: 'iconSize',
  factor: 1.2, defaultSize: 16, keyFallback: null, movable: true,
  draw: (ctx, x, y, size, color) => drawDanger(ctx, x, y, size, color) });
registerStampType('battle', { kind: 'point', group: 'places', sizeField: 'iconSize',
  factor: 1.2, defaultSize: 16, keyFallback: null, movable: true,
  draw: (ctx, x, y, size, color) => drawBattle(ctx, x, y, size, color) });

// ---- Trade & culture (from the existing per-family registries) -------------
for (const id of Object.keys(TRADE_GOODS))
  registerStampType(id, { kind: 'point', group: 'trade', sizeField: 'iconSize',
    factor: 1, defaultSize: 16, keyFallback: null, movable: true,
    draw: (ctx, x, y, size, color) => TRADE_GOODS[id].draw(ctx, x, y, size, color) });
for (const id of Object.keys(RELIGIONS))
  registerStampType(id, { kind: 'point', group: 'trade', sizeField: 'iconSize',
    factor: 1, defaultSize: 16, keyFallback: null, movable: true,
    draw: (ctx, x, y, size, color) => RELIGIONS[id].draw(ctx, x, y, size, color) });

// ---- Routes & structures ---------------------------------------------------
for (const id of Object.keys(LINE_DASH))
  registerStampType(id, { kind: 'line', group: 'routes', sizeField: null,
    factor: 1, defaultSize: null, keyFallback: null, movable: false,
    drawStamp: (ctx, s) => drawStroke(ctx, s.points, s.type, s.color, s.width) });
for (const id of FEATURE_TYPES)
  registerStampType(id, { kind: 'line', group: 'routes', sizeField: null,
    factor: 1, defaultSize: null, keyFallback: null, movable: false,
    drawStamp: (ctx, s) => drawFeatureLine(ctx, s.points, s.type, s.color, s.width) });
registerStampType('arrow-black', { kind: 'arrow', group: 'routes', sizeField: null,
  factor: 1, defaultSize: null, keyFallback: null, movable: false,
  drawStamp: (ctx, s) => drawArrow(ctx, s.x1, s.y1, s.x2, s.y2, s.cx, s.cy, s.color || '#111', s.width) });

// ---- Paint systems (drawn by dedicated renderers, registered for grouping) --
registerStampType('fill',  { kind: 'paint', group: 'fills',   sizeField: null, factor: 1,
  defaultSize: null, keyFallback: null, movable: false });
registerStampType('shade', { kind: 'paint', group: 'shading', sizeField: null, factor: 1,
  defaultSize: null, keyFallback: null, movable: false });

// The canonical draw size for a placed point stamp — the ONE copy of the
// old redraw()/key formulas. iconSize falls back to the live tool default
// (iconStampSize), exactly as redraw always did.
function stampDrawSize(s) {
  const def = STAMP_TYPES[s.type];
  if (!def || def.sizeField === null) return 1;
  const base = def.sizeField === 'size' ? (s.size || 22)
                                        : (s.iconSize || iconStampSize);
  return base * def.factor;
}
