/**
 * @vitest-environment happy-dom
 *
 * Exercises the reliable-authoring state machine against the REAL storage layer
 * (fake-indexeddb), with a manually-driven timer so debounce is deterministic.
 */
import { beforeEach, describe, it, expect } from 'vitest';
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { NoteSaveController, type Timer } from './save-controller';
import { createAnnotation, getAnnotation, getDraft, saveAnnotation } from '../storage/storage';
import { _resetDbForTests } from '../storage/db';
import { buildAnnotation, nextAnnotationRevision } from './build';
import type { Anchor, Annotation } from '../model/schema';

const SHA = 'b'.repeat(64);
const DOC_ID = '11111111-1111-4111-8111-111111111111';
const NOW = '2026-01-01T00:00:00.000Z';

const anchor: Anchor = {
  kind: 'point',
  pageIndex: 0,
  pageViewBox: [0, 0, 612, 792],
  pageRotation: 0,
  userUnit: 1,
  coordinateSpace: 'pdf-user-space',
  point: [100, 100],
};

/** A timer whose scheduled callbacks fire only when we call flush(). */
function manualTimer(): Timer & { flush: () => void } {
  let pending: (() => void) | null = null;
  return {
    set(fn) {
      pending = fn;
      return 1;
    },
    clear() {
      pending = null;
    },
    flush() {
      const fn = pending;
      pending = null;
      fn?.();
    },
  };
}

async function seedAnnotation(): Promise<Annotation> {
  const ann = buildAnnotation({
    id: '22222222-2222-4222-8222-222222222222',
    documentSha256: SHA,
    anchor,
    now: NOW,
  });
  await createAnnotation(ann);
  return ann;
}

beforeEach(() => {
  indexedDB = new IDBFactory();
  _resetDbForTests();
});

describe('NoteSaveController', () => {
  it('commits an edit, bumping the stored revision by one', async () => {
    const base = await seedAnnotation();
    const ctrl = new NoteSaveController(base, { documentId: DOC_ID });
    ctrl.edit({ bodyMarkdown: 'hello' });
    expect(ctrl.state).toBe('dirty');

    const committed = await ctrl.commit();
    expect(committed.revision).toBe(base.revision + 1);
    expect(ctrl.state).toBe('saved');

    const stored = await getAnnotation(base.id);
    expect(stored?.bodyMarkdown).toBe('hello');
    expect(stored?.revision).toBe(2);
  });

  it('writes a recoverable draft on debounce without bumping the revision', async () => {
    const base = await seedAnnotation();
    const timer = manualTimer();
    const ctrl = new NoteSaveController(base, { documentId: DOC_ID, timer });

    ctrl.edit({ bodyMarkdown: 'work in progress' });
    timer.flush(); // fire the debounced draft write
    await Promise.resolve();
    // allow the async draft write to settle
    await new Promise((r) => setTimeout(r, 0));

    const draft = await getDraft(base.id);
    expect(draft?.bodyMarkdown).toBe('work in progress');
    // Committed annotation is untouched.
    const stored = await getAnnotation(base.id);
    expect(stored?.revision).toBe(1);
    expect(stored?.bodyMarkdown).toBe('');
  });

  it('enters conflict state (not overwrite) when another writer bumped the revision', async () => {
    const base = await seedAnnotation();
    const ctrl = new NoteSaveController(base, { documentId: DOC_ID });

    // Simulate another tab committing a change first.
    const other = nextAnnotationRevision(base, { bodyMarkdown: 'from other tab' }, NOW);
    await saveAnnotation(other, base.revision);

    ctrl.edit({ bodyMarkdown: 'my local edit' });
    await expect(ctrl.commit()).rejects.toThrow();
    expect(ctrl.state).toBe('conflict');

    // The other tab's value survived — no clobber.
    const stored = await getAnnotation(base.id);
    expect(stored?.bodyMarkdown).toBe('from other tab');
    // My text is preserved as a draft for recovery.
    const draft = await getDraft(base.id);
    expect(draft?.bodyMarkdown).toBe('my local edit');
  });

  it('rebases onto the latest value and can then commit cleanly', async () => {
    const base = await seedAnnotation();
    const ctrl = new NoteSaveController(base, { documentId: DOC_ID });

    const other = nextAnnotationRevision(base, { bodyMarkdown: 'other' }, NOW);
    await saveAnnotation(other, base.revision);

    ctrl.edit({ bodyMarkdown: 'mine' });
    await expect(ctrl.commit()).rejects.toThrow();

    // Reload the latest and rebase, keeping the pending edit.
    const latest = await getAnnotation(base.id);
    ctrl.rebaseOnto(latest!);
    const committed = await ctrl.commit();

    expect(committed.bodyMarkdown).toBe('mine');
    expect(committed.revision).toBe(3); // base(1) → other(2) → mine(3)
  });

  it('publishing an edit flips publication to public via a normal revision bump', async () => {
    const base = await seedAnnotation();
    const ctrl = new NoteSaveController(base, { documentId: DOC_ID });
    ctrl.edit({ publication: 'public' });
    const committed = await ctrl.commit();
    expect(committed.publication).toBe('public');
    expect(committed.revision).toBe(2);
  });
});
