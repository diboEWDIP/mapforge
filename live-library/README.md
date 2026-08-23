# Live map library

Each `.mapforge` file in this folder is one entry in the Map Library: a framed
region of the live world map plus the annotations that were on it when it was
saved. Opening an entry loads the real MapLibre map, already framed and marked
up; the marks come back as ordinary annotations the student can move, recolor,
or delete while adding their own.

`index.json` lists the entries and controls their order and grouping. Both it
and the entry files are written by the app, not by hand.

## Where entries come from

Entries are made on the maintainer's own machine, with a small authoring tool
that is deliberately not part of this repository. It needs the launcher's local
server (`mapforge-server.py`), which is the only thing in MapForge that writes
to disk — the published site can read this folder and nothing more. That is why
the app you are looking at has no way to add an entry: by design, the library
is read-only everywhere except where it is authored.

To get a new entry into students' hands, the maintainer saves it locally and
pushes this folder.

## Notes

- Entry files are small: a live map stores no base image, just the frame, the
  annotations, and a 220px thumbnail (the card's face).
- An entry is an ordinary MapForge project file. It opens with
  **Import ▸ Open from File…** too, and it flows through `migrateProject()` like
  any other save, so old entries keep working when the format changes.
