# Fermat

**Fermat is a free browser application for collecting PDFs, writing notes in their margins, and exporting selected readings as independent, interactive static-site assets.**

You read a PDF, highlight passages, and write notes that live in an adjacent web margin — never covering the page. When a reading is ready to share, Fermat exports it as an ordinary static directory that anyone can open without installing Fermat, creating an account, or contacting any server. The export drops straight into an existing static site (for example, alongside a page built with a static-site generator) as a self-contained folder.

> **Status: early development.** This README describes the product contract and intended design. Implementation is in progress; sections marked _planned_ are not yet built. See [Roadmap](#roadmap) for what exists versus what is scheduled.

The authoring app is distributed from **fermat.yesilkaya.dev**. That address hosts the authoring tool only — it is **not** a runtime dependency of anything you export. Exported readings never call back to it.

---

## Principles

- **Free.** The authoring app, core annotation features, project backup, and static export are free to use. No account, paid API, commercial viewer key, remote annotation database, or document upload is required for the core workflow.
- **Local-first.** Your personal collection stays on your device unless you deliberately export or publish it. No telemetry or document content leaves the browser in the core workflow.
- **Portable output.** A published reading is an ordinary static directory containing everything it needs. Readers open it with no install, no login, and no request to Fermat's domain.
- **Faithful to the page.** The original PDF layout stays intact. Notes occupy an adjacent margin; Fermat does not reflow the document to HTML or replace it with page screenshots as the primary reading surface.
- **Bidirectional links.** Opening a note highlights its source; opening a highlight focuses its note.
- **Open source recommended.** Fermat-owned code is licensed [MIT](LICENSE). Third-party notices are preserved, never overwritten.

---

## Features

### In the MVP

- **PDF import** with title, tags, reading status, and resume position.
- **Annotations:** text highlights, rectangular region notes, and point notes. Region and point notes work on scanned pages without selectable text (where text selection is unavailable, Fermat says so rather than requiring OCR).
- **Notes:** Markdown with safe math display and ordinary links.
- **Stable source anchors** and note deep links.
- **Exports:** editable project ZIP, Markdown export, and selective static-reader ZIP.
- **Existing PDF annotations** displayed through the renderer (supported types documented; not a full round-trip editor).
- **Responsive layout:** margin/drawer that adapts to width, with keyboard access.
- **Browser storage** with backup/restore.
- **Static-host integration:** local assets and a small optional click-to-open launcher for embedding in existing static pages.

### Deferred (not in the MVP)

Full citation management and discovery services · Word plugins · advanced pen input and handwriting recognition · arbitrary HTML/JavaScript/Python execution inside notes · automatic migration between PDF editions · lossless conversion of every app's annotation format · full Acrobat editing/export compatibility · native mobile apps · infinite canvas / mind maps · accounts, cloud sync, multiplayer editing, CRDTs · mandatory AI, OCR pipelines, vector databases, or MCP services.

Exported readings are **read-only** in the MVP. Any future browser-local reader notes will be clearly distinct from the author's publication and will not imply shared persistence.

---

## How it works

### The reading surface

A restrained interface: the PDF, margin notes, and compact navigation, with a collapsible collection sidebar. For each visible page, margin cards sit near their source anchors when space permits; collisions resolve deterministically while preserving order, and long notes expand without ever covering PDF content or losing a note. Pages render virtualized — only a bounded set of canvases stays live around the viewport (target: fewer than five active canvases in a single-page viewport). Dark mode keeps figures visually faithful rather than blindly inverting them.

Clicking a highlight focuses and reveals its note. Clicking a note scrolls to the page, reveals the anchor, and keeps browser history usable via stable fragments such as `#page=4&note=<uuid>` — page 4 is shown to the reader while the zero-based index 3 is used internally. Readings open directly from a fresh tab.

### Data model and anchors

- Original PDF bytes are **immutable**. A full SHA-256 digest is computed at import. Identity is a project ID plus annotation UUIDs — never a filename or title. A changed PDF is a new revision.
- Annotations use a **versioned JSON schema**. Anchors store canonical PDF-space quadrilaterals (four vertices per quad, documented ordering) or a point, plus page view box, inherent rotation, and user unit. Coordinate transforms are small pure functions with invariant tests; they account for CropBox offsets, rotation, zoom, and CSS scale. Device pixel ratio changes canvas resolution, not the canonical anchor.
- Optional **text context** (exact quote, prefix, suffix, with an explicit normalization version) supports validation and future recovery — not silent reattachment to an uncertain passage. A digest mismatch is always explicit; notes are never migrated to a different PDF automatically.
- **Publication defaults to private.** The owner explicitly marks each note for publication. Export ships an allowlisted public projection; the authoring database is never serialized into a reader.

### Persistence

Edits autosave transactionally with visible states — unsaved, saving, saved locally, failed — and "saved" appears only after commit. Debouncing never lets an older save clobber a newer edit; revision checks guard against conflicting edits from two tabs and preserve recoverable text on conflict. Persistent storage is requested when appropriate but refusal is non-fatal; quota exhaustion, disabled storage, and private-browsing limits are handled, and export works even when persistent storage cannot be used. The only promised cross-device transfer in the MVP is project export/import — there is no cloud sync.

---

## Export contract

### Editable project (backup)

A clearly labeled project ZIP containing the original PDF bytes, versioned metadata, all annotations, and local note assets, plus a manifest with sizes and checksums. It may contain private information. Imports reject unsafe ZIP paths, oversized decompression, and invalid schemas.

### Published reader

A ZIP that expands into a relocatable directory:

| File | Content |
| --- | --- |
| `index.html` | Read-only reader entry point |
| `document.pdf` | The selected source PDF |
| `manifest.json` | Allowlisted published title, source identity, schema, viewer version |
| `annotations.json` | Only explicitly publishable Fermat annotations |
| `assets/` | Versioned viewer code, PDF worker, CSS, required local resources |
| `notes.md` | Optional published-notes fallback with source links |
| `THIRD_PARTY_NOTICES.txt` | Required notices for bundled software |

Private notes, drafts, local filesystem paths, unsaved buffers, unrelated document metadata, and authoring caches are absent from every exported file. Search indexes and the Markdown fallback are built from the same filtered public data. Output is sorted deterministically to avoid unnecessary churn.

All runtime resources — including any PDF fonts/CMaps/WASM the renderer needs and any math assets actually used — are bundled locally. Exports fetch no CDN scripts and never call the authoring site; relative URLs resolve against the manifest or module location, not an assumed site root. The reader works at `/` and under nested subdirectories (e.g. `/examples/topic/readings/paper/`) with no server rewrites.

**Preflight** distinguishes Fermat notes from comments already embedded in the PDF. Selection flags on Fermat notes do not redact source bytes; if embedded comment annotations are detected, publication requires explicit review of the original PDF's inclusion. Fermat does **not** claim comprehensive sanitization, hidden-data removal, or redaction of the source PDF.

### Embedding

Start with an ordinary link and iframe:

```html
<iframe
  src="./readings/paper/index.html"
  title="Annotated paper"
  loading="lazy"
  style="width:100%;height:80vh;border:0"
></iframe>
<a href="./readings/paper/index.html">Open annotated paper</a>
```

For explicit on-demand loading, a tiny local launcher (target: under 5 KB compressed) creates the iframe only after a button click, with the plain link as fallback — `loading="lazy"` alone is not a click gate, and the source PDF is not fetched before the click. Multiple readers coexist on one host page without duplicate IDs or global-state collisions. The parent page need not expose React, a CSS framework, a math renderer, or any Fermat globals. An iframe provides style isolation; it is not by itself a security boundary against same-origin content. Any `postMessage` feature validates sender origin, source window, and message shape — and is omitted until needed.

---

## Architecture _(planned)_

TypeScript and Vite, with a minimal UI layer. Rendering, text access, and annotation access default to **PDF.js** (library and worker pinned to the same release). Metadata, annotations, and imported PDF blobs live in **IndexedDB** (never localStorage or base64). Exports use a compact ZIP library. Raw HTML is disabled in Markdown, rendered output is sanitized, and the math renderer loads only when needed.

Authoring and viewer entry points stay separate so the viewer bundles no authoring, database, import, or ZIP-export code. Shared code: schema validation, coordinate transforms, source navigation, note rendering — one rendering engine, one canonical annotation format. Direct runtime dependencies target **at most seven** initially (math assets and transitive weight listed separately).

| Module | Responsibility |
| --- | --- |
| `src/model/` | Versioned document/annotation types, validation, migration |
| `src/pdf/` | PDF.js adapter, viewport transforms, text selection, document lifecycle |
| `src/notes/` | Safe formatting, margin placement, source navigation |
| `src/storage/` | IndexedDB transactions, drafts, project restoration |
| `src/export/` | Allowlisted public projection and editable-project archive |
| `src/author/` | Personal collection and authoring interface |
| `src/viewer/` | Read-only portable reader |
| `src/embed/` | Optional small click-to-open launcher |
| `tests/fixtures/` | Self-authored or redistributable PDF test cases |

---

## Safety

PDF text, filenames, imported note Markdown, and JSON are treated as untrusted input. Arbitrary PDF scripting is disabled and PDF-metadata JavaScript actions are not implemented. Only safe link protocols are allowed; note output is sanitized; raw scripts, event handlers, and unsafe resource URLs are rejected. Notes do not auto-load remote images or iframes. Local note assets are explicitly packaged and size-limited. Renderer dependencies are kept patched. Demonstration PDFs are self-authored or appropriately licensed.

---

## Roadmap

Milestones, each gated by evidence before moving on:

1. **End-to-end publication slice.** One-PDF import, one text highlight with a note, one region note, stable reload, publication selection, and a static export — served from a second local static origin, embedded under a nested path, and shown working with every external domain blocked.
2. **Reliable authoring.** Collection, tags, reading position, safe Markdown/math, collision handling, responsive notes, project backup/restore, explicit save failures; validated against a rotated/cropped PDF and a scan; existing annotations displayed with documented supported types.
3. **Release-ready MVP.** Click launcher, publication preview, deep links, accessibility, documentation, dependency notices, deterministic exports, and a realistic browser test matrix (current Chromium and Firefox; WebKit automation distinguished from real Safari/iOS). A static-page fixture stands in for any static-site-generator integration until real build output is available.

---

## License

Fermat-owned code is licensed under the [MIT License](LICENSE). Bundled third-party software retains its own notices (see `THIRD_PARTY_NOTICES.txt` in exports and the project's dependency notices).
