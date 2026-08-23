// Classic script — shares the app's global lexical scope; load order matters.
// Must load BEFORE mapforge-persist.js.
// ── Base-map image store ─────────────────────────────────────────────────────
// Uploaded and cropped base maps are pictures, and pictures are what fill up
// browser storage. Two things happen here:
//
//   1. The image is re-encoded to WebP losslessly — pixel-for-pixel identical,
//      typically 35-45% smaller than the PNG. If the browser can't make WebP,
//      or if the original file was already smaller (an optimised PNG, or a
//      JPEG photo), the original bytes are kept instead. Never larger, never
//      degraded.
//   2. The bytes live in IndexedDB as binary, not in localStorage as base64.
//      Base64 inflates by a third, and localStorage caps out around 5MB;
//      IndexedDB stores the real bytes and its quota is a share of free disk.
//
// A browser save then references the image by id instead of carrying it. A
// .mapforge FILE still carries the picture inline, because a file has to open
// on someone else's computer — see serializeProjectForFile().
//
// Everything degrades: if IndexedDB is unavailable (private browsing, an old
// browser, a locked-down profile), MFBlobs.ready is false and saves fall back
// to the previous inline-base64 behaviour.

const MFBlobs = (function () {
  const DB_NAME = 'mapforge', STORE = 'images', DB_VERSION = 1;
  let _db = null, _opening = null;

  function open() {
    if (_db) return Promise.resolve(_db);
    if (_opening) return _opening;
    _opening = new Promise((resolve, reject) => {
      let req;
      try { req = indexedDB.open(DB_NAME, DB_VERSION); }
      catch (e) { return reject(e); }
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      };
      req.onsuccess = () => { _db = req.result; resolve(_db); };
      req.onerror   = () => reject(req.error);
      req.onblocked = () => reject(new Error('IndexedDB blocked'));
    });
    return _opening;
  }

  function tx(mode, fn) {
    return open().then(db => new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const r = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(r && r.result !== undefined ? r.result : undefined);
      t.onerror    = () => reject(t.error);
      t.onabort    = () => reject(t.error);
    }));
  }

  // Ids are content-addressed by size + a sample of the bytes, so re-opening
  // the same map twice doesn't store it twice.
  async function idFor(blob) {
    const buf = new Uint8Array(await blob.slice(0, 65536).arrayBuffer());
    let h1 = 0x811c9dc5, h2 = 0x01000193;
    for (let i = 0; i < buf.length; i++) {
      h1 = (h1 ^ buf[i]) * 0x01000193 >>> 0;
      h2 = (h2 + buf[i] * (i + 1)) >>> 0;
    }
    return blob.size.toString(36) + '-' + h1.toString(36) + h2.toString(36);
  }

  return {
    ready: typeof indexedDB !== 'undefined',

    async put(blob) {
      const id = await idFor(blob);
      await tx('readwrite', s => s.put(blob, id));
      return id;
    },
    get(id)    { return tx('readonly',  s => s.get(id)).then(v => v || null); },
    remove(id) { return tx('readwrite', s => s.delete(id)); },

    // Drop anything no save refers to any more.
    async sweep(keepIds) {
      const keep = new Set(keepIds.filter(Boolean));
      const all = await tx('readonly', s => s.getAllKeys());
      const dead = (all || []).filter(k => !keep.has(k));
      for (const k of dead) await tx('readwrite', s => s.delete(k));
      return dead.length;
    },

    // Re-encode losslessly and keep whichever representation is smaller.
    // Returns { blob, mime, shrunk } — `blob` is what should be stored.
    async compact(sourceBlob) {
      const original = { blob: sourceBlob, mime: sourceBlob.type || 'image/png', shrunk: false };
      let bmp;
      try {
        bmp = await createImageBitmap(sourceBlob);
      } catch (e) { return original; }          // undecodable: store as-is
      try {
        const c = document.createElement('canvas');
        c.width = bmp.width; c.height = bmp.height;
        c.getContext('2d').drawImage(bmp, 0, 0);
        const webp = await new Promise(r => c.toBlob(r, 'image/webp', 1));
        // A browser without WebP encoding silently hands back a PNG — check.
        if (webp && webp.type === 'image/webp' && webp.size < sourceBlob.size)
          return { blob: webp, mime: 'image/webp', shrunk: true };
        if (webp && webp.size < sourceBlob.size)
          return { blob: webp, mime: webp.type, shrunk: true };
      } catch (e) { /* fall through to the original */ }
      finally { if (bmp.close) bmp.close(); }
      return original;
    },
  };
})();

// Take any base-map source (a File, a Blob, or a data: URL), compact it, store
// it, and hand back what the app needs to display and to save it.
// Returns { id, url, mime } — or null when the store is unusable, in which case
// callers keep their existing behaviour.
async function adoptBaseImage(source) {
  if (!MFBlobs.ready) return null;
  try {
    let blob = source;
    if (typeof source === 'string') blob = await (await fetch(source)).blob();
    if (!(blob instanceof Blob)) return null;
    const { blob: stored, mime } = await MFBlobs.compact(blob);
    const id = await MFBlobs.put(stored);
    return { id, url: URL.createObjectURL(stored), mime };
  } catch (e) {
    return null;                                  // any failure = old behaviour
  }
}

function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload  = () => resolve(fr.result);
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });
}

// ── Persistent storage ───────────────────────────────────────────────────────
// By default a browser treats site data as disposable and may clear it when the
// disk gets tight; Safari discards it outright after about a week without a
// visit. Asking for "persistent" storage exempts the app from that, which is
// the difference between a teacher's saved maps surviving a school holiday and
// quietly vanishing.
//
// WHEN this is asked matters. Chrome and Safari decide silently, but Firefox
// shows the user a permission prompt — so it fires after the first successful
// save, when the answer to "may this site keep data?" is obviously yes, rather
// than at load, where it would be an unexplained popup. Asked once per session,
// never re-asked once granted, and a refusal changes nothing: saving works
// exactly as before, the data is just evictable again.
let _persistRequested = false;

async function requestPersistentStorage() {
  if (_persistRequested) return null;
  _persistRequested = true;
  try {
    if (!navigator.storage || !navigator.storage.persist) return null;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch (e) {
    return null;                      // unsupported or blocked: carry on
  }
}

// How much room this browser is actually giving the app. Diagnostic only —
// handy when a tester reports "it says storage is full".
async function storageReport() {
  try {
    const est = await navigator.storage.estimate();
    return {
      usedMB: +(est.usage / 1048576).toFixed(1),
      quotaMB: +(est.quota / 1048576).toFixed(1),
      persisted: await navigator.storage.persisted(),
    };
  } catch (e) { return null; }
}
