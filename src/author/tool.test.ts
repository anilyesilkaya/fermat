import { describe, it, expect } from 'vitest';
import {
  TOOLS,
  DEFAULT_TOOL,
  toolMeta,
  armedGesture,
  isToolAvailable,
  toolForShortcut,
  type AuthorTool,
} from './tool';

describe('tool model', () => {
  it('defaults to a tool that creates nothing', () => {
    expect(DEFAULT_TOOL).toBe('select');
    expect(armedGesture('select', true)).toBe('none');
    expect(armedGesture('select', false)).toBe('none');
  });

  it('arms exactly one gesture per tool on a text-layer page', () => {
    expect(armedGesture('highlight', true)).toBe('text-selection');
    expect(armedGesture('box', true)).toBe('drag-region');
    expect(armedGesture('pin', true)).toBe('click-point');
  });

  it('makes Highlight inert on a page with no text layer', () => {
    // The bug this whole milestone fixes: Highlight must not act where there is
    // no selectable text — it becomes a no-op, not a misfire.
    expect(armedGesture('highlight', false)).toBe('none');
    // Box and Pin do NOT need text and stay armed on scanned pages.
    expect(armedGesture('box', false)).toBe('drag-region');
    expect(armedGesture('pin', false)).toBe('click-point');
  });

  it('reports tool availability by text-layer need', () => {
    expect(isToolAvailable('highlight', true)).toBe(true);
    expect(isToolAvailable('highlight', false)).toBe(false);
    for (const t of ['select', 'box', 'pin'] as AuthorTool[]) {
      expect(isToolAvailable(t, true)).toBe(true);
      expect(isToolAvailable(t, false)).toBe(true);
    }
  });

  it('maps single-key shortcuts to tools, case-insensitively', () => {
    expect(toolForShortcut('v')).toBe('select');
    expect(toolForShortcut('H')).toBe('highlight');
    expect(toolForShortcut('b')).toBe('box');
    expect(toolForShortcut('P')).toBe('pin');
    expect(toolForShortcut('z')).toBeNull();
    expect(toolForShortcut('Escape')).toBeNull();
  });

  it('exposes complete, unique metadata for every tool', () => {
    const shortcuts = new Set<string>();
    for (const meta of TOOLS) {
      expect(meta.label.length).toBeGreaterThan(0);
      expect(meta.hint.length).toBeGreaterThan(0);
      expect(meta.cursor.length).toBeGreaterThan(0);
      expect(shortcuts.has(meta.shortcut)).toBe(false); // no dup shortcuts
      shortcuts.add(meta.shortcut);
      // Round-trip through the by-tool lookup.
      expect(toolMeta(meta.tool)).toBe(meta);
    }
    expect(TOOLS.map((t) => t.tool)).toEqual(['select', 'highlight', 'box', 'pin']);
  });
});
