/**
 * @vitest-environment jsdom
 *
 * DOMPurify officially supports browsers and jsdom. happy-dom's HTML parser is
 * not faithful enough for it (it mis-nests <script>/<p> and drops safe anchors),
 * so these sanitizer tests — and the real security guarantees they check — run
 * under jsdom, which matches real browser parsing. The app itself uses the
 * browser's native window at runtime.
 */
import { describe, it, expect } from 'vitest';
import { sanitizeNoteHtml } from './sanitize';

describe('sanitizeNoteHtml — unsafe content', () => {
  it('strips <script> tags and their content', () => {
    const out = sanitizeNoteHtml('<p>ok</p><script>alert(1)</script>');
    expect(out).toContain('ok');
    expect(out.toLowerCase()).not.toContain('<script');
    expect(out).not.toContain('alert(1)');
  });

  it('removes inline event handlers', () => {
    const out = sanitizeNoteHtml('<img src="x.png" onerror="alert(1)">');
    expect(out.toLowerCase()).not.toContain('onerror');
    expect(out).not.toContain('alert(1)');
  });

  it('drops javascript: hrefs', () => {
    const out = sanitizeNoteHtml('<a href="javascript:alert(1)">x</a>');
    expect(out.toLowerCase()).not.toContain('javascript:');
  });

  it('drops data: and vbscript: hrefs', () => {
    const data = sanitizeNoteHtml('<a href="data:text/html,<script>1</script>">x</a>');
    expect(data).not.toContain('data:');
    const vb = sanitizeNoteHtml('<a href="vbscript:msgbox(1)">x</a>');
    expect(vb.toLowerCase()).not.toContain('vbscript:');
  });

  it('blocks iframes entirely', () => {
    const out = sanitizeNoteHtml('<iframe src="https://evil.example"></iframe>');
    expect(out.toLowerCase()).not.toContain('<iframe');
  });
});

describe('sanitizeNoteHtml — images do not auto-load remote resources', () => {
  it('removes images with remote http(s) src', () => {
    const out = sanitizeNoteHtml('<img src="https://tracker.example/pixel.gif">');
    expect(out).not.toContain('tracker.example');
    expect(out.toLowerCase()).not.toContain('<img');
  });

  it('removes images with protocol-relative src', () => {
    const out = sanitizeNoteHtml('<img src="//tracker.example/p.gif">');
    expect(out).not.toContain('tracker.example');
  });

  it('removes images with data: src', () => {
    const out = sanitizeNoteHtml('<img src="data:image/png;base64,AAAA">');
    expect(out).not.toContain('data:image');
  });

  it('keeps images with a relative (locally packaged) src', () => {
    const out = sanitizeNoteHtml('<img src="assets/fig1.png" alt="figure">');
    expect(out).toContain('assets/fig1.png');
  });
});

describe('sanitizeNoteHtml — safe content passes through', () => {
  it('keeps ordinary formatting', () => {
    const out = sanitizeNoteHtml('<p><strong>bold</strong> and <em>italic</em></p>');
    expect(out).toContain('<strong>bold</strong>');
    expect(out).toContain('<em>italic</em>');
  });

  it('keeps http(s) links and hardens them', () => {
    const out = sanitizeNoteHtml('<a href="https://example.com">x</a>');
    expect(out).toContain('href="https://example.com"');
    expect(out).toContain('rel="noopener noreferrer nofollow"');
    expect(out).toContain('target="_blank"');
  });

  it('keeps relative links (into the reader) without target/rel', () => {
    const out = sanitizeNoteHtml('<a href="#page=4&note=x">jump</a>');
    expect(out).toContain('href="#page=4');
    expect(out).not.toContain('target="_blank"');
  });

  it('keeps mailto links', () => {
    const out = sanitizeNoteHtml('<a href="mailto:a@b.com">mail</a>');
    expect(out).toContain('mailto:a@b.com');
  });
});
