#!/bin/bash
# Double-click this file to get the latest changes and launch MapForge.

cd "$(dirname "$0")" || { echo "Could not find the MapForge folder."; read -n 1 -s -r -p "Press any key to close..."; exit 1; }

echo "==================================="
echo "            MapForge"
echo "==================================="
echo ""
echo "Getting the latest changes from GitHub..."
git pull
echo ""

# If it's already running, just open the browser and quit.
if curl -s -o /dev/null http://localhost:7800/index.html 2>/dev/null; then
  echo "MapForge is already running -- opening it in your browser."
  open "http://localhost:7800/index.html"
  echo ""
  read -n 1 -s -r -p "Press any key to close this window..."
  exit 0
fi

echo "Starting MapForge..."
(sleep 2; open "http://localhost:7800/index.html") &

echo ""
echo "  MapForge will open in your browser in a moment."
echo ""
echo "  ->  KEEP THIS WINDOW OPEN while you work."
echo "  ->  To stop: press Ctrl+C, or just close this window."
echo ""

# Local server for MapForge. Two things it must do that a plain
# 'python3 -m http.server' does NOT:
#   1. No-cache headers, so a git pull's changes show up instead of the
#      browser serving stale copies ("ghost bugs").
#   2. HTTP Range (byte-serving) support, which the live world map REQUIRES:
#      its .pmtiles map data is read in byte ranges. Without this the world
#      map shows only blue ocean + relief shading and no coastlines, and the
#      tools appear dead because the map never finishes loading. (GitHub Pages
#      supports Range, so the deployed site works even though a plain local
#      server does not — which is why this only bites when running locally.)
python3 -c "
import http.server, socketserver, os, re
class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Accept-Ranges', 'bytes')
        super().end_headers()
    def do_GET(self):
        rng = self.headers.get('Range')
        path = self.translate_path(self.path)
        if rng and os.path.isfile(path):
            m = re.match(r'bytes=(\d*)-(\d*)$', rng.strip())
            if m:
                size = os.path.getsize(path)
                s, e = m.groups()
                if s == '':
                    n = int(e); start = max(0, size - n); end = size - 1
                else:
                    start = int(s); end = int(e) if e else size - 1
                end = min(end, size - 1)
                if start > size - 1 or start > end:
                    self.send_response(416)
                    self.send_header('Content-Range', 'bytes */%d' % size)
                    self.end_headers(); return
                length = end - start + 1
                self.send_response(206)
                self.send_header('Content-Type', self.guess_type(path))
                self.send_header('Content-Range', 'bytes %d-%d/%d' % (start, end, size))
                self.send_header('Content-Length', str(length))
                self.end_headers()
                with open(path, 'rb') as f:
                    f.seek(start); remaining = length
                    while remaining > 0:
                        chunk = f.read(min(65536, remaining))
                        if not chunk: break
                        self.wfile.write(chunk); remaining -= len(chunk)
                return
        return super().do_GET()
socketserver.ThreadingTCPServer.allow_reuse_address = True
socketserver.ThreadingTCPServer(('', 7800), H).serve_forever()
"
