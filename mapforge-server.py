#!/usr/bin/env python3
"""Local server for MapForge. Started by "Start MapForge.command".

Three things it does that a plain `python3 -m http.server` does NOT:

  1. No-cache headers, so a git pull's changes show up instead of the browser
     serving stale copies ("ghost bugs").
  2. HTTP Range (byte-serving), which the live world map REQUIRES: its
     .pmtiles data is read in byte ranges. Without this the world map shows
     only blue ocean and relief shading, and the tools look dead because the
     map never finishes loading. (GitHub Pages supports Range, so the
     deployed site is fine either way -- this only bites when running locally.)
  3. Saving map-library entries. The library is a folder of .mapforge files
     plus live-library/index.json listing them. The app POSTs here to add or
     remove an entry, so publishing is one click instead of moving files and
     editing code by hand. This is why the "Add to Map Library" button only
     works when the app is run from this launcher: the published site is
     static and has nothing to write to.

Usage: python3 mapforge-server.py [port]
"""

import http.server
import json
import os
import re
import socketserver
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
LIB_DIR = os.path.join(ROOT, 'live-library')
INDEX = os.path.join(LIB_DIR, 'index.json')
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 7800

# A published entry's filename is built from its name by the app; re-check it
# here so a POST can only ever touch one .mapforge file inside live-library/.
SAFE_NAME = re.compile(r'^[a-z0-9][a-z0-9-]{0,59}\.mapforge$')


def read_index():
    try:
        with open(INDEX) as f:
            data = json.load(f)
        return data if isinstance(data, list) else []
    except Exception:
        return []


def write_index(entries):
    os.makedirs(LIB_DIR, exist_ok=True)
    with open(INDEX, 'w') as f:
        json.dump(entries, f, indent=2)
        f.write('\n')


class Handler(http.server.SimpleHTTPRequestHandler):

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Accept-Ranges', 'bytes')
        super().end_headers()

    # ---- reads ----

    def do_GET(self):
        if self.path.split('?')[0] == '/__author-ping':
            # canSave says this server accepts writes; hasTool says the local
            # authoring file is present. Both are false everywhere but the
            # author's own machine -- the published site has no such route.
            return self.send_json({
                'ok': True,
                'canSave': True,
                'hasTool': os.path.isfile(os.path.join(ROOT, 'mapforge-author.js')),
            })
        rng = self.headers.get('Range')
        path = self.translate_path(self.path)
        if rng and os.path.isfile(path):
            m = re.match(r'bytes=(\d*)-(\d*)$', rng.strip())
            if m:
                return self.send_range(path, m)
        return super().do_GET()

    def send_range(self, path, m):
        size = os.path.getsize(path)
        s, e = m.groups()
        if s == '':
            start, end = max(0, size - int(e)), size - 1
        else:
            start, end = int(s), (int(e) if e else size - 1)
        end = min(end, size - 1)
        if start > size - 1 or start > end:
            self.send_response(416)
            self.send_header('Content-Range', 'bytes */%d' % size)
            self.end_headers()
            return
        length = end - start + 1
        self.send_response(206)
        self.send_header('Content-Type', self.guess_type(path))
        self.send_header('Content-Range', 'bytes %d-%d/%d' % (start, end, size))
        self.send_header('Content-Length', str(length))
        self.end_headers()
        with open(path, 'rb') as f:
            f.seek(start)
            remaining = length
            while remaining > 0:
                chunk = f.read(min(65536, remaining))
                if not chunk:
                    break
                self.wfile.write(chunk)
                remaining -= len(chunk)

    # ---- writes (library entries only) ----

    def do_POST(self):
        route = self.path.split('?')[0]
        if route not in ('/__library-save', '/__library-delete'):
            # Drain the body first, or the reset connection hides the 404.
            self.rfile.read(int(self.headers.get('Content-Length', 0) or 0))
            self.send_error(404)
            return
        # Only this app, running from this server, may write. Any other page
        # the teacher happens to have open sends a different Origin.
        origin = self.headers.get('Origin')
        if origin and origin not in ('http://localhost:%d' % PORT,
                                     'http://127.0.0.1:%d' % PORT):
            return self.send_json({'ok': False, 'error': 'Blocked: wrong origin.'}, 403)
        try:
            n = int(self.headers.get('Content-Length', 0))
            body = json.loads(self.rfile.read(n))
        except Exception:
            return self.send_json({'ok': False, 'error': 'Could not read the request.'}, 400)

        name = str(body.get('file', ''))
        if not SAFE_NAME.match(name):
            return self.send_json({'ok': False, 'error': 'Unsafe entry filename.'}, 400)
        target = os.path.join(LIB_DIR, name)

        if route == '/__library-delete':
            try:
                if os.path.isfile(target):
                    os.remove(target)
            except OSError as err:
                return self.send_json({'ok': False, 'error': str(err)}, 500)
            write_index([e for e in read_index() if e.get('file') != name])
            return self.send_json({'ok': True, 'entries': read_index()})

        project = body.get('project')
        if not isinstance(project, dict) or project.get('app') != 'mapforge':
            return self.send_json({'ok': False, 'error': 'That is not a MapForge map.'}, 400)
        try:
            os.makedirs(LIB_DIR, exist_ok=True)
            with open(target, 'w') as f:
                json.dump(project, f)
        except OSError as err:
            return self.send_json({'ok': False, 'error': str(err)}, 500)

        entry = {'file': name, 'label': str(body.get('label') or name)}
        section = str(body.get('section') or '').strip()
        if section:
            entry['section'] = section
        entries = read_index()
        for i, e in enumerate(entries):
            if e.get('file') == name:
                entries[i] = entry           # republish: replace in place, keep its position
                break
        else:
            entries.append(entry)
        write_index(entries)
        return self.send_json({'ok': True, 'entries': entries})

    def send_json(self, payload, code=200):
        raw = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def log_message(self, fmt, *args):
        # Keep publish/remove visible, hide the per-asset noise. Args are not
        # always strings (error paths pass the status code), so join defensively
        # -- an exception raised here would kill the request mid-flight.
        line = ' '.join(str(a) for a in args)
        if '__library' in line or 'code 4' in line or 'code 5' in line:
            super().log_message(fmt, *args)


if __name__ == '__main__':
    os.chdir(ROOT)
    socketserver.ThreadingTCPServer.allow_reuse_address = True
    socketserver.ThreadingTCPServer(('', PORT), Handler).serve_forever()
