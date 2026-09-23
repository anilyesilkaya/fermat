/**
 * The authoring tool model — a tiny, pure state machine that decides which page
 * gesture is armed and which note kind it produces.
 *
 * Why this exists: note *kind* used to be inferred from gesture geometry on a
 * surface shared with text selection (a small drag became a point, a big drag a
 * region, and text selection fired at the same time). That made bare clicks
 * create stray points and text selection create phantom regions. Making the
 * active tool explicit means exactly one input path is armed at a time, so the
 * conflict cannot happen. This module is DOM-free so the rules are unit-tested
 * without a browser; the app layer only wires events to `armedGesture`.
 */

/** The four authoring tools. `select` is the safe default: it creates nothing. */
export type AuthorTool = 'select' | 'highlight' | 'box' | 'pin';

/** The gesture a tool listens for on the page surface. */
export type ArmedGesture =
  | 'none' // select: no note-creating gesture is armed
  | 'text-selection' // highlight: read the text-layer selection
  | 'drag-region' // box: rubber-band drag → region note
  | 'click-point'; // pin: single click → point note

export interface ToolMeta {
  readonly tool: AuthorTool;
  /** Short label for the toolbar button. */
  readonly label: string;
  /** Single-key shortcut (lowercase). */
  readonly shortcut: string;
  /** CSS cursor to apply to the page surface while this tool is active. */
  readonly cursor: string;
  /** True when the tool can only work on a page that has a selectable text layer. */
  readonly needsTextLayer: boolean;
  /** One-line hint shown to the author when this tool is active. */
  readonly hint: string;
}

/** Ordered for display in the toolbar; `select` first (the default). */
export const TOOLS: readonly ToolMeta[] = [
  {
    tool: 'select',
    label: 'Select',
    shortcut: 'v',
    cursor: 'default',
    needsTextLayer: false,
    hint: 'Click a highlight to focus its note. No notes are created in this mode.',
  },
  {
    tool: 'highlight',
    label: 'Highlight',
    shortcut: 'h',
    cursor: 'text',
    needsTextLayer: true,
    hint: 'Select text on the page, then confirm to highlight it and add a note.',
  },
  {
    tool: 'box',
    label: 'Box',
    shortcut: 'b',
    cursor: 'crosshair',
    needsTextLayer: false,
    hint: 'Drag a rectangle over a figure or region to add a note.',
  },
  {
    tool: 'pin',
    label: 'Pin',
    shortcut: 'p',
    cursor: 'crosshair',
    needsTextLayer: false,
    hint: 'Click anywhere on the page to drop a point note.',
  },
];

const BY_TOOL: Record<AuthorTool, ToolMeta> = Object.fromEntries(
  TOOLS.map((t) => [t.tool, t]),
) as Record<AuthorTool, ToolMeta>;

/** The default tool: a safe mode that never creates a note. */
export const DEFAULT_TOOL: AuthorTool = 'select';

/** Metadata for a tool. */
export function toolMeta(tool: AuthorTool): ToolMeta {
  return BY_TOOL[tool];
}

/**
 * Which gesture a page should arm for the active tool.
 *
 * A tool that needs a text layer produces no armed gesture on a page that lacks
 * one — so Highlight on a scanned page is inert rather than misbehaving. This is
 * the single rule the DOM layer consults before deciding whether to act on a
 * mousedown/mouseup or a text selection.
 */
export function armedGesture(tool: AuthorTool, hasTextLayer: boolean): ArmedGesture {
  switch (tool) {
    case 'select':
      return 'none';
    case 'highlight':
      return hasTextLayer ? 'text-selection' : 'none';
    case 'box':
      return 'drag-region';
    case 'pin':
      return 'click-point';
  }
}

/**
 * Whether a tool is usable given the active page's text-layer availability.
 * Used to disable (and explain) the Highlight tool on scanned/image PDFs.
 */
export function isToolAvailable(tool: AuthorTool, hasTextLayer: boolean): boolean {
  return toolMeta(tool).needsTextLayer ? hasTextLayer : true;
}

/**
 * Resolve a keyboard shortcut to a tool, or null if the key is unbound.
 * Case-insensitive; callers should ignore this while focus is in a text field.
 */
export function toolForShortcut(key: string): AuthorTool | null {
  const k = key.toLowerCase();
  const found = TOOLS.find((t) => t.shortcut === k);
  return found ? found.tool : null;
}
