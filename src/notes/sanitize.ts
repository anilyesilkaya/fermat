import DOMPurify from 'dompurify';

/**
 * HTML sanitization for rendered note Markdown.
 *
 * Threat model: note Markdown is untrusted (it may come from an imported
 * project ZIP authored elsewhere). After Markdown → HTML we run DOMPurify with a
 * strict tag allowlist, which both removes dangerous constructs (scripts, event
 * handlers) AND effectively disables raw HTML the author typed: any tag not on
 * the list is dropped.
 *
 * Link/resource policy:
 *   - Anchor href: http, https, mailto, or relative. javascript:, data:,
 *     vbscript:, file: are rejected. (Ordinary links are fine — they don't load
 *     until clicked.)
 *   - Images: remote and data: sources are blocked so notes never auto-load a
 *     remote image (a tracking/exfiltration vector). Only relative sources —
 *     i.e. locally packaged assets — are allowed.
 *   - <iframe> is never allowed in note bodies.
 */

/** Formatting tags Markdown can produce that we permit in note bodies. */
const ALLOWED_TAGS = [
  'p', 'br', 'hr',
  'strong', 'em', 'b', 'i', 'u', 's', 'del', 'ins', 'sub', 'sup',
  'a',
  'code', 'pre', 'kbd', 'samp',
  'blockquote',
  'ul', 'ol', 'li',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
  'img',
  'span', 'div', // needed for KaTeX output; sanitized like everything else
];

const ALLOWED_ATTR = [
  'href', 'title', 'alt', 'src',
  'colspan', 'rowspan',
  'class', 'style', 'aria-hidden', // KaTeX uses class/style/aria-hidden
  'start', 'reversed', 'type',
];

/** Anchor href protocols we accept (plus relative URLs, which have no scheme). */
const SAFE_LINK_SCHEMES = new Set(['http:', 'https:', 'mailto:']);

let configured = false;

/** Install hooks once. Idempotent. */
function ensureHooks(): void {
  if (configured) return;
  configured = true;

  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    const el = node as Element;
    const tag = el.tagName?.toLowerCase();

    if (tag === 'a') {
      enforceSafeAnchor(el);
    } else if (tag === 'img') {
      enforceLocalImage(el);
    }
  });
}

function isRelative(url: string): boolean {
  // No scheme and not protocol-relative (`//host`) and not a bare `data:`/`js:`.
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return false; // has a scheme
  if (url.startsWith('//')) return false; // protocol-relative → resolves remote
  return true;
}

function enforceSafeAnchor(el: Element): void {
  const href = el.getAttribute('href');
  if (href == null) return;
  const trimmed = href.trim();
  if (isRelative(trimmed)) {
    // Relative links (into the reader, e.g. #page=…) are fine.
  } else {
    let scheme: string;
    try {
      scheme = new URL(trimmed).protocol;
    } catch {
      el.removeAttribute('href');
      return;
    }
    if (!SAFE_LINK_SCHEMES.has(scheme)) {
      el.removeAttribute('href');
      return;
    }
  }
  // External links open safely.
  if (!isRelative(trimmed)) {
    el.setAttribute('rel', 'noopener noreferrer nofollow');
    el.setAttribute('target', '_blank');
  }
}

function enforceLocalImage(el: Element): void {
  const src = el.getAttribute('src');
  if (src == null || !isRelative(src.trim())) {
    // Block remote/data images so notes never auto-load a remote resource.
    el.removeAttribute('src');
    el.remove();
  }
}

export interface SanitizeOptions {
  /** Allow the extra tags/attributes KaTeX emits (MathML + spans). */
  allowMath?: boolean;
}

/**
 * Sanitize an HTML string produced from note Markdown (and optionally KaTeX).
 * Returns a safe HTML string with no scripts, event handlers, or unsafe URLs.
 */
export function sanitizeNoteHtml(html: string, opts: SanitizeOptions = {}): string {
  ensureHooks();
  const config: Parameters<typeof DOMPurify.sanitize>[1] = {
    ALLOWED_TAGS: [...ALLOWED_TAGS],
    ALLOWED_ATTR: [...ALLOWED_ATTR],
    // Never permit these regardless of allowlist.
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'link', 'meta'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick'],
    ALLOW_DATA_ATTR: false,
    RETURN_TRUSTED_TYPE: false,
  };
  if (opts.allowMath) {
    config.USE_PROFILES = { html: true, mathMl: true, svg: true };
    // USE_PROFILES replaces ALLOWED_TAGS; drop our explicit list so the profile
    // union (html + MathML + our formatting needs) applies. Re-forbid dangers.
    delete config.ALLOWED_TAGS;
    delete config.ALLOWED_ATTR;
  }
  return DOMPurify.sanitize(html, config) as unknown as string;
}
