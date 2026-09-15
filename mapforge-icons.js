// Extracted from index.html in the 2026-08 restructure (Stage 0.5).
// Classic script — shares the app's global lexical scope; load order matters.
// ── Drawing functions ────────────────────────────────────────────────────────

// Cache-bust icon fetches each page load so swapped PNG files always show the
// latest art (cp can preserve old mtimes, which otherwise serves a stale cache).
// Pinned version tag, NOT Date.now() (Eric, 2026-07-21): the old value
// re-fetched all 41 icon PNGs on every load — invisible locally, slow on a
// hosted site. Bump the tag when swapping icon art.
const ICON_BUST = '?v=2026-09-15a';   // bumped: City.svg + Major Peak.svg added

const drawMountainIcon = _makeSvgStamp('icons/Mountain.svg', 'icon-mountain');

// Tint a black-alpha master to an arbitrary colour at draw time (cached per
// colour on the master canvas object — cheap after first use).
function _tintedMaster(cv, color) {
  if (!color || color === '#111' || color === '#111111') return cv;
  cv._tints = cv._tints || {};
  if (cv._tints[color]) return cv._tints[color];
  const t = document.createElement('canvas');
  t.width = cv.width; t.height = cv.height;
  const tc = t.getContext('2d');
  tc.drawImage(cv, 0, 0);
  tc.globalCompositeOperation = 'source-in';
  tc.fillStyle = color;
  tc.fillRect(0, 0, t.width, t.height);
  cv._tints[color] = t;
  return t;
}

// Major Peak + City joined the standard SVG pipeline 2026-09-15 (built by
// design/icon-sizing/build_icon_svgs.py): clipped, true aspect, no multiplier.
// 1.2 optical scale: the peak art is flatter (ink aspect 1.70 vs Mountain's
// 1.42), so at an equal longest side it read ~17% shorter. 1.2 matches its
// HEIGHT to Mountain's at the same slider value (Maddy 2026-09-15).
const drawPeakIcon = _makeSvgStamp('icons/Major Peak.svg', 'icon-peak', 1.2);

const drawOasis = _makeSvgStamp('icons/Oasis.svg', 'icon-oasis');

// Danger & Battle now render from crisp SVG (their toolbar buttons are drawn
// by _makeSvgStamp on load — the old _dangerStamp/_battleStamp.toolbar() init
// lines were removed to match).
const drawDanger = _makeSvgStamp('icons/Danger.svg', 'icon-danger');
const drawBattle = _makeSvgStamp('icons/Battle.svg', 'icon-battle');




// ── Vector (SVG) stamp factory — crisp at ANY zoom/export ────────────────────
// The ONE icon loader (every map stamp is an SVG since 2026-09-15). Each draw
// rasterizes the vector fresh at the exact device-pixel size, then tints it to
// the annotation colour via source-in — so edges stay sharp at any zoom or
// export size. Icons are solid black paths on transparent backgrounds.
// ICON SIZING (Maddy 2026-09-15): every SVG is CLIPPED to its own ink extent
// at load (the 1200×1200 canvases carry 0–55% empty margin) and drawn at TRUE
// proportions with the longest side = size × ICON_LONG. One size setting now
// means one size for every icon — no per-type multipliers, no 1.6×1.25 stretch.
// ICON_LONG = 1.44 keeps today's MEDIAN icon (90% fill of the old 1.6·size
// width) the same size, so existing saves change only where art was off.
const ICON_LONG = 1.44;

// opticalScale: per-ICON visual weight correction, applied inside the loader
// so map, key AND sidebar button all agree (a solid disc reads far heavier than
// line art at the same longest side). 1 for every icon except City (0.65 —
// Maddy 2026-09-15: 35% smaller at the default slider value of 16).
function _makeSvgStamp(svgSrc, toolbarId, opticalScale = 1) {
  const img = new Image();
  let ready = false;
  let ink = { x: 0, y: 0, w: 1, h: 1 };   // ink bbox as fractions of the canvas
  const cache = new Map();          // key `pw x ph | color` → tinted canvas
  const CACHE_CAP = 24;

  // Measure the drawing's extent once (alpha scan of a 512px raster).
  function measureInk() {
    const N = 512;
    const c = document.createElement('canvas');
    c.width = c.height = N;
    const cx = c.getContext('2d');
    cx.drawImage(img, 0, 0, N, N);
    const a = cx.getImageData(0, 0, N, N).data;
    let x0 = N, y0 = N, x1 = -1, y1 = -1;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      if (a[(y * N + x) * 4 + 3] > 20) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
    if (x1 < 0) return;                     // empty art: keep the full canvas
    ink = { x: x0 / N, y: y0 / N, w: (x1 - x0 + 1) / N, h: (y1 - y0 + 1) / N };
  }

  // Drawn footprint for a size setting: longest side ICON_LONG·size, true aspect.
  function footprint(size) {
    const L = size * ICON_LONG * opticalScale, m = Math.max(ink.w, ink.h);
    return { w: L * ink.w / m, h: L * ink.h / m };
  }

  function rasterize(pw, ph, color) {
    const tint = (!color || color === '#111' || color === '#111111') ? '#111' : color;
    const key = pw + 'x' + ph + '|' + tint;
    const hit = cache.get(key);
    if (hit) return hit;
    const c = document.createElement('canvas');
    c.width = pw; c.height = ph;
    const cx = c.getContext('2d');
    cx.imageSmoothingEnabled = true; cx.imageSmoothingQuality = 'high';
    // Rasterize the VECTOR at output size, offset so only the ink bbox lands
    // on this canvas (the canvas bounds do the clipping; stays crisp at any size).
    const fw = pw / ink.w, fh = ph / ink.h;
    cx.drawImage(img, -ink.x * fw, -ink.y * fh, fw, fh);
    cx.globalCompositeOperation = 'source-in';  // tint the silhouette, keep its alpha
    cx.fillStyle = tint;
    cx.fillRect(0, 0, pw, ph);
    if (cache.size >= CACHE_CAP) cache.delete(cache.keys().next().value);
    cache.set(key, c);
    return c;
  }

  function draw(ctx, x, y, size, color) {
    if (!ready) return;
    const { w, h } = footprint(size);
    // Device-pixel size from the ctx transform, so HiDPI + supersampled exports
    // rasterize the SVG at their true resolution (this is what keeps it crisp).
    const t = ctx.getTransform ? ctx.getTransform() : null;
    const sx = t ? Math.hypot(t.a, t.b) || 1 : 1;
    const sy = t ? Math.hypot(t.c, t.d) || 1 : 1;
    const pw = Math.max(1, Math.round(w * sx));
    const ph = Math.max(1, Math.round(h * sy));
    ctx.save();
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(rasterize(pw, ph, color), x - w / 2, y - h / 2, w, h);
    ctx.restore();
  }

  img.onload = () => {
    measureInk();
    ready = true;
    if (toolbarId) {
      const c = document.getElementById(toolbarId);
      if (c) {
        const dpr = Math.max(1, window.devicePixelRatio || 1);
        const cssW = c.width, cssH = c.height;
        c.style.width = cssW + 'px';
        c.style.height = cssH + 'px';
        c.width = Math.round(cssW * dpr);
        c.height = Math.round(cssH * dpr);
        const cx = c.getContext('2d');
        cx.scale(dpr, dpr);
        // 0.49 → longest side ≈ 0.70 of the button, as the old stretched 0.44·1.6 did.
        draw(cx, cssW / 2, cssH / 2, cssW * 0.49);
      }
    }
  };
  img.src = svgSrc + ICON_BUST;
  draw.footprint = footprint;
  return draw;
}

const drawHorse        = _makeSvgStamp('icons/Horse.svg',          'icon-trade-horses');
const drawAmphora      = _makeSvgStamp('icons/Olives.svg',          'icon-trade-oliveoil');
const drawSilk         = _makeSvgStamp('icons/Silk.svg',            'icon-trade-silk');
const drawWheat        = _makeSvgStamp('icons/Wheat.svg',           'icon-trade-wheat');
const drawCamel        = _makeSvgStamp('icons/Camel.svg',           'icon-trade-camel');
const drawMolasses     = _makeSvgStamp('icons/Molasses.svg',        'icon-trade-molasses');
const drawRum          = _makeSvgStamp('icons/Rum.svg',             'icon-trade-rum');
const drawTea          = _makeSvgStamp('icons/Tea.svg',             'icon-trade-tea');
const drawCoal         = _makeSvgStamp('icons/Coal.svg',            'icon-trade-coal');
const drawCopper       = _makeSvgStamp('icons/Copper.svg',          'icon-trade-copper');
const drawCotton       = _makeSvgStamp('icons/Cotton.svg',          'icon-trade-cotton');
const drawDyes         = _makeSvgStamp('icons/Dyes.svg',            'icon-trade-dyes');
const drawFish         = _makeSvgStamp('icons/Fishing.svg',         'icon-trade-fish');
const drawFurs         = _makeSvgStamp('icons/Furs.svg',            'icon-trade-furs');
const drawGold         = _makeSvgStamp('icons/Gold.svg',            'icon-trade-gold');
const drawIncense      = _makeSvgStamp('icons/Incense.svg',         'icon-trade-incense');
const drawIndigo       = _makeSvgStamp('icons/Indigo.svg',          'icon-trade-indigo');
const drawIron         = _makeSvgStamp('icons/Iron.svg',            'icon-trade-iron');
const drawLumber       = _makeSvgStamp('icons/Lumber.svg',          'icon-trade-lumber');
const drawMillet       = _makeSvgStamp('icons/Millet.svg',          'icon-trade-millet');
const drawNavalStores  = _makeSvgStamp('icons/Naval Stores.svg',    'icon-trade-navalstores');
const drawPaper        = _makeSvgStamp('icons/Paper.svg',           'icon-trade-paper');
const drawPerfume      = _makeSvgStamp('icons/Perfume.svg',      'icon-trade-perfume');
const drawPorcelain    = _makeSvgStamp('icons/Porcelain.svg',     'icon-trade-porcelain');
const drawRice         = _makeSvgStamp('icons/Rice.svg',            'icon-trade-rice');
const drawSalt         = _makeSvgStamp('icons/Salt.svg',            'icon-trade-salt');
const drawShipbuilding = _makeSvgStamp('icons/Shipbuilding.svg',    'icon-trade-shipbuilding');
const drawSpices       = _makeSvgStamp('icons/Spices.svg',          'icon-trade-spices');
const drawStone        = _makeSvgStamp('icons/Stone.svg',           'icon-trade-stone');
const drawSugar        = _makeSvgStamp('icons/Sugar.svg',           'icon-trade-sugar');
const drawTextiles     = _makeSvgStamp('icons/Textiles.svg',        'icon-trade-textiles');
const drawTin          = _makeSvgStamp('icons/Tin.svg',             'icon-trade-tin');
const drawTobacco      = _makeSvgStamp('icons/Tobacco.svg',         'icon-trade-tobacco');
const drawWhaling      = _makeSvgStamp('icons/Whaling.svg',         'icon-trade-whaling');
const drawGrapes       = _makeSvgStamp('icons/Wine.svg',            'icon-trade-wine');
const drawWool         = _makeSvgStamp('icons/Wool.svg',            'icon-trade-wool');
const drawGem          = _makeSvgStamp('icons/Gems.svg',            'icon-trade-gem');
const drawOil          = _makeSvgStamp('icons/Oil.svg',             'icon-trade-oil');
const drawCorn         = _makeSvgStamp('icons/Corn.svg',            'icon-trade-corn');
const drawPotato       = _makeSvgStamp('icons/Potato.svg',          'icon-trade-potato');
const drawLead         = _makeSvgStamp('icons/Lead.svg',            'icon-trade-lead');
const drawMarble       = _makeSvgStamp('icons/Marble.svg',          'icon-trade-marble');
const drawWildAnimals  = _makeSvgStamp('icons/Wild Animals.svg',    'icon-trade-wildanimals');
const drawIvory        = _makeSvgStamp('icons/Ivory.svg',           'icon-trade-ivory');
const drawObsidian     = _makeSvgStamp('icons/Obsidian.svg',        'icon-trade-obsidian');
const drawCattle       = _makeSvgStamp('icons/Cattle.svg',          'icon-trade-cattle');
const drawGoats        = _makeSvgStamp('icons/Goats.svg',           'icon-trade-goats');
const drawPigs         = _makeSvgStamp('icons/Pigs.svg',            'icon-trade-pigs');
// Landmark icons — shown in the Features panel, behave as icon stamps
const drawTemple       = _makeSvgStamp('icons/Temple.svg',                'icon-feat-temple');
const drawMesoPyramid  = _makeSvgStamp('icons/Mesoamerican Pyramid.svg',  'icon-feat-mesopyramid');
const drawPyramid      = _makeSvgStamp('icons/Pyramid.svg',               'icon-feat-pyramid');
const drawFactory      = _makeSvgStamp('icons/Factory.svg',               'icon-feat-factory');
const drawCataract     = _makeSvgStamp('icons/Cataract.svg',              'icon-feat-cataract');
const drawFortress     = _makeSvgStamp('icons/Fortress.svg',              'icon-feat-fortress');
const drawZiggurat     = _makeSvgStamp('icons/Ziggurat.svg',              'icon-feat-ziggurat');
// New landmarks (Noun Project flat set, 2026-08-16)
const drawCapitol      = _makeSvgStamp('icons/Capitol.svg',               'icon-feat-capitol');
const drawCastle       = _makeSvgStamp('icons/Castle.svg',                'icon-feat-castle');
const drawCathedral    = _makeSvgStamp('icons/Cathedral.svg',             'icon-feat-cathedral');
const drawEgyptTemple  = _makeSvgStamp('icons/Egyptian Temple.svg',       'icon-feat-egyptiantemple');
const drawLighthouse   = _makeSvgStamp('icons/Lighthouse.svg',            'icon-feat-lighthouse');
// New trade goods (Noun Project flat set, 2026-08-16)
const drawBarley       = _makeSvgStamp('icons/Barley.svg',                'icon-trade-barley');
const drawCarpet       = _makeSvgStamp('icons/Carpet.svg',                'icon-trade-carpet');
const drawPottery      = _makeSvgStamp('icons/Pottery.svg',               'icon-trade-pottery');
const drawSilver       = _makeSvgStamp('icons/Silver.svg',                'icon-trade-silver');
const drawSorghum      = _makeSvgStamp('icons/Sorghum.svg',               'icon-trade-sorghum');

// Foods & crops (Noun Project set, 2026-08-23)
const drawApples      = _makeSvgStamp('icons/Apples.svg',                 'icon-trade-apples');
const drawBeans       = _makeSvgStamp('icons/Beans.svg',                  'icon-trade-beans');
const drawCitrus      = _makeSvgStamp('icons/Citrus Fruit.svg',           'icon-trade-citrus');
const drawCoffee      = _makeSvgStamp('icons/Coffee.svg',                 'icon-trade-coffee');
const drawHoneybees   = _makeSvgStamp('icons/Honeybees.svg',              'icon-trade-honeybees');
const drawPears       = _makeSvgStamp('icons/Pears.svg',                  'icon-trade-pears');
const drawSquash      = _makeSvgStamp('icons/Squash.svg',                 'icon-trade-squash');
const drawSweetPotato = _makeSvgStamp('icons/Sweet Potato.svg',           'icon-trade-sweetpotato');
const drawTomato      = _makeSvgStamp('icons/Tomato.svg',                 'icon-trade-tomato');
const drawPalmOil     = _makeSvgStamp('icons/Palm Oil.svg',               'icon-trade-palmoil');
const drawPeanuts     = _makeSvgStamp('icons/Peanuts.svg',                'icon-trade-peanuts');
const drawPeppers     = _makeSvgStamp('icons/Peppers.svg',                'icon-trade-peppers');
const drawRubber      = _makeSvgStamp('icons/Rubber.svg',                 'icon-trade-rubber');
// New transport icons (Noun Project flat set, 2026-08-16)
const drawShip         = _makeSvgStamp('icons/Ship.svg',                  'icon-trans-ship');
const drawTrireme      = _makeSvgStamp('icons/Trireme.svg',               'icon-trans-trireme');
const drawConestoga    = _makeSvgStamp('icons/Conestoga Wagon.svg',       'icon-trans-conestoga');
// New event/figure markers (Noun Project flat set, 2026-08-16)
const drawPerson       = _makeSvgStamp('icons/Person.svg',                'icon-mark-person');
const drawFire         = _makeSvgStamp('icons/Fire.svg',                  'icon-mark-fire');
const drawVikings      = _makeSvgStamp('icons/Vikings.svg',               'icon-mark-vikings');
const drawChristianity = _makeSvgStamp('icons/Christianity.svg',    'icon-religion-christianity');
const drawIslam        = _makeSvgStamp('icons/Islam.svg',           'icon-religion-islam');
const drawBuddhism     = _makeSvgStamp('icons/Buddhism.svg',        'icon-religion-buddhism');
const drawHinduism     = _makeSvgStamp('icons/Hinduism.svg',        'icon-religion-hinduism');
const drawJudaism      = _makeSvgStamp('icons/Judaism.svg',         'icon-religion-judaism');



// City: 35% smaller than the standard icon at the same slider value (0.65 optical
// scale) — a solid disc outweighs line art. Was a code-drawn arc before 2026-09-15.
const drawCityIcon = _makeSvgStamp('icons/City.svg', 'icon-city', 0.65);

const DESERT_SPECKS = [
  [-18,-12],[-10,-18],[0,-20],[11,-17],[19,-11],[22,0],[18,11],[10,18],
  [0,20],[-11,17],[-20,10],[-22,0],[-14,-6],[-6,-14],[6,-13],[14,-6],
  [15,6],[6,14],[-6,13],[-14,6],[0,-8],[8,0],[0,8],[-8,0],[4,-4],[-4,4],
  [-16,-16],[16,16],[16,-16],[-16,16],[0,0],[9,-9],[-9,9]
];

function drawDesertIcon(ctx, x, y, scale, color) {
  ctx.save();
  ctx.fillStyle = color || '#111';
  DESERT_SPECKS.forEach(([dx,dy]) => {
    ctx.beginPath();
    // min radius keeps the tiny toolbar icon legible (sub-pixel dots vanish);
    // at map scale (1) the clamp is inert
    ctx.arc(x+dx*scale, y+dy*scale, Math.max(1.4*scale, 1.1), 0, Math.PI*2);
    ctx.fill();
  });
  ctx.restore();
}

function drawArrow(ctx, x1, y1, x2, y2, cx, cy, color, width) {
  const col = color || '#111111';
  const angle = Math.atan2(y2-cy, x2-cx);
  const k = (width || 9) / 9;
  const hs = 28 * k;                       // head scales with the shaft
  ctx.save();
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.strokeStyle = col; ctx.lineWidth = 9 * k;
  // End the shaft at the arrowhead base by splitting the quadratic curve, so the
  // round line-cap is hidden under the triangle instead of bulging past the tip.
  const back = hs * 0.9;
  const endTangent = 2 * Math.hypot(x2 - cx, y2 - cy) || 1;   // |Q'(1)|
  const t = Math.max(0, Math.min(1, 1 - back / endTangent));
  const bx = (1-t)*x1 + t*cx,  by = (1-t)*y1 + t*cy;          // split control point
  const ex = (1-t)*(1-t)*x1 + 2*(1-t)*t*cx + t*t*x2;          // split end point Q(t)
  const ey = (1-t)*(1-t)*y1 + 2*(1-t)*t*cy + t*t*y2;
  ctx.beginPath(); ctx.moveTo(x1,y1);
  ctx.quadraticCurveTo(bx,by,ex,ey); ctx.stroke();
  ctx.fillStyle = col;
  ctx.beginPath(); ctx.moveTo(x2,y2);
  ctx.lineTo(x2-hs*Math.cos(angle-Math.PI/6), y2-hs*Math.sin(angle-Math.PI/6));
  ctx.lineTo(x2-hs*Math.cos(angle+Math.PI/6), y2-hs*Math.sin(angle+Math.PI/6));
  ctx.closePath(); ctx.fill(); ctx.restore();
}

const LINE_DASH = {
  'line-solid':   [],
  'line-dotted':  [3, 18],
  'line-dashed':  [30, 20],
  'line-dashdot': [30, 14, 3, 14],
  'line-arrow':   [],   // solid stroke; arrowhead added at the end in drawStroke
};
function isLineStamp(t) { return t in LINE_DASH; }
function isArrowStamp(t) { return t === 'arrow-black'; }

// Return a copy of the polyline truncated by `back` units of arc length from
// the end (walking back along the path, dropping/interpolating as needed).
function _truncateEnd(points, back) {
  const pts = points.slice();
  let remaining = back;
  while (pts.length >= 2) {
    const a = pts[pts.length - 2], b = pts[pts.length - 1];
    const segLen = Math.hypot(b.x - a.x, b.y - a.y);
    if (segLen >= remaining) {
      const t = (segLen - remaining) / segLen;
      pts[pts.length - 1] = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      return pts;
    }
    remaining -= segLen;
    pts.pop();
  }
  return pts;
}

function drawStroke(ctx, points, type, color, width) {
  if (points.length < 2) return;
  ctx.save();
  ctx.strokeStyle = color || '#111111';
  // Optional per-stroke width for the plain line-* styles; line-arrow keeps
  // its fixed rendering (callers don't pass width for it).
  ctx.lineWidth = (type !== 'line-arrow' && width) ? width : 9;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  // LINE_DASH is authored at the default width 9. Scale it with the stroke so
  // a dotted/dashed/dash-dot line looks IDENTICAL at 1 wide and 20 wide
  // (Maddy 2026-09-15 — wall/railroad already scale their patterns).
  const dashK = ctx.lineWidth / 9;
  ctx.setLineDash((LINE_DASH[type] || []).map(v => v * dashK));

  if (type === 'line-arrow') {
    const tip = points[points.length - 1];
    let ref = points[0];
    for (let i = points.length - 2; i >= 0; i--) {
      if (dist(points[i].x, points[i].y, tip.x, tip.y) > 1) { ref = points[i]; break; }
    }
    const angle = Math.atan2(tip.y - ref.y, tip.x - ref.x);
    // Arrowhead scales with stroke length (capped at 28 = the stamp-arrow size),
    // so long map arrows look the same while short strokes & the small key icon
    // get a proportional head.
    let strokeLen = 0;
    for (let i = 1; i < points.length; i++) strokeLen += dist(points[i-1].x, points[i-1].y, points[i].x, points[i].y);
    const hs = Math.min(28, strokeLen * 0.4);
    // End the shaft at the arrowhead's base so the round line-cap is hidden
    // under the triangle (otherwise it bulges past the tip as a "ball").
    const shaft = _truncateEnd(points, hs * 0.9);
    if (shaft.length >= 2) {
      ctx.beginPath(); ctx.moveTo(shaft[0].x, shaft[0].y);
      for (let i = 1; i < shaft.length; i++) ctx.lineTo(shaft[i].x, shaft[i].y);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.fillStyle = color || '#111111';
    ctx.beginPath();
    ctx.moveTo(tip.x, tip.y);
    ctx.lineTo(tip.x - hs * Math.cos(angle - Math.PI/6), tip.y - hs * Math.sin(angle - Math.PI/6));
    ctx.lineTo(tip.x - hs * Math.cos(angle + Math.PI/6), tip.y - hs * Math.sin(angle + Math.PI/6));
    ctx.closePath(); ctx.fill();
  } else {
    ctx.beginPath(); ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
    ctx.stroke(); ctx.setLineDash([]);
  }
  ctx.restore();
}

// ── Trade good drawing functions ─────────────────────────────────────────────













// ── Feature line drawing ─────────────────────────────────────────────────────

function pathPerps(points) {
  return points.map((p, i) => {
    let dx, dy;
    if (i === 0)                    { dx = points[1].x - p.x;             dy = points[1].y - p.y; }
    else if (i === points.length-1) { dx = p.x - points[i-1].x;           dy = p.y - points[i-1].y; }
    else                            { dx = points[i+1].x - points[i-1].x; dy = points[i+1].y - points[i-1].y; }
    const len = Math.sqrt(dx*dx + dy*dy) || 1;
    return { nx: -dy/len, ny: dx/len };
  });
}

function parallelPaths(points, offset) {
  const perps = pathPerps(points);
  const left  = points.map((p,i) => ({ x: p.x + perps[i].nx*offset, y: p.y + perps[i].ny*offset }));
  const right = points.map((p,i) => ({ x: p.x - perps[i].nx*offset, y: p.y - perps[i].ny*offset }));
  return { left, right };
}

function strokePath(ctx, pts) {
  ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.stroke();
}

function walkPath(points, startOffset, spacing, fn) {
  let distAcc = 0, next = startOffset;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i-1].x, dy = points[i].y - points[i-1].y;
    const segLen = Math.sqrt(dx*dx + dy*dy);
    if (segLen < 0.01) { distAcc += segLen; continue; }
    const angle = Math.atan2(dy, dx);
    while (distAcc + segLen >= next) {
      const t = (next - distAcc) / segLen;
      fn(points[i-1].x + dx*t, points[i-1].y + dy*t, angle);
      next += spacing;
    }
    distAcc += segLen;
  }
}

// ── Wall (in-line): a solid wall body with battlements on ONE side ──
// Crenellations sit on a single edge (like a castle parapet) rather than both
// sides — the both-sides version read as a "zipper".
function drawWall(ctx, points, color, width) {
  if (points.length < 2) return;
  // Whole design scales with the width slider (k=1 at the default 9 doc px):
  // body, merlons and their spacing keep their proportions.
  const k = (width || 9) / 9;
  ctx.save();
  ctx.fillStyle = ctx.strokeStyle = color || '#111';
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  const bodyW = 4.5 * k;
  ctx.lineWidth = bodyW;
  strokePath(ctx, points);
  const mW = 5.5 * k, mH = 4 * k, spacing = 9 * k, edge = bodyW / 2;
  walkPath(points, spacing * 0.5, spacing, (x, y, angle) => {
    ctx.save(); ctx.translate(x, y); ctx.rotate(angle);
    ctx.fillRect(-mW / 2, -edge - mH + 0.5, mW, mH);   // +0.5 overlaps the body so no seam
    ctx.restore();
  });
  ctx.restore();
}

// Feature tool-button previews: render with the REAL map drawing functions on
// a straight path, so the button always shows exactly what the tool draws.
function renderFeaturePreview(id, type) {
  const c = document.getElementById(id);
  if (!c) return;
  const cx = c.getContext('2d');
  const lw = +c.dataset.lw || c.width, lh = +c.dataset.lh || c.height;
  cx.clearRect(0, 0, lw, lh);
  const pts = [];
  for (let x = 4; x <= lw - 4; x += 3) pts.push({ x, y: lh / 2 });
  // narrow width so the swatch matches the plain-line row scale
  drawFeatureLine(cx, pts, type, '#111', 4.5);
}
function renderWallButton() { renderFeaturePreview('icon-feature-wall', 'feature-wall'); }

function drawRailroad(ctx, points, color, width) {
  if (points.length < 2) return;
  const k = (width || 9) / 9;
  const railOff = 4 * k, railW = 1.5 * k, tieW = 2.5 * k, tieExt = 2 * k, spacing = 12 * k;
  ctx.save();
  ctx.strokeStyle = color || '#111'; ctx.lineJoin = 'round';
  const { left, right } = parallelPaths(points, railOff);
  ctx.lineWidth = railW; ctx.lineCap = 'round';
  strokePath(ctx, left); strokePath(ctx, right);
  ctx.lineWidth = tieW; ctx.lineCap = 'butt';
  walkPath(points, spacing * 0.5, spacing, (x, y, angle) => {
    const ext = railOff + tieExt;
    const nx = -Math.sin(angle), ny = Math.cos(angle);
    ctx.beginPath(); ctx.moveTo(x+nx*ext, y+ny*ext); ctx.lineTo(x-nx*ext, y-ny*ext); ctx.stroke();
  });
  ctx.restore();
}

function drawCanal(ctx, points, width, color) {
  if (points.length < 2) return;
  // Two parallel bank lines with white fill between — banks take the stroke colour
  const k = (width || 9) / 9;
  const canalOff = 6 * k, bankW = 2.5 * k;
  ctx.save();
  const { left, right } = parallelPaths(points, canalOff);

  // White fill between the two lines
  ctx.beginPath();
  ctx.moveTo(left[0].x, left[0].y);
  for (let i = 1; i < left.length; i++) ctx.lineTo(left[i].x, left[i].y);
  for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i].x, right[i].y);
  ctx.closePath(); ctx.fillStyle = '#fff'; ctx.fill();

  // Two solid black lines
  ctx.strokeStyle = color || '#111'; ctx.lineWidth = bankW;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  strokePath(ctx, left); strokePath(ctx, right);
  ctx.restore();
}

function drawFeatureLine(ctx, points, type, color, width) {
  if      (type === 'feature-wall')     drawWall(ctx, points, color, width);
  else if (type === 'feature-railroad') drawRailroad(ctx, points, color, width);
  else if (type === 'feature-canal')    drawCanal(ctx, points, width, color);
}

const FEATURE_TYPES = new Set(['feature-wall', 'feature-railroad', 'feature-canal']);
function isFeatureStamp(t) { return FEATURE_TYPES.has(t); }
















function drawMountainPass(ctx, x, y, size) {
  // Mountain range silhouette with saddle/pass in the center
  ctx.save();
  ctx.fillStyle = '#111';
  ctx.beginPath();
  ctx.moveTo(x - size*0.68, y + size*0.42);
  ctx.lineTo(x - size*0.28, y - size*0.52);
  ctx.lineTo(x,              y - size*0.1);
  ctx.lineTo(x + size*0.28,  y - size*0.52);
  ctx.lineTo(x + size*0.68,  y + size*0.42);
  ctx.closePath();
  ctx.fill();
  // White dot at saddle marking the pass
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.arc(x, y - size*0.1, size*0.08, 0, Math.PI*2); ctx.fill();
  ctx.restore();
}





// Registry
const TRADE_GOODS = {
  'trade-camel':       { label: 'Camel',         draw: drawCamel       },
  'trade-cattle':      { label: 'Cattle',        draw: drawCattle      },
  'trade-coal':        { label: 'Coal',          draw: drawCoal        },
  'trade-copper':      { label: 'Copper',        draw: drawCopper      },
  'trade-corn':        { label: 'Corn',          draw: drawCorn        },
  'trade-cotton':      { label: 'Cotton',        draw: drawCotton      },
  'trade-dyes':        { label: 'Dyes',          draw: drawDyes        },
  'trade-fish':        { label: 'Fish',          draw: drawFish        },
  'trade-furs':        { label: 'Furs',          draw: drawFurs        },
  'trade-gem':         { label: 'Gems',          draw: drawGem         },
  'trade-goats':       { label: 'Goats',         draw: drawGoats       },
  'trade-gold':        { label: 'Gold',          draw: drawGold        },
  'trade-horses':      { label: 'Horses',        draw: drawHorse       },
  'trade-incense':     { label: 'Incense',       draw: drawIncense     },
  'trade-indigo':      { label: 'Indigo',        draw: drawIndigo      },
  'trade-iron':        { label: 'Iron',          draw: drawIron        },
  'trade-ivory':       { label: 'Ivory',         draw: drawIvory       },
  'trade-lead':        { label: 'Lead',          draw: drawLead        },
  'trade-lumber':      { label: 'Lumber',        draw: drawLumber      },
  'trade-marble':      { label: 'Marble',        draw: drawMarble      },
  'trade-millet':      { label: 'Millet',        draw: drawMillet      },
  'trade-molasses':    { label: 'Molasses',      draw: drawMolasses    },
  'trade-navalstores': { label: 'Naval Stores',  draw: drawNavalStores },
  'trade-obsidian':    { label: 'Obsidian',      draw: drawObsidian    },
  'trade-oil':         { label: 'Oil',           draw: drawOil         },
  'trade-oliveoil':    { label: 'Olive Oil',     draw: drawAmphora     },
  'trade-paper':       { label: 'Paper',         draw: drawPaper       },
  'trade-perfume':     { label: 'Perfume',       draw: drawPerfume     },
  'trade-pigs':        { label: 'Pigs',          draw: drawPigs        },
  'trade-porcelain':   { label: 'Porcelain',     draw: drawPorcelain   },
  'trade-potato':      { label: 'Potato',        draw: drawPotato      },
  'trade-rice':        { label: 'Rice',          draw: drawRice        },
  'trade-rum':         { label: 'Rum',           draw: drawRum         },
  'trade-salt':        { label: 'Salt',          draw: drawSalt        },
  'trade-shipbuilding':{ label: 'Shipbuilding',  draw: drawShipbuilding},
  'trade-silk':        { label: 'Silk',          draw: drawSilk        },
  'trade-spices':      { label: 'Spices',        draw: drawSpices      },
  'trade-stone':       { label: 'Stone',         draw: drawStone       },
  'trade-sugar':       { label: 'Sugar',         draw: drawSugar       },
  'trade-tea':         { label: 'Tea',           draw: drawTea         },
  'trade-textiles':    { label: 'Textiles',      draw: drawTextiles    },
  'trade-tin':         { label: 'Tin',           draw: drawTin         },
  'trade-tobacco':     { label: 'Tobacco',       draw: drawTobacco     },
  'trade-whaling':     { label: 'Whaling',       draw: drawWhaling     },
  'trade-wheat':       { label: 'Wheat',         draw: drawWheat       },
  'trade-wildanimals': { label: 'Wild Animals',  draw: drawWildAnimals },
  'trade-wine':        { label: 'Wine',          draw: drawGrapes      },
  'trade-wool':        { label: 'Wool',          draw: drawWool        },
  // ── New trade goods (Noun Project set, 2026-08-16) ──
  'trade-barley':      { label: 'Barley',        draw: drawBarley      },
  'trade-carpet':      { label: 'Carpet',        draw: drawCarpet      },
  'trade-pottery':     { label: 'Pottery',       draw: drawPottery     },
  'trade-silver':      { label: 'Silver',        draw: drawSilver      },
  'trade-sorghum':     { label: 'Sorghum',       draw: drawSorghum     },
  // ── Landmark icons (shown in the Features panel; behave as icon stamps) ──
  'feat-temple':       { label: 'Temple',               draw: drawTemple      },
  'feat-mesopyramid':  { label: 'Mesoamerican Pyramid',  draw: drawMesoPyramid },
  'feat-pyramid':      { label: 'Pyramid',              draw: drawPyramid     },
  'feat-factory':      { label: 'Factory',              draw: drawFactory     },
  'feat-cataract':     { label: 'Cataract',             draw: drawCataract    },
  'feat-fortress':     { label: 'Fortress',             draw: drawFortress    },
  'feat-ziggurat':     { label: 'Ziggurat',             draw: drawZiggurat    },
  // ── New landmarks (Noun Project set, 2026-08-16) ──
  'feat-capitol':        { label: 'Capitol',         draw: drawCapitol     },
  'feat-castle':         { label: 'Castle',          draw: drawCastle      },
  'feat-cathedral':      { label: 'Cathedral',       draw: drawCathedral   },
  'feat-egyptiantemple': { label: 'Egyptian Temple', draw: drawEgyptTemple },
  'feat-lighthouse':     { label: 'Lighthouse',      draw: drawLighthouse  },
  // ── Transport (Noun Project set, 2026-08-16) ──
  'trans-ship':        { label: 'Ship',            draw: drawShip        },
  'trans-trireme':     { label: 'Trireme',         draw: drawTrireme     },
  'trans-conestoga':   { label: 'Conestoga Wagon', draw: drawConestoga   },
  // ── Event / figure markers (shown in the War panel, 2026-08-16) ──
  'mark-person':       { label: 'Person',          draw: drawPerson      },
  'mark-fire':         { label: 'Fire',            draw: drawFire        },
  'mark-vikings':      { label: 'Vikings',         draw: drawVikings     },
  // ── Foods & crops (2026-08-23) ──
  'trade-apples':        { label: 'Apples',         draw: drawApples      },
  'trade-beans':         { label: 'Beans',          draw: drawBeans       },
  'trade-citrus':        { label: 'Citrus Fruit',   draw: drawCitrus      },
  'trade-coffee':        { label: 'Coffee',         draw: drawCoffee      },
  'trade-honeybees':     { label: 'Honeybees',      draw: drawHoneybees   },
  'trade-pears':         { label: 'Pears',          draw: drawPears       },
  'trade-squash':        { label: 'Squash',         draw: drawSquash      },
  'trade-sweetpotato':   { label: 'Sweet Potato',   draw: drawSweetPotato },
  'trade-tomato':        { label: 'Tomato',         draw: drawTomato      },
  'trade-palmoil':       { label: 'Palm Oil',       draw: drawPalmOil     },
  'trade-peanuts':       { label: 'Peanuts',        draw: drawPeanuts     },
  'trade-peppers':       { label: 'Peppers',        draw: drawPeppers     },
  'trade-rubber':        { label: 'Rubber',         draw: drawRubber      },
};

const RELIGIONS = {
  'religion-christianity': { label: 'Christianity', draw: drawChristianity },
  'religion-islam':        { label: 'Islam',        draw: drawIslam        },
  'religion-buddhism':     { label: 'Buddhism',     draw: drawBuddhism     },
  'religion-hinduism':     { label: 'Hinduism',     draw: drawHinduism     },
  'religion-judaism':      { label: 'Judaism',      draw: drawJudaism      },
};
function isTradeStamp(type)    { return type in TRADE_GOODS; }
function isReligionStamp(type) { return type in RELIGIONS; }

function initTradeIcons() {
  Object.entries(TRADE_GOODS).forEach(([type, { draw }]) => {
    const c = document.getElementById('icon-' + type);
    if (!c) return;
    // Center dynamically so any button-canvas size renders centered (36×30
    // trade/landmark buttons and 28×22 War-panel buttons both work).
    draw(c.getContext('2d'), c.width / 2, c.height / 2, c.height * 0.53);
  });
}

function initReligionIcons() {
  Object.entries(RELIGIONS).forEach(([type, { draw }]) => {
    const c = document.getElementById('icon-' + type);
    if (!c) return;
    draw(c.getContext('2d'), 18, 15, 16);
  });
}

// ── Toolbar icons ────────────────────────────────────────────────────────────

// Every SVG stamp (Mountain, Major Peak, City, Oasis, Danger, Battle, …) draws
// its own toolbar button on load via _makeSvgStamp. Desert stays programmatic.
drawDesertIcon(document.getElementById('icon-desert').getContext('2d'), 14, 12, 0.28, '#111');
(function() {
  const ac = document.getElementById('icon-arrow-black').getContext('2d');
  const x1 = 4, x2 = 24, cy = 11, hs = 6;
  ac.strokeStyle = '#111'; ac.fillStyle = '#111';
  ac.lineWidth = 2.0; ac.lineCap = 'round';
  // Shaft
  ac.beginPath(); ac.moveTo(x1, cy); ac.lineTo(x2 - hs * 0.7, cy); ac.stroke();
  // Arrowhead triangle
  ac.beginPath();
  ac.moveTo(x2, cy);
  ac.lineTo(x2 - hs, cy - hs * 0.6);
  ac.lineTo(x2 - hs, cy + hs * 0.6);
  ac.closePath(); ac.fill();
})();
// (shade toolbar icon is now an inline paintbrush SVG in the markup)
// Line button icons — use button-scale dash patterns (not the map-scale ones)
const LINE_ICON_DASH = {
  'line-solid':   [],
  'line-dotted':  [2, 6],       // round dots with clear gaps
  'line-dashed':  [9, 6],       // distinct dashes
  'line-dashdot': [9, 4, 2, 4], // dash · dot pattern
  'line-arrow':   [],           // solid line + arrowhead
};
// ── Lines dropdown (consolidated line tools) ───────────────────────────────
let lineMenuStyle = 'line-solid';   // last-picked line type, shown on the trigger
const LINE_MENU_TYPES = ['line-solid','line-dotted','line-dashed','line-dashdot','line-arrow'];

// Draw a line preview into a canvas (sized to the canvas); light strokes for the
// dark toolbar / dropdown. Adds an arrowhead for 'line-arrow'.
// One swatch renderer for line styles — the right-panel buttons AND the key
// draw through this, so a key row always mirrors the panel (colour aside).
function drawLineSwatch(c, x0, y, w, type, color) {
  const col = color || '#111';
  c.save();
  c.strokeStyle = col; c.lineWidth = 2.5; c.lineCap = 'round';
  c.setLineDash(LINE_ICON_DASH[type] || []);
  const tipX = x0 + w;
  const lineEnd = type === 'line-arrow' ? tipX - 6 : tipX;
  c.beginPath(); c.moveTo(x0, y); c.lineTo(lineEnd, y); c.stroke();
  c.setLineDash([]);
  if (type === 'line-arrow') {
    const hs = 7;
    c.fillStyle = col;
    c.beginPath();
    c.moveTo(tipX, y);
    c.lineTo(tipX - hs, y - hs * 0.6);
    c.lineTo(tipX - hs, y + hs * 0.6);
    c.closePath(); c.fill();
  }
  c.restore();
}
function drawLineIcon(canvas, type) {
  if (!canvas) return;
  const c = canvas.getContext('2d');
  const W = +canvas.dataset.lw || canvas.width, H = +canvas.dataset.lh || canvas.height, y = Math.round(H / 2);
  c.clearRect(0, 0, W, H);
  drawLineSwatch(c, 3, y, W - 6, type, '#111');
}

function renderLineMenu() {
  // Cross-file guard: tool state (`activeStamp`, a `let`) lives in the core
  // script, which loads after this one — a load-time call here must no-op.
  // The core script re-calls this once state exists.
  if (typeof activeStamp === 'undefined') return;
  drawLineIcon(document.getElementById('icon-lines-current'), lineMenuStyle);
  LINE_MENU_TYPES.forEach(type => {
    drawLineIcon(document.getElementById('icon-lm-' + type), type);
    const item = document.getElementById('lmitem-' + type);
    if (item) item.classList.toggle('active', activeStamp === type);
  });
  const btn = document.getElementById('btn-lines');
  if (btn) btn.classList.toggle('active', isLineStamp(activeStamp));
}

function toggleLineMenu(e) {
  if (e) e.stopPropagation();
  const menu = document.getElementById('line-menu');
  const btn  = document.getElementById('btn-lines');
  if (menu.style.display !== 'none') { menu.style.display = 'none'; return; }
  const r = btn.getBoundingClientRect();   // position:fixed → escapes toolbar's overflow clipping
  menu.style.left = Math.round(r.left) + 'px';
  menu.style.top  = Math.round(r.bottom + 4) + 'px';
  menu.style.display = 'flex';
  renderLineMenu();
}

function closeLineMenu() {
  const menu = document.getElementById('line-menu');
  if (menu) menu.style.display = 'none';
}

function pickLine(type) {
  selectStamp(type);      // toggles — re-picking the active type turns it off
  lineMenuStyle = type;   // remember the choice for the trigger button face
  renderLineMenu();
  closeLineMenu();
}

// Close the menu when clicking anywhere outside it (or the trigger).
document.addEventListener('click', e => {
  if (!e.target.closest('#line-menu') && !e.target.closest('#btn-lines')) closeLineMenu();
});

// renderLineMenu() is called from the core script once tool state exists —
// it reads `activeStamp`, a later `let` (cross-file TDZ).
initTradeIcons();

// ── Feature panel icons (scaled to match new half-widths) ────────────────────
(function() {
  // Wall icon (image-based; falls back to programmatic until the tile loads)
  renderWallButton();

  // Railroad + canal previews: the real drawing functions, straight path
  renderFeaturePreview('icon-feature-railroad', 'feature-railroad');
  renderFeaturePreview('icon-feature-canal', 'feature-canal');

})();
initReligionIcons();

