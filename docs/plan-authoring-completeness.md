# Milestone plan — Authoring completeness

**Audience this milestone serves:** the annotator/author.
**Status:** proposed, for review before any code.
**One-line goal:** make Fermat annotate *any* PDF — figures, equations, scans,
slides — not just text-layer PDFs, and make the three note kinds a deliberate,
discoverable choice instead of a side effect of how you happened to move the
mouse.

---

## 1. The surprise: this is 70% built, and the missing 30% includes a bug

Before proposing new work I traced the whole stack. Region and point notes are
**already plumbed end-to-end**:

| Layer | Text | Region | Point | Where |
|-------|------|--------|-------|-------|
| Build anchor | ✅ | ✅ | ✅ | `src/author/anchor.ts` (`buildTextAnchor`/`buildRegionAnchor`/`buildPointAnchor`) |
| Projection to PDF space | ✅ | ✅ | ✅ | `src/pdf/selection.ts` (`lineRectsToQuads`/`regionRectToQuad`/`clickPointToPdf`), unit-tested |
| Schema / persistence | ✅ | ✅ | ✅ | `src/model/schema.ts` (`anchor.kind` = text\|region\|point) |
| Author overlay render | ✅ | ✅ | ✅ | `src/notes/render.ts` `anchorHighlightRects` switches on all 3 kinds |
| Published viewer render | ✅ | ✅ | ✅ | `src/viewer/reader.ts` (`fx-hl` / `fx-hl-point`) |

So this milestone is **not greenfield**. The gap is entirely in the *authoring
interaction*, and it currently has a correctness bug.

### The bug (why this can't just ship as-is)

`src/author/app.ts::wirePageInput` (lines ~425–482) wires region/point creation
on the page's `mousedown`/`mousemove`/`mouseup`. But the text layer sits **inside
the same element** and events bubble, so the two input paths collide:

- **Any bare click on the page becomes a point note.** A click to dismiss a
  selection, or just to place focus, drags < 6px → falls into the
  `if (w < 6 && h < 6)` branch → silently creates a stray point annotation.
  This is an accidental-note factory.
- **Selecting text creates a phantom region note.** Drag-selecting a sentence
  starts a rubber-band region *and* a text selection at once. On mouseup the
  drag is > 6px → a **region note is created immediately** (no confirmation),
  while the "Highlight + note" text toolbar is *also* showing. One gesture, two
  conflicting outcomes.

The root cause is that the note *kind* is inferred from gesture geometry on a
shared surface, with no notion of "which tool is active." The fix and the
feature are the same work: **make the tool an explicit mode.**

---

## 2. Problem statement

1. **No tool model.** The kind of note is guessed from gesture size on a surface
   shared with text selection, producing accidental and conflicting notes (§1).
2. **Zero discoverability.** Nothing tells the author that dragging = box,
   clicking = pin, or selecting = highlight. There is no toolbar, cursor
   affordance, or hint. New users won't find region/point notes at all.
3. **No per-note color.** The schema supports `color` (default `#ffe066`) but the
   editor card exposes tags, public toggle, and delete — no color control. Every
   note is the same yellow.
4. **No feedback that a note was created**, and no undo for the inevitable
   mis-click.

Non-problems (explicitly *not* in this milestone — see §6):
- Editing/moving/resizing an existing anchor after creation.
- Reader-side navigation, search, tag filtering (that's the "reader experience"
  theme, deferred).
- The publish→bookshelf collection loop (the "publishing loop" theme, deferred).

---

## 3. Goals & non-goals

**Goals**
- G1. Annotating a scanned/image PDF (no text layer) is a first-class, obvious
  flow.
- G2. Each note kind is chosen deliberately via a visible tool; gestures never
  conflict and never create accidental notes.
- G3. Author can set a note's color at (or after) creation.
- G4. Every new interaction is covered by unit tests (pure logic) and at least
  one e2e test that authors a region and a point note and round-trips them
  through publish into the viewer.

**Non-goals**
- Anchor editing/resize/move (deferred, §6 Phase 2).
- New anchor *kinds* (ink/freehand, strikethrough) — out of scope.
- Any reader-side or publishing-pipeline change.

---

## 4. Design

### 4.1 Tool modes

Introduce an explicit `AuthorTool` with four values and a small state machine.
The active tool decides which page gesture is live; only one input path is armed
at a time, which structurally eliminates the §1 conflict.

| Tool | Cursor | Gesture | Produces | Works without text layer? |
|------|--------|---------|----------|---------------------------|
| **Select** (default) | `default` | click a highlight to focus its card; click empty space clears | nothing (no accidental notes) | — |
| **Highlight** | `text` | select text in the text layer | `text` anchor | no (needs text layer) |
| **Box** | `crosshair` | drag a rectangle on the page | `region` anchor | ✅ |
| **Pin** | `crosshair` | single click on the page | `point` anchor | ✅ |

Rules that kill the bug:
- Region/Box drag and Pin click listeners are **only attached when that tool is
  active** (or gated by a `this.tool` check at the top of each handler).
- In **Select** mode, `wirePageInput` does nothing — bare clicks never create
  notes.
- **Highlight** is the only mode that reads text selection; **Box/Pin** ignore
  it. A tool is never ambiguous.
- Tools that require a text layer (Highlight) are **disabled with a tooltip**
  ("This PDF has no selectable text — use Box or Pin") when the page has no text
  layer. This is the G1 payoff surfaced directly in the UI.

### 4.2 Toolbar

Extend the existing document toolbar (`app.ts` ~line 207, currently
`name / spacer / publishBtn / backupBtn`) with a segmented tool group on the
left: `[ Select ] [ Highlight ] [ Box ] [ Pin ]`. Active tool is visually
pressed. Keyboard shortcuts: `V` select, `H` highlight, `B` box, `P` pin
(ignored while focus is in a textarea/input).

### 4.3 Color

Add a color control to the editor card row (`buildEditorCard`, ~line 356, the
row that holds tags/public/delete). A small swatch set (≈5 presets) + native
`<input type="color">` fallback, wired through the existing
`NoteSaveController.edit({ color })` path — the controller and schema already
accept it, so this is UI-only. Newly created notes adopt the last-used color
(a `this.lastColor` on the app, default `#ffe066`).

### 4.4 Creation feedback + undo

- On create, briefly flash the new highlight/card (CSS class, ~600ms) so the
  author sees what happened and where.
- Provide a lightweight **Undo last note** (single-level is enough for this
  milestone): keep the id of the most recently created annotation; `Ctrl/Cmd+Z`
  (when not editing text) or a toast action deletes it via the existing
  `deleteAnnotation` path. This turns a mis-click from a cleanup chore into a
  keystroke and lowers the stakes of the whole feature.

---

## 5. Work breakdown

Ordered; each item is independently reviewable. Files are the concrete touch
points I confirmed by reading the code.

1. **Tool state machine (pure).** New `src/author/tool.ts`: `AuthorTool` type,
   a reducer/helper deciding which gesture is armed and whether Highlight is
   available given `hasTextLayer`. Pure → fully unit-tested with no DOM.
   *New tests:* `src/author/tool.test.ts`.

2. **Refactor `wirePageInput` to be tool-gated** (`src/author/app.ts`
   ~425–482). Guard region-drag and point-click on `this.tool === 'box' | 'pin'`.
   Remove the size-based kind inference. This is the bug fix from §1.

3. **Refactor text selection to Highlight-only** (`wireTextSelection`
   ~490–534). Only show the selection toolbar when `this.tool === 'highlight'`.

4. **Toolbar UI + shortcuts** (`app.ts` toolbar builder ~207; styles in
   `src/author/styles.ts`). Segmented control, active state, disabled Highlight
   when no text layer, keyboard handlers.

5. **Per-note color control** (`buildEditorCard` ~356; `styles.ts`). Swatches +
   color input → `controller.edit({ color })`. `lastColor` applied on create in
   `createNote` (~562).

6. **Creation flash + single-level undo** (`createNote`, plus a small toast/
   keyboard handler). Reuses `deleteAnnotation`.

7. **Docs/UX copy.** Update `README.md` "how to annotate" section to describe the
   four tools and the scanned-PDF path (G1). Add a one-line hint bar in the
   author view.

8. **Example bookshelf refresh (optional, nice-to-have).** Add a region note
   and a point note to `examples/readings.json` so the deployed demo showcases
   non-text annotations. Requires re-running `scripts/gen-example-pdfs.py`
   (venv) + `npm run build:examples`; both outputs are committed.

---

## 6. Sequencing

- **Phase 1 (this milestone):** items 1–7. Correct, discoverable authoring of all
  three kinds + color. Ships the G1 unlock (annotate scans/figures).
- **Phase 1.5 (optional):** item 8, demo refresh.
- **Phase 2 (future, not now):** select/move/resize an existing anchor;
  multi-level undo/redo; freehand/ink kind. Called out so reviewers know the
  boundary; explicitly deferred.

---

## 7. Test strategy

- **Unit (Vitest):**
  - `tool.test.ts` — the mode state machine: which gesture is armed per tool,
    Highlight disabled without a text layer, shortcut mapping.
  - Extend `anchor.test.ts` if any anchor-building change lands (none expected;
    builders are unchanged).
- **e2e (Playwright):** new `tests/e2e/authoring-kinds.spec.ts` —
  1. import a PDF, switch to **Box**, drag a rectangle → a region note appears;
  2. switch to **Pin**, click → a point note appears;
  3. set a color on one;
  4. mark public, publish, open the exported reader, assert the region highlight
     and point marker render (`fx-hl` / `fx-hl-point`) — closing the loop the
     current code path already supports.
  - A **regression** assertion: in **Select** mode, clicking empty page area and
    clicking on text create **zero** notes (guards against the §1 bug returning).
- **Gates:** `npm run typecheck`, `npm test`, `npm run test:e2e` all green;
  no new off-origin requests in the export (existing e2e contract).

---

## 8. Risks & mitigations

- **R1 — Gesture regressions in the shared page surface.** Mitigated by moving to
  explicit modes (one armed path) and the Select-mode "creates zero notes"
  regression test.
- **R2 — Region drag that ends outside the page** leaves state stuck. Attach the
  `mouseup`/`mousemove` to the document (or use pointer capture) during an active
  drag, not just the page element.
- **R3 — Touch / trackpad.** Use Pointer Events rather than Mouse Events so pen
  and touch drags work; low extra cost, meaningfully widens device support.
- **R4 — Scope creep toward anchor editing.** Held off explicitly in §6 Phase 2.

---

## 9. Definition of done

- All four tools selectable, visually indicated, keyboard-shortcut driven.
- A PDF with **no text layer** can be fully annotated with Box + Pin, and
  Highlight is clearly disabled with an explanatory tooltip.
- No gesture creates an unintended note; Select mode never creates notes.
- Per-note color is settable and persists through publish into the viewer.
- Unit + e2e green; README updated; the §1 bug is covered by a regression test.
