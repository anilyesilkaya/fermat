/**
 * @vitest-environment jsdom
 *
 * renderNoteMarkdown runs its output through DOMPurify, which needs a
 * browser-faithful DOM (jsdom), not happy-dom. See sanitize.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { extractMath, hasMath, renderNoteMarkdown } from './markdown';

describe('extractMath', () => {
  it('extracts inline and display math', () => {
    const { text, segments } = extractMath('Euler: $e^{i\\pi}+1=0$ and $$\\int_0^1 x\\,dx$$');
    expect(segments).toHaveLength(2);
    expect(segments[1]!.display).toBe(true);
    expect(segments[0]!.display).toBe(false);
    expect(text).not.toContain('$');
  });

  it('preserves escaped dollar signs as literals', () => {
    const { text, segments } = extractMath('Costs \\$5 and \\$10');
    expect(segments).toHaveLength(0);
    expect(text).toBe('Costs $5 and $10');
  });

  it('hasMath detects presence', () => {
    expect(hasMath('no math here')).toBe(false);
    expect(hasMath('some $x$ math')).toBe(true);
  });
});

describe('renderNoteMarkdown', () => {
  it('renders basic markdown to sanitized html', async () => {
    const out = await renderNoteMarkdown('# Title\n\nSome **bold** text.');
    expect(out).toContain('Title');
    expect(out).toContain('<strong>bold</strong>');
  });

  it('neutralizes raw HTML in the source', async () => {
    const out = await renderNoteMarkdown('Hello <script>alert(1)</script> world');
    expect(out.toLowerCase()).not.toContain('<script');
    expect(out).not.toContain('alert(1)');
  });

  it('does not auto-load a remote image written as markdown', async () => {
    const out = await renderNoteMarkdown('![x](https://tracker.example/p.gif)');
    expect(out).not.toContain('tracker.example');
  });

  it('renders math without throwing on a bad formula', async () => {
    const out = await renderNoteMarkdown('Bad: $\\frac{1}{$');
    // Falls back to literal text rather than breaking the note.
    expect(typeof out).toBe('string');
    expect(out.length).toBeGreaterThan(0);
  });

  it('renders valid math to KaTeX markup', async () => {
    const out = await renderNoteMarkdown('$x^2$');
    expect(out.toLowerCase()).toContain('katex');
  });
});
