# learn-geometry

An interactive, Desmos-style geometry sketchpad built for CodeSignal math
courses. Users see an infinite, zoomable coordinate plane and can draw and
manipulate shapes directly on it; optionally a configured Q&A panel asks
the learner a question about what they've drawn.

The app is two pieces:

- A React + SVG canvas frontend (`src/`)
- A small Express server (`server.js`) that seeds and reports state

A backing `config.json` file at the repo root seeds the initial objects and,
optionally, the task question.

---

## Quick start

```sh
npm install
npm run dev        # Vite on :5173 + Express on :3000
```

Open `http://localhost:5173`. Vite proxies `/api/*` to the Express server.
For a one-process production build:

```sh
npm run preview    # builds dist/, serves everything from Express on :3000
```

Checks (neither is part of the release build):

```sh
npm test           # Vitest: geometry math, frontend/server parity, server text output
npm run typecheck  # tsc --noEmit (vite build doesn't type-check)
```

---

## What's on the canvas

The canvas fills the viewport. There's no fixed window — the plane extends
indefinitely in every direction, with axis tick labels (`1`, `2`, `5`, `10`,
…) that adapt as you zoom in or out.

### Navigation

- **Drag** on empty canvas → pan the view.
- **Scroll wheel** → zoom toward the cursor.
- **Hold `Space`** → temporarily switch to pan mode regardless of the active
  tool.
- **Middle-mouse drag** → pan, regardless of tool.
- **HUD** (top-right of canvas): `−` / `+` zoom buttons, current zoom factor,
  and a **Reset view** button that returns to origin + default zoom.

### Tools (top bar, left → right)

A config can limit which drawing tools appear with `tools` (see the
schema below); **Drag / Select** is always shown.

| Icon | Tool | Action |
|---|---|---|
| ↖ | **Drag / Select** | Click an object to select; drag a body to translate; drag a handle to resize; drag empty space to pan. |
| ● | **Point** | Click to place a single point at the cursor. An inline label editor opens at the new point — type a label and press `Enter` (or click away to skip). |
| ╱ | **Line** | Either drag from one endpoint to the other, or click the first endpoint and then click the second. Snap-to-grid applies to both clicks. |
| ○ | **Circle** | Press at the center, drag outward to set radius, release. |
| ▭ | **Rectangle** | Press one corner, drag to the opposite corner, release. |
| ⬠ | **Polygon** | Click each vertex in turn. Close with one of: click near vertex #1 (a hollow ring appears when you're close), double-click anywhere, or press `Enter`. `Esc` cancels. |

To the left of the tools: **undo** / **redo** (also `⌘Z` / `Ctrl+Z` and
`⇧⌘Z` / `Ctrl+Y`). To the right: an **eraser** button that clears the
canvas (undoable).

### Snapping

While drawing or editing, the cursor snaps to the nearest target within
~10 px. Snap targets are:

- **Major grid intersections** — the grid step adapts with zoom (`0.1`,
  `0.5`, `1`, `2`, `5`, `10`, …), so snap targets follow naturally.
- **Intersection points** between existing objects.
- **Vertices / anchors** of existing objects (line endpoints, rectangle
  corners, polygon vertices, circle centers, points). Function curves
  don't contribute snap points.

Intersection and vertex snaps beat the grid when they're at least as
close. A small ring is shown at the snap target so you can see it lock
on. Move mode does not snap the cursor, but **translating** a selected
object snaps its anchors to nearby intersection points and the
translation delta also snaps to whole grid steps.

### Selecting and editing

Clicking an object in **Drag / Select** mode selects it. The selected
object stays the same color but renders slightly thicker, and its sidebar
row is highlighted. Polygons and rectangles are hit-tested on their
**edges only** — clicking inside the filled area doesn't select them, so
points or other shapes sitting inside a polygon can be grabbed cleanly.

Once selected:

- **Drag the body** of any line/circle/rectangle/polygon/point to translate
  it. The delta snaps to whole grid steps when within 10 px of one.
- **Drag a handle** (small white square) at a corner / endpoint / vertex /
  circumference to resize or move that piece. The opposite anchor stays
  pinned for rectangles; the line's other endpoint stays put for lines; the
  circle's center stays put for radius drag.
- **Drag the rotation handle** (small white circle outside the bottom-right
  corner of a rectangle, or near the outermost vertex of a polygon) to
  rotate the shape around its center. Rotation snaps to **15°** when close.
- **Delete / Backspace** removes the selected object (undoable).
- **Arrow keys** nudge the selected object by 1 unit; **Shift + Arrow** nudges
  by 5 units. Each press is one undo step. Function curves are skipped.
- **Double-click a point's label** to re-open the inline label editor.
- All edits commit a single undo step per drag.

Objects with `"locked": true` in `config.json` are the lesson's givens.
They can be selected and measured, but not moved, resized, rotated,
nudged, relabeled, or deleted: there are no handles, dragging one pans
the view, the sidebar shows its fields read-only with no delete button,
and the eraser clears everything **except** locked objects.

### Measurements (optional)

Off unless `config.json` sets `showMeasurements` to `"selected"` (only
the selected object) or `"all"` (every object). With it on:

- **On the canvas** — segment lengths, side lengths of rectangles and
  polygons, interior angles (a square marker for right angles, reflex
  angles over 180° for concave shapes), circle radii, and the angle
  wherever two segments share an endpoint. Labels follow live while you
  drag. Lengths show 2 decimals, angles 1.
- **While drawing** — the current length (and the angle at the last
  vertex, or against a segment you started from) next to the cursor;
  radius for circles, width × height for rectangles.
- **Typed lengths** — after the first click of a line, or at any vertex
  of a polygon in progress, type a number to open a small entry box:
  `5` places the next point 5 units toward the cursor, `5, 30` places it
  5 units at 30° (counterclockwise from +x). Expressions such as
  `3*sqrt(2)` work. `Enter` commits, `Esc` closes the box.
- **In the sidebar** — segments get editable `length` and `angle°`
  fields (the first endpoint stays put); rectangles and polygons list
  their `sides` and `angles` in vertex order.

`"none"` (or omitting the key) leaves the sim exactly as it was without
measurements, which is what you want for ruler-and-protractor practice
where reading the numbers off the screen would defeat the exercise.

### Intersection points

Any time two objects geometrically intersect, the intersection points are
highlighted with a small amber dot. Click a dot to display its coordinates
as a label. Pairs supported:

- line × line, line × rectangle/polygon edges, line × circle
- rectangle/polygon × circle (edges)
- rectangle × rectangle, polygon × polygon (edges)
- circle × circle
- function curve × line/rectangle/polygon/circle (numerical, via
  sample-and-bisect)
- function curve × function curve (in the currently visible x range)

Self-intersection is not tracked.

### Sidebar (Objects panel)

The sidebar on the left lists every object. Each row shows an icon, the
auto-generated description, and the type. Clicking a row selects the
object on the canvas (and vice versa).

Objects without an explicit `label` get a default name based on type:
points/circles/lines show their coordinates; **rectangles** show
`"Rectangle"`; **polygons** are named by vertex count
(`"Triangle"` for 3, `"Quadrilateral"` for 4, up to `"Octagon"` for 8;
beyond that it falls back to `"Polygon (N points)"`). Setting `label`
in `config.json` or via the editor always wins.

Selecting a row expands an inline editor underneath with the object's
parameters as input fields. Edit any field and press **Enter** (or click
away) to commit; **Esc** reverts. The editor stays in sync with on-canvas
edits.

At the bottom of the list is a single **+ Add formula** row. Click it,
type a formula, and press Enter to add it. Supported formulas:

- `y = <expression>` — adds a function curve. Example: `y = x^2 - 4`.
- `(x - a)^2 + (y - b)^2 = r^2` — adds a circle.

### Persistence

- Every change is saved both to the browser's `localStorage` and POSTed to
  `/api/state` (in-memory on the server).
- On reload, the React app calls `GET /api/config` and shows the seed
  objects from `config.json`.
- The browser falls back to `localStorage` if the API is unreachable, so
  the app degrades gracefully when only Vite is running.

---

## Q&A panel (optional)

If `config.json` includes a `task`, a floating panel appears in the
bottom-right of the viewport with the question. It supports two modes:

- **Freeform** — a textarea. `onChange` is debounced 300 ms.
- **Multiple choice** — 2–4 radio buttons. `onChange` fires immediately.

There's no submit button. Every change is POSTed to `/api/task/answer` and
held in server memory as `submittedAnswer` until the next change. The
panel collapses to a small `?` pill via its header chevron.

If `task` is absent or fails validation, the panel does not render.

The vanilla module powering the panel lives at `src/shared/task-panel/`
and is dependency-free, so it can move into the design system later.

---

## API endpoints

Served by `server.js` on the same port as the app in production (`:3000`)
and proxied through Vite in development.

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/config` | Returns `{ objects, sidebarOpen, viewCenter, tools, showMeasurements }` from `config.json`. Always re-reads from disk. |
| `GET` | `/api/state` | Returns the current in-memory objects array. `?format=text` returns a human-readable summary for graders (see below). |
| `POST` | `/api/state` | Body `{ objects: GeomObject[] }`. Replaces the in-memory state. Called automatically by the frontend after every change. |
| `GET` | `/api/task` | Returns `{ task, submittedAnswer }`. `?format=text` returns a human-readable block including the learner's current answer (or `"(no task configured)"`). |
| `POST` | `/api/task/answer` | Body `{ answer: string }`. For multiple_choice, validates that `answer` is `""` or one of `options` (else `400`). |

State is **not** persisted across server restarts. `config.json` is read
only — it's the seed, never the destination.

### Text state (`GET /api/state?format=text`)

One line per object, then a `Relationships` section and an
`Intersections` section when there are any. Measurements are always
included here, whatever `showMeasurements` says, since this output is
for graders rather than learners. Locked objects end with `[locked]`.

```
Line (AB) from (0, 0) to (4, 0), length 4, direction 0° [locked]
Line from (0, 0) to (0, 3), length 3, direction 90°
Polygon with points (6, 0), (10, 0), (6, 3) and rotation 0 radians (0 degrees)
  Vertices: A (6, 0), B (10, 0), C (6, 3)
  Sides: AB = 4, BC = 5, CA = 3
  Angles: A = 90°, B = 36.87°, C = 53.13°
  Shape: right scalene triangle
  Perpendicular sides: AB ⊥ CA

Relationships (2):
  Line (AB) is perpendicular to Line from (0, 0) to (0, 3)
  Angle between Line (AB) and Line from (0, 0) to (0, 3) at (0, 0): 90°

Intersections (1):
  (0, 0)
```

- Rectangles and polygons list their vertices after rotation, named A,
  B, C… in drawing order; side AB runs from A to B.
- `Shape` names triangles by angles and sides (`acute isosceles
  triangle`), quadrilaterals by type (`square`, `rectangle`, `rhombus`,
  `parallelogram`, `trapezoid`, `isosceles trapezoid`, `right
  trapezoid`, `kite`), and flags `concave`, `self-intersecting`,
  `regular`, and degenerate shapes. Equality, parallel and perpendicular
  checks use a tight tolerance, so a shape drawn slightly off isn't
  called a square. Shape names are deliberately **not** shown in the
  learner's UI, where they'd give away "which shape is this?" answers.
- `Relationships` lists line segments that are parallel, collinear, or
  perpendicular to each other, and the angle wherever two segments
  share an endpoint.

---

## `config.json` schema

The single source of truth for what loads when the app starts.

### Top-level shape

```jsonc
{
  "objects":     [ /* GeomObject[] */ ],
  "task":        { /* Task — optional */ },
  "sidebarOpen": false,    /* optional, defaults to false */
  "viewCenter":  [0, 0],   /* optional, [x, y] or [x, y, zoom] — defaults to origin at 60× */
  "tools":       ["line", "polygon"],  /* optional, defaults to every tool */
  "showMeasurements": "none"           /* optional: "all" | "selected" | "none" (default) */
}
```

- `objects` is required (use `[]` if empty).
- `task` is optional. When absent or invalid, the Q&A panel does not
  render and the app runs in "building mode". On invalid task the server
  logs a `Task validation: …` warning.
- `sidebarOpen` is optional. `true` starts the app with the Objects
  sidebar expanded; `false` (or omitted) starts it collapsed. Users can
  still toggle it during the session; this only controls the initial
  state on page load.
- `viewCenter` is optional. A tuple of world coordinates that the
  canvas is centered on at startup: `[x, y]` to set only the center, or
  `[x, y, zoom]` to also set the initial zoom (the multiplier shown in
  the HUD; default `60`, must be `> 0`). Defaults to `[0, 0]` (the
  origin) at the default zoom. The "Reset view" button also returns
  the canvas to this center and zoom. Malformed entries are ignored.
- `tools` is optional. An array of drawing tools to show, from
  `"point"`, `"line"`, `"circle"`, `"rectangle"`, `"polygon"`; toolbar
  order stays fixed. **Drag / Select** is always available. Omit it to
  show every tool. Unknown names are ignored with a `Config:` warning;
  `[]` leaves only Drag / Select.
- `showMeasurements` is optional; see [Measurements](#measurements-optional).
  Anything other than `"all"`, `"selected"` or `"none"` falls back to
  `"none"` with a warning.
- Unknown top-level keys are ignored.

Every key added after the first release defaults to the old behavior, so
an existing `config.json` loads exactly as it did.

### Object types

Every object needs a unique string `id` and a discriminating `type`.
`label` is optional on every type — when set it's the row title in the
sidebar and the text drawn next to the shape; when omitted the app
auto-generates a description (e.g. `"Circle (0, 0), r=3"`).
`locked` is optional on every type too: `true` makes the object a fixed
given (see [Selecting and editing](#selecting-and-editing)).

Coordinates use standard math convention: **`+y` is up**, `(0, 0)` is the
origin. The visible window roughly covers `x, y ∈ [-10, 10]` at the
default zoom — anything farther will be off-screen until the user pans.

#### Point

```json
{ "id": "p1", "type": "point", "x": 0, "y": 0, "label": "Origin" }
```

#### Line (a segment, not infinite)

```json
{ "id": "l1", "type": "line", "x1": 0, "y1": 0, "x2": 6, "y2": 0 }
```

#### Circle

```json
{ "id": "c1", "type": "circle", "cx": 0, "cy": 0, "r": 3 }
```

`r` must be > 0.

#### Rectangle

```json
{
  "id": "r1",
  "type": "rectangle",
  "x": -2, "y": -2,
  "w": 4, "h": 4,
  "rotation": 0.7853981633974483
}
```

- `(x, y)` is the starting corner; `w` and `h` are signed offsets so the
  opposite corner is `(x + w, y + h)`. Negative values are accepted.
- `rotation` is **optional**, in **radians**, applied counterclockwise
  around the rectangle's center `(x + w/2, y + h/2)`. Default is `0`.
  - 30° → `0.5235987755982988`
  - 45° → `0.7853981633974483`
  - 60° → `1.0471975511965976`
  - 90° → `1.5707963267948966`
  - Convert: `radians = degrees * Math.PI / 180`.

#### Polygon

```json
{
  "id": "poly1",
  "type": "polygon",
  "points": [[0,0],[6,0],[0,4]],
  "rotation": 0.7853981633974483
}
```

- `points` is an array of `[x, y]` pairs, **minimum 3**, in order. The
  polygon closes automatically (no need to repeat the first vertex).
- `rotation` is **optional**, in **radians**, applied counterclockwise
  around the polygon's centroid (the average of `points`). Default is `0`.
  Same convention as rectangle rotation. Editing `points` in the sidebar
  is WYSIWYG: typed coordinates are treated as world positions and any
  existing rotation resets to 0.

#### Function curve `y = f(x)`

```json
{ "id": "fn1", "type": "function", "expression": "x^2 - 4", "label": "y = x²−4" }
```

- `expression` is the **right-hand side only**.
- Parsed by `mathjs`. Supported: `+ - * / ^`, `sqrt(x)`, `abs(x)`,
  `sin(x)`, `cos(x)`, `tan(x)`, `exp(x)`, `log(x)` (natural log),
  `log10(x)`, `pi`, `e`, and parentheses.

### Task

Two types. Anything else makes the panel hide.

#### Freeform

```json
{
  "task": {
    "question": "What is the area of this right triangle?",
    "type": "freeform",
    "correctAnswer": "12"
  }
}
```

- `question`: non-empty string.
- `type`: literal `"freeform"`.
- `correctAnswer`: string (numbers must be wrapped: `"12"`, not `12`).
  Not shown to the learner — used only for grading.

#### Multiple choice

```json
{
  "task": {
    "question": "Which figure has four equal sides?",
    "type": "multiple_choice",
    "options": ["Triangle", "Square", "Pentagon", "Hexagon"],
    "correctAnswer": "Square"
  }
}
```

- `question`: non-empty string.
- `type`: literal `"multiple_choice"`.
- `options`: array of **2–4 strings**. Each renders as one radio row.
- `correctAnswer`: must match one of the `options` strings **exactly**.

### Validation rules

- Top-level: malformed JSON → seed becomes `{ objects: [], task: null }`,
  warning logged. Same for `task` failing validation.
- Per-object: the frontend doesn't deeply validate object schemas. A
  malformed object may render as empty / `NaN` rather than throw, so the
  config should follow the schemas above.
- Per-task (server-side):
  - `task.type` not in `{"freeform", "multiple_choice"}` → ignored.
  - `question` missing or empty → ignored.
  - `correctAnswer` not a string → ignored.
  - For multiple_choice: `options` must be an array of 2–4 strings;
    `correctAnswer` must be in `options`.

### Complete examples

Two ready-made configs live in `examples/`:

- `examples/config-freeform.json` — a right triangle plus a freeform
  area question.
- `examples/config-mc.json` — a right triangle as 3 lines plus a
  multiple-choice area question.

Drop either into `config.json` and reload.

**Parabola–line intersection (freeform):**

```json
{
  "objects": [
    { "id": "para", "type": "function", "expression": "x^2", "label": "y = x²" },
    { "id": "line", "type": "line", "x1": -3, "y1": 4, "x2": 3, "y2": 4 }
  ],
  "task": {
    "question": "At what x-values does y = x² intersect y = 4? Enter both, comma-separated.",
    "type": "freeform",
    "correctAnswer": "-2, 2"
  }
}
```

**Rotated square:**

```json
{
  "objects": [
    {
      "id": "diamond",
      "type": "rectangle",
      "x": -2, "y": -2, "w": 4, "h": 4,
      "rotation": 0.7853981633974483,
      "label": "diamond"
    }
  ]
}
```

---

## Project layout

```
.
├── config.json               # Seed config — edit to control startup state
├── examples/                 # Drop-in example configs
├── server.js                 # Express API + production static server
├── intersections.js          # Server-side geometry math: intersections + measurements
│                             #   (mirrors src/lib/intersections.ts and measurements.ts)
├── tests/                    # Vitest suites (npm test)
├── src/
│   ├── App.tsx               # Root: owns objects, selection, history, mounts everything
│   ├── components/
│   │   ├── Canvas.tsx        # The infinite plane: rendering, tools, drawing state
│   │   ├── canvas/           # Canvas helpers: grid, picking, handles, snapping,
│   │   │                     #   MeasurementsLayer (length / angle labels)
│   │   ├── Toolbar.tsx       # Top bar: undo/redo, tools, eraser
│   │   ├── Sidebar.tsx       # Object list + inline editor + "Add formula" row
│   │   └── TaskPanelMount.tsx# Thin React wrapper around the vanilla task-panel
│   ├── shared/task-panel/    # Vanilla JS+CSS Q&A panel (portable, dep-free)
│   ├── lib/
│   │   ├── geometry.ts       # GeomObject types, formula parsing, label helpers
│   │   ├── intersections.ts  # Frontend intersection math
│   │   ├── measurements.ts   # Lengths, interior angles, joint angles, display formatting
│   │   └── api.ts            # fetch/postState with localStorage fallback
│   ├── styles.css            # Global app styles
│   └── main.tsx              # Vite entry
└── index.html
```

The server's math lives in `intersections.js` rather than new files
because the release workflow packs a fixed list of files (`dist`,
`server.js`, `intersections.js`, `config.json`, `package.json`,
`node_modules`). `tests/parity.test.ts` runs the frontend and server
copies on the same shapes so they can't drift apart.

---

## Keyboard shortcuts (reference)

| Keys | Action |
|---|---|
| `Space` (hold) | Temporary pan mode |
| `⌘Z` / `Ctrl+Z` | Undo |
| `⇧⌘Z` / `Ctrl+Shift+Z` / `Ctrl+Y` | Redo |
| `Delete` / `Backspace` | Delete selected object |
| `↑` `↓` `←` `→` | Nudge the selected object by 1 unit |
| `Shift` + arrow | Nudge the selected object by 5 units |
| `Enter` | Close polygon while drawing |
| `Esc` | Cancel in-progress drawing |
| `0`–`9` / `.` while drawing a line or polygon | Type the next side's length (and `, angle`) — only with `showMeasurements` on |

Shortcuts are suppressed while focus is in a text input.
