/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { mountLauncher } from './launcher';

describe('mountLauncher — no eager download', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('does NOT create an iframe before the button is clicked', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    mountLauncher(container, { readerUrl: './readings/paper/index.html' });

    expect(container.querySelector('iframe')).toBeNull();
    expect(container.querySelector('button')).not.toBeNull();
    // Fallback link is present immediately.
    const link = container.querySelector('a[data-fermat-fallback]');
    expect(link?.getAttribute('href')).toBe('./readings/paper/index.html');
  });

  it('creates the iframe only after the click', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    mountLauncher(container, { readerUrl: './readings/paper/index.html', title: 'Paper' });

    container.querySelector('button')!.click();

    const iframe = container.querySelector('iframe');
    expect(iframe).not.toBeNull();
    expect(iframe!.getAttribute('src')).toBe('./readings/paper/index.html');
    expect(iframe!.getAttribute('title')).toBe('Paper');
    // Button was replaced by the iframe.
    expect(container.querySelector('button')).toBeNull();
  });

  it('ignores repeated clicks (idempotent open)', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const dispose = mountLauncher(container, { readerUrl: './r/index.html' });
    const button = container.querySelector('button')!;
    button.click();
    button.click(); // no-op; button already gone
    expect(container.querySelectorAll('iframe')).toHaveLength(1);
    dispose();
  });

  it('supports multiple independent launchers on one page', () => {
    const a = document.createElement('div');
    const b = document.createElement('div');
    document.body.append(a, b);
    mountLauncher(a, { readerUrl: './a/index.html' });
    mountLauncher(b, { readerUrl: './b/index.html' });

    // Open only the first.
    a.querySelector('button')!.click();
    expect(a.querySelector('iframe')!.getAttribute('src')).toBe('./a/index.html');
    // The second is untouched — still a button, no iframe.
    expect(b.querySelector('iframe')).toBeNull();
    expect(b.querySelector('button')).not.toBeNull();
  });
});
