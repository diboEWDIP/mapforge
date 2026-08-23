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

# Local server for MapForge -- see mapforge-server.py for what it does that a
# plain "python3 -m http.server" does not (no-cache, byte-serving for the live
# world map, and saving map-library entries).
python3 mapforge-server.py 7800
