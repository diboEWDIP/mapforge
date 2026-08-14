// Extracted from index.html in the 2026-08 restructure (Stage 0.5).
// Classic script — shares the app's global lexical scope; load order matters.
// ── Drawing functions ────────────────────────────────────────────────────────

// Cache-bust icon fetches each page load so swapped PNG files always show the
// latest art (cp can preserve old mtimes, which otherwise serves a stale cache).
const ICON_BUST = '?v=' + Date.now();

// Offscreen canvas holding the mountain with white removed (luminance → alpha)
let _mountainCanvas = null;

(function() {
  const img = new Image();
  img.onload = () => {
    const oc = document.createElement('canvas');
    oc.width = img.naturalWidth; oc.height = img.naturalHeight;
    const oc2 = oc.getContext('2d');
    oc2.drawImage(img, 0, 0);
    const id = oc2.getImageData(0, 0, oc.width, oc.height);
    const d = id.data;
    for (let i = 0; i < d.length; i += 4) {
      const lum = 0.299 * d[i] + 0.587 * d[i+1] + 0.114 * d[i+2];
      // hard threshold: anything above 210 brightness → fully transparent
      // everything else → pure black with boosted opacity
      if (lum > 210) {
        d[i+3] = 0;
      } else {
        d[i+3] = Math.min(255, Math.round((255 - lum) * 1.6));
        d[i] = 0; d[i+1] = 0; d[i+2] = 0;
      }
    }
    oc2.putImageData(id, 0, 0);
    _mountainCanvas = _downscaleStepped(oc, 1024);   // high-quality master → sharp on map
    // Redraw toolbar icon now that the processed canvas is ready
    const c = document.getElementById('icon-mountain');
    if (c) _drawMountainToolbarIcon(c.getContext('2d'), 14, 11, 26, 20);
  };
  img.src = 'icons/Mountain.png' + ICON_BUST;
})();

// Draws cream-tinted lines for the dark toolbar button
function _drawMountainToolbarIcon(ctx, x, y, w, h) {
  if (!_mountainCanvas) return;
  // Sidebar palette shows the true map art, centred in the box
  ctx.clearRect(x - w/2, y - h/2, w, h);
  drawMountainIcon(ctx, x, y, Math.min(w, h) * 0.82);
  return;
  // temp canvas at DEVICE resolution — a logical-px temp was the blur
    const _tdpr = window.devicePixelRatio || 1;
    const tmp = document.createElement('canvas');
    tmp.width = w * _tdpr; tmp.height = h * _tdpr;
    const tc = tmp.getContext('2d');
    tc.scale(_tdpr, _tdpr);
  tc.fillStyle = '#111111';
  tc.fillRect(0, 0, w, h);
  tc.globalCompositeOperation = 'destination-in';
  tc.drawImage(_mountainCanvas, 0, 0, w, h);
  ctx.clearRect(x - w/2, y - h/2, w, h);
  ctx.drawImage(tmp, x - w/2, y - h/2);
}

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

// Draws black line-art (no white bg) onto the map canvas
function drawMountainIcon(ctx, x, y, size, color) {
  const w = size * 1.6, h = size * 1.25;
  ctx.save();
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  if (_mountainCanvas) {
    ctx.drawImage(_tintedMaster(_mountainCanvas, color), x - w/2, y - h/2, w, h);
  } else {
    // fallback triangle until image processes
    ctx.fillStyle = color || '#111';
    ctx.beginPath();
    ctx.moveTo(x, y - h/2);
    ctx.lineTo(x + w/2, y + h/2);
    ctx.lineTo(x - w/2, y + h/2);
    ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}

function drawPeakIcon(ctx, x, y, size, color) {
  _peakStamp.draw(ctx, x, y, size, color);
}

let _oasisCanvas = null;

(function() {
  const img = new Image();
  img.onload = () => {
    const oc = document.createElement('canvas');
    oc.width = img.naturalWidth; oc.height = img.naturalHeight;
    const oc2 = oc.getContext('2d');
    oc2.drawImage(img, 0, 0);
    const id = oc2.getImageData(0, 0, oc.width, oc.height);
    const d = id.data;
    for (let i = 0; i < d.length; i += 4) {
      const lum = 0.299 * d[i] + 0.587 * d[i+1] + 0.114 * d[i+2];
      if (lum > 210) {
        d[i+3] = 0;
      } else {
        d[i+3] = Math.min(255, Math.round((255 - lum) * 1.6));
        d[i] = 0; d[i+1] = 0; d[i+2] = 0;
      }
    }
    oc2.putImageData(id, 0, 0);
    _oasisCanvas = _downscaleStepped(oc, 1024);   // high-quality master → sharp on map
    const c = document.getElementById('icon-oasis');
    if (c) _drawOasisToolbarIcon(c.getContext('2d'), 14, 11, 26, 20);
  };
  img.src = 'icons/Oasis.png' + ICON_BUST;
})();

function _drawOasisToolbarIcon(ctx, x, y, w, h) {
  if (!_oasisCanvas) return;
  ctx.clearRect(x - w/2, y - h/2, w, h);
  drawOasis(ctx, x, y, Math.min(w, h) * 0.82);
  return;
    const _tdpr = window.devicePixelRatio || 1;
    const tmp = document.createElement('canvas');
    tmp.width = w * _tdpr; tmp.height = h * _tdpr;
    const tc = tmp.getContext('2d');
    tc.scale(_tdpr, _tdpr);
  tc.fillStyle = '#111111';
  tc.fillRect(0, 0, w, h);
  tc.globalCompositeOperation = 'destination-in';
  tc.drawImage(_oasisCanvas, 0, 0, w, h);
  ctx.clearRect(x - w/2, y - h/2, w, h);
  ctx.drawImage(tmp, x - w/2, y - h/2, w, h);
}

function drawOasis(ctx, x, y, size, color) {
  const w = size * 1.6, h = size * 1.25;
  ctx.save();
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  if (_oasisCanvas) {
    ctx.drawImage(_tintedMaster(_oasisCanvas, color), x - w/2, y - h/2, w, h);
  } else {
    // fallback circle until image processes
    ctx.fillStyle = '#2a6fbd';
    ctx.beginPath();
    ctx.arc(x, y, size * 0.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// ── Dark-toolbar image stamps (danger, peak) ─────────────────────────────────
// Same pipeline as mountain/oasis: threshold a PNG to black line-art, draw a
// cream-tinted icon on the dark toolbar button, and a black icon on the map/key.
function _makeDarkToolbarStamp(src, toolbarId) {
  const api = { cv: null };
  const img = new Image();
  img.onload = () => {
    const oc = document.createElement('canvas');
    oc.width = img.naturalWidth; oc.height = img.naturalHeight;
    const oc2 = oc.getContext('2d');
    oc2.drawImage(img, 0, 0);
    const id = oc2.getImageData(0, 0, oc.width, oc.height);
    const d = id.data;
    for (let i = 0; i < d.length; i += 4) {
      const lum = 0.299*d[i] + 0.587*d[i+1] + 0.114*d[i+2];
      if (lum > 210) { d[i+3] = 0; }
      else { d[i+3] = Math.min(255, Math.round((255 - lum) * 1.6)); d[i]=0; d[i+1]=0; d[i+2]=0; }
    }
    oc2.putImageData(id, 0, 0);
    api.cv = _downscaleStepped(oc, 1024);   // high-quality master → sharp on map
    const c = document.getElementById(toolbarId);
    if (c) api.toolbar(c.getContext('2d'), 14, 11, 26, 20);
  };
  img.src = src + ICON_BUST;
  api.toolbar = function(ctx, x, y, w, h) {     // sidebar: true map art
    if (!api.cv) return;
    ctx.clearRect(x - w/2, y - h/2, w, h);
    api.draw(ctx, x, y, Math.min(w, h) * 0.82);
    return;
    const _tdpr = window.devicePixelRatio || 1;
    const tmp = document.createElement('canvas');
    tmp.width = w * _tdpr; tmp.height = h * _tdpr;
    const tc = tmp.getContext('2d');
    tc.scale(_tdpr, _tdpr);
    tc.fillStyle = '#111111'; tc.fillRect(0, 0, w, h);
    tc.globalCompositeOperation = 'destination-in';
    tc.drawImage(api.cv, 0, 0, w, h);
    ctx.clearRect(x - w/2, y - h/2, w, h);
    ctx.drawImage(tmp, x - w/2, y - h/2, w, h);
  };
  api.draw = function(ctx, x, y, size, color) {  // tintable; default black
    if (!api.cv) return;
    const w = size * 1.6, h = size * 1.25;
    ctx.save();
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(_tintedMaster(api.cv, color), x - w/2, y - h/2, w, h);
    ctx.restore();
  };
  return api;
}

const _peakStamp   = _makeDarkToolbarStamp('icons/Major Peak.png', 'icon-peak');
const _dangerStamp = _makeDarkToolbarStamp('icons/Danger.png',     'icon-danger');
const _battleStamp = _makeDarkToolbarStamp('icons/Battle.png',     'icon-battle');

function drawDanger(ctx, x, y, size, color) {
  _dangerStamp.draw(ctx, x, y, size, color);
}

function drawBattle(ctx, x, y, size, color) {
  _battleStamp.draw(ctx, x, y, size, color);
}




// ── Image-stamp factory (flood-fill background removal) ──────────────────────
function _removeBackground(data, width, height, tolerance) {
  // Sample background color from the four corners and average them
  const corners = [0, (width-1), (height-1)*width, (height-1)*width+(width-1)];
  let bgR=0, bgG=0, bgB=0;
  corners.forEach(p => { bgR+=data[p*4]; bgG+=data[p*4+1]; bgB+=data[p*4+2]; });
  bgR=Math.round(bgR/4); bgG=Math.round(bgG/4); bgB=Math.round(bgB/4);

  // BFS flood-fill from all four corners, removing pixels close to bg color
  const visited = new Uint8Array(width * height);
  const queue = [...corners];
  let head = 0;
  while (head < queue.length) {
    const pos = queue[head++];
    if (visited[pos]) continue;
    visited[pos] = 1;
    const i = pos * 4;
    const dr = data[i]-bgR, dg = data[i+1]-bgG, db = data[i+2]-bgB;
    if (Math.sqrt(dr*dr + dg*dg + db*db) <= tolerance) {
      data[i+3] = 0;
      const x = pos % width, y = Math.floor(pos / width);
      if (x > 0)        queue.push(pos - 1);
      if (x < width-1)  queue.push(pos + 1);
      if (y > 0)        queue.push(pos - width);
      if (y < height-1) queue.push(pos + width);
    }
  }

  // Boost remaining (non-background) pixels to pure black with stronger opacity
  for (let i = 0; i < data.length; i += 4) {
    if (data[i+3] > 0) {
      const lum = 0.299*data[i] + 0.587*data[i+1] + 0.114*data[i+2];
      data[i+3] = Math.min(255, Math.round((255 - lum) * 1.5));
      data[i] = 0; data[i+1] = 0; data[i+2] = 0;
    }
  }
}

// Progressive (stepped) high-quality downscale: halving each pass avoids the
// aliasing/moiré you get downscaling a ~1150px source straight to ~30px in one
// drawImage. Returns a canvas whose longest side is ~maxDim.
function _downscaleStepped(src, maxDim) {
  let cur = src, w = src.width, h = src.height;
  const longest = Math.max(w, h);
  if (longest <= maxDim) return src;
  const scale = maxDim / longest;
  const tw = Math.max(1, Math.round(w * scale));
  const th = Math.max(1, Math.round(h * scale));
  while (w > tw * 2 || h > th * 2) {
    const nw = Math.max(tw, Math.floor(w / 2));
    const nh = Math.max(th, Math.floor(h / 2));
    const tmp = document.createElement('canvas');
    tmp.width = nw; tmp.height = nh;
    const tc = tmp.getContext('2d');
    tc.imageSmoothingEnabled = true; tc.imageSmoothingQuality = 'high';
    tc.drawImage(cur, 0, 0, nw, nh);
    cur = tmp; w = nw; h = nh;
  }
  if (w !== tw || h !== th) {
    const fin = document.createElement('canvas');
    fin.width = tw; fin.height = th;
    const fc = fin.getContext('2d');
    fc.imageSmoothingEnabled = true; fc.imageSmoothingQuality = 'high';
    fc.drawImage(cur, 0, 0, tw, th);
    cur = fin;
  }
  return cur;
}

function _makeImageStamp(src, toolbarId, tolerance=40) {
  let _canvas = null;
  const img = new Image();
  img.onload = () => {
    const oc = document.createElement('canvas');
    oc.width = img.naturalWidth; oc.height = img.naturalHeight;
    const oc2 = oc.getContext('2d');
    oc2.drawImage(img, 0, 0);
    const id = oc2.getImageData(0, 0, oc.width, oc.height);
    _removeBackground(id.data, oc.width, oc.height, tolerance);
    oc2.putImageData(id, 0, 0);
    // Pre-bake a high-quality "master" (longest side ~1024px) so every later
    // draw is a genuine downscale (supersampled, clean) even for large stamps
    // in a 2–4× export — matching the crispness of the small key icons. The
    // source PNGs are 1152px, so this is near their full detail ceiling.
    _canvas = _downscaleStepped(oc, 1024);
    if (toolbarId) {
      const c = document.getElementById(toolbarId);
      if (c) {
        // Render the button at device-pixel-ratio resolution so it stays crisp
        // on retina/HiDPI displays (CSS size unchanged via inline style).
        const dpr = Math.max(1, window.devicePixelRatio || 1);
        const cssW = c.width, cssH = c.height;
        c.style.width = cssW + 'px';
        c.style.height = cssH + 'px';
        c.width = Math.round(cssW * dpr);
        c.height = Math.round(cssH * dpr);
        const cx = c.getContext('2d');
        cx.scale(dpr, dpr);
        draw(cx, cssW / 2, cssH / 2, cssW * 0.44);
      }
    }
  };
  img.src = src + ICON_BUST;
  function draw(ctx, x, y, size, color) {
    const w = size * 1.6, h = size * 1.25;
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    if (_canvas) ctx.drawImage(_tintedMaster(_canvas, color), x - w/2, y - h/2, w, h);
    ctx.restore();
  }
  return draw;
}

const drawHorse        = _makeImageStamp('icons/Horse.png',          'icon-trade-horses');
const drawAmphora      = _makeImageStamp('icons/Olives.png',          'icon-trade-oliveoil');
const drawSilk         = _makeImageStamp('icons/Silk.png',            'icon-trade-silk');
const drawWheat        = _makeImageStamp('icons/Wheat.png',           'icon-trade-wheat');
const drawCamel        = _makeImageStamp('icons/Camel.png',           'icon-trade-camel');
const drawMolasses     = _makeImageStamp('icons/Molasses.png',        'icon-trade-molasses');
const drawRum          = _makeImageStamp('icons/Rum.png',             'icon-trade-rum');
const drawTea          = _makeImageStamp('icons/Tea.png',             'icon-trade-tea');
const drawCoal         = _makeImageStamp('icons/Coal.png',            'icon-trade-coal');
const drawCopper       = _makeImageStamp('icons/Copper.png',          'icon-trade-copper');
const drawCotton       = _makeImageStamp('icons/Cotton.png',          'icon-trade-cotton');
const drawDyes         = _makeImageStamp('icons/Dyes.png',            'icon-trade-dyes');
const drawFish         = _makeImageStamp('icons/Fishing.png',         'icon-trade-fish');
const drawFurs         = _makeImageStamp('icons/Furs.png',            'icon-trade-furs');
const drawGold         = _makeImageStamp('icons/Gold.png',            'icon-trade-gold');
const drawIncense      = _makeImageStamp('icons/Incense.png',         'icon-trade-incense');
const drawIndigo       = _makeImageStamp('icons/Indigo.png',          'icon-trade-indigo');
const drawIron         = _makeImageStamp('icons/Iron.png',            'icon-trade-iron');
const drawLumber       = _makeImageStamp('icons/Lumber.png',          'icon-trade-lumber');
const drawMillet       = _makeImageStamp('icons/Millet.png',          'icon-trade-millet');
const drawNavalStores  = _makeImageStamp('icons/Naval Stores.png',    'icon-trade-navalstores');
const drawPaper        = _makeImageStamp('icons/Paper.png',           'icon-trade-paper');
const drawPerfume      = _makeImageStamp('icons/Perfume.png',      'icon-trade-perfume');
const drawPorcelain    = _makeImageStamp('icons/Porcelain.png',     'icon-trade-porcelain');
const drawRice         = _makeImageStamp('icons/Rice.png',            'icon-trade-rice');
const drawSalt         = _makeImageStamp('icons/Salt.png',            'icon-trade-salt');
const drawShipbuilding = _makeImageStamp('icons/Shipbuilding.png',    'icon-trade-shipbuilding');
const drawSpices       = _makeImageStamp('icons/Spices.png',          'icon-trade-spices');
const drawStone        = _makeImageStamp('icons/Stone.png',           'icon-trade-stone');
const drawSugar        = _makeImageStamp('icons/Sugar.png',           'icon-trade-sugar');
const drawTextiles     = _makeImageStamp('icons/Textiles.png',        'icon-trade-textiles');
const drawTin          = _makeImageStamp('icons/Tin.png',             'icon-trade-tin');
const drawTobacco      = _makeImageStamp('icons/Tobacco.png',         'icon-trade-tobacco');
const drawWhaling      = _makeImageStamp('icons/Whaling.png',         'icon-trade-whaling');
const drawGrapes       = _makeImageStamp('icons/Wine.png',            'icon-trade-wine');
const drawWool         = _makeImageStamp('icons/Wool.png',            'icon-trade-wool');
const drawGem          = _makeImageStamp('icons/Gems.png',            'icon-trade-gem');
const drawOil          = _makeImageStamp('icons/Oil.png',             'icon-trade-oil');
const drawCorn         = _makeImageStamp('icons/Corn.png',            'icon-trade-corn');
const drawPotato       = _makeImageStamp('icons/Potato.png',          'icon-trade-potato');
const drawLead         = _makeImageStamp('icons/Lead.png',            'icon-trade-lead');
const drawMarble       = _makeImageStamp('icons/Marble.png',          'icon-trade-marble');
const drawWildAnimals  = _makeImageStamp('icons/Wild Animals.png',    'icon-trade-wildanimals');
const drawIvory        = _makeImageStamp('icons/Ivory.png',           'icon-trade-ivory');
const drawObsidian     = _makeImageStamp('icons/Obsidian.png',        'icon-trade-obsidian');
const drawCattle       = _makeImageStamp('icons/Cattle.png',          'icon-trade-cattle');
const drawGoats        = _makeImageStamp('icons/Goats.png',           'icon-trade-goats');
const drawPigs         = _makeImageStamp('icons/Pigs.png',            'icon-trade-pigs');
// Landmark icons — shown in the Features panel, behave as icon stamps
const drawTemple       = _makeImageStamp('icons/Temple.png',                'icon-feat-temple');
const drawMesoPyramid  = _makeImageStamp('icons/Mesoamerican Pyramid.png',  'icon-feat-mesopyramid');
const drawPyramid      = _makeImageStamp('icons/Pyramid.png',               'icon-feat-pyramid');
const drawFactory      = _makeImageStamp('icons/Factory.png',               'icon-feat-factory');
const drawCataract     = _makeImageStamp('icons/Cataract.png',              'icon-feat-cataract');
const drawFortress     = _makeImageStamp('icons/Fortress.png',              'icon-feat-fortress');
const drawZiggurat     = _makeImageStamp('icons/Ziggurat.png',              'icon-feat-ziggurat');
const drawChristianity = _makeImageStamp('icons/Christianity.png',    'icon-religion-christianity');
const drawIslam        = _makeImageStamp('icons/Islam.png',           'icon-religion-islam');
const drawBuddhism     = _makeImageStamp('icons/Buddhism.png',        'icon-religion-buddhism');
const drawHinduism     = _makeImageStamp('icons/Hinduism.png',        'icon-religion-hinduism');
const drawJudaism      = _makeImageStamp('icons/Judaism.png',         'icon-religion-judaism');



function drawCityIcon(ctx, x, y, size, color) {
  ctx.save();
  ctx.fillStyle = color || '#111';
  ctx.beginPath();
  ctx.arc(x, y, size/2, 0, Math.PI*2);
  ctx.fill(); ctx.restore();
}

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
  ctx.setLineDash(LINE_DASH[type] || []);

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
  // ── Landmark icons (shown in the Features panel; behave as icon stamps) ──
  'feat-temple':       { label: 'Temple',               draw: drawTemple      },
  'feat-mesopyramid':  { label: 'Mesoamerican Pyramid',  draw: drawMesoPyramid },
  'feat-pyramid':      { label: 'Pyramid',              draw: drawPyramid     },
  'feat-factory':      { label: 'Factory',              draw: drawFactory     },
  'feat-cataract':     { label: 'Cataract',             draw: drawCataract    },
  'feat-fortress':     { label: 'Fortress',             draw: drawFortress    },
  'feat-ziggurat':     { label: 'Ziggurat',             draw: drawZiggurat    },
};

const RELIGIONS = {
  'religion-christianity': { label: 'Christianity', draw: drawChristianity },
  'religion-islam':        { label: 'Islam',        draw: drawIslam,        mapSize: 38 },
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
    draw(c.getContext('2d'), 18, 15, 16);
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

_drawMountainToolbarIcon(document.getElementById('icon-mountain').getContext('2d'), 14, 11, 26, 20);
_peakStamp.toolbar(document.getElementById('icon-peak').getContext('2d'), 14, 11, 26, 20);
drawCityIcon(document.getElementById('icon-city').getContext('2d'), 14, 12, 14, '#111');
drawDesertIcon(document.getElementById('icon-desert').getContext('2d'), 14, 12, 0.28, '#111');
_drawOasisToolbarIcon(document.getElementById('icon-oasis').getContext('2d'), 14, 11, 26, 20);
_dangerStamp.toolbar(document.getElementById('icon-danger').getContext('2d'), 14, 11, 26, 20);
_battleStamp.toolbar(document.getElementById('icon-battle').getContext('2d'), 14, 11, 26, 20);
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

