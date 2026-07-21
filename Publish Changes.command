#!/bin/bash
# Double-click this file to send your changes up to GitHub so your collaborator gets them.

cd "$(dirname "$0")" || { echo "Could not find the MapForge folder."; read -n 1 -s -r -p "Press any key to close..."; exit 1; }

echo "==================================="
echo "     Publish MapForge Changes"
echo "==================================="
echo ""

if [ -z "$(git status --porcelain)" ]; then
  echo "No changes to publish -- everything is already saved to GitHub."
  echo ""
  read -n 1 -s -r -p "Press any key to close..."
  exit 0
fi

echo "These files changed:"
echo ""
git status --short
echo ""

read -p "Briefly describe what you changed: " MSG
if [ -z "$MSG" ]; then MSG="Update maps"; fi
echo ""

echo "Getting your collaborator's latest changes first..."
git pull --no-edit
if [ $? -ne 0 ]; then
  echo ""
  echo "*** Couldn't merge automatically. Ask Claude for help before continuing. ***"
  echo ""
  read -n 1 -s -r -p "Press any key to close..."
  exit 1
fi
echo ""

echo "Publishing..."
git add -A
git commit -m "$MSG"
git push

if [ $? -eq 0 ]; then
  echo ""
  echo "Done! Your changes are on GitHub."
else
  echo ""
  echo "*** Something went wrong pushing. Ask Claude for help. ***"
fi

echo ""
read -n 1 -s -r -p "Press any key to close..."
