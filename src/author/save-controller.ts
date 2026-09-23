import type { Annotation } from '../model/schema';
import {
  saveAnnotation,
  saveDraft,
  clearDraft,
  RevisionConflictError,
} from '../storage/storage';
import { nextAnnotationRevision, type AnnotationEdit } from './build';
import { nowIso } from './ids';

/**
 * Per-annotation save controller — the reliable-authoring state machine.
 *
 * Responsibilities:
 *   - Debounce keystrokes into a persisted DRAFT (crash/refresh recovery), using
 *     a monotonically increasing timestamp so a late debounced write can't
 *     clobber a newer one (see storage.saveDraft).
 *   - Commit edits with OPTIMISTIC CONCURRENCY: it tracks the base revision and
 *     bumps by exactly one. If another tab moved the revision, the commit throws
 *     RevisionConflictError; the draft is preserved and the state becomes
 *     'conflict' so the UI can offer reload/keep-both — the user's text is never
 *     silently lost or overwritten.
 *   - Expose an explicit save STATE ('idle'|'dirty'|'saving'|'saved'|'error'|
 *     'conflict') so the UI never claims "saved" when it isn't.
 *
 * The debounce timer is injected (setTimer/clearTimer) so tests can drive it
 * deterministically without real time.
 */

export type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error' | 'conflict';

export interface Timer {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

const realTimer: Timer = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export interface SaveControllerOptions {
  /** Owning document id — needed so drafts can be keyed/queried per document. */
  documentId: string;
  debounceMs?: number;
  timer?: Timer;
  /** Called whenever the save state changes (for UI). */
  onState?: (state: SaveState, controller: NoteSaveController) => void;
  /** Called after a successful commit with the new committed annotation. */
  onCommitted?: (annotation: Annotation) => void;
}

export class NoteSaveController {
  private current: Annotation;
  private draftTimer: unknown = null;
  private pendingEdit: AnnotationEdit = {};
  private _state: SaveState = 'idle';
  /** In-flight commit, so rapid triggers serialize instead of self-racing. */
  private inflight: Promise<Annotation> | null = null;
  private readonly documentId: string;
  private readonly debounceMs: number;
  private readonly timer: Timer;
  private readonly onState: ((s: SaveState, c: NoteSaveController) => void) | undefined;
  private readonly onCommitted: ((a: Annotation) => void) | undefined;

  constructor(base: Annotation, options: SaveControllerOptions) {
    this.current = base;
    this.documentId = options.documentId;
    this.debounceMs = options.debounceMs ?? 600;
    this.timer = options.timer ?? realTimer;
    this.onState = options.onState;
    this.onCommitted = options.onCommitted;
  }

  get state(): SaveState {
    return this._state;
  }
  get annotation(): Annotation {
    return this.current;
  }
  get baseRevision(): number {
    return this.current.revision;
  }

  private setState(s: SaveState): void {
    this._state = s;
    this.onState?.(s, this);
  }

  /** Record an edit and schedule a debounced draft write. */
  edit(edit: AnnotationEdit): void {
    this.pendingEdit = { ...this.pendingEdit, ...edit };
    this.setState('dirty');
    if (this.draftTimer !== null) this.timer.clear(this.draftTimer);
    this.draftTimer = this.timer.set(() => {
      void this.flushDraft();
    }, this.debounceMs);
  }

  /** Persist the current pending edit as a recoverable draft (no revision bump). */
  async flushDraft(): Promise<void> {
    if (this.draftTimer !== null) {
      this.timer.clear(this.draftTimer);
      this.draftTimer = null;
    }
    if (!this.hasPendingChanges()) return;
    const body = this.pendingEdit.bodyMarkdown ?? this.current.bodyMarkdown;
    try {
      await saveDraft({
        annotationId: this.current.id,
        documentId: this.documentId,
        bodyMarkdown: body,
        baseRevision: this.current.revision,
        updatedAt: nowIso(),
      });
    } catch {
      // A failed draft write must not crash typing; the commit path still runs
      // its own error handling and surfaces failures there.
    }
  }

  private hasPendingChanges(): boolean {
    const e = this.pendingEdit;
    return (
      (e.bodyMarkdown !== undefined && e.bodyMarkdown !== this.current.bodyMarkdown) ||
      (e.color !== undefined && e.color !== this.current.color) ||
      (e.tags !== undefined && !arraysEqual(e.tags, this.current.tags)) ||
      (e.publication !== undefined && e.publication !== this.current.publication)
    );
  }

  /**
   * Commit the pending edit to storage with optimistic concurrency. On success
   * the controller advances to the new revision and clears the draft. On a
   * revision conflict it keeps the draft and enters 'conflict' state.
   *
   * Commits are SERIALIZED: if one is already in flight (e.g. a checkbox change
   * and a textarea blur fire back-to-back), the next commit chains after it and
   * commits against the freshly-advanced revision — two of our own writes never
   * self-conflict. A conflict here therefore only ever reflects a genuine
   * external writer (another tab).
   */
  commit(): Promise<Annotation> {
    const run = (this.inflight ?? Promise.resolve()).catch(() => undefined).then(() =>
      this.commitOnce(),
    );
    // Track only successful settle for chaining; failures don't block the queue.
    this.inflight = run;
    void run.catch(() => undefined).finally(() => {
      if (this.inflight === run) this.inflight = null;
    });
    return run;
  }

  private async commitOnce(): Promise<Annotation> {
    if (this.draftTimer !== null) {
      this.timer.clear(this.draftTimer);
      this.draftTimer = null;
    }
    if (!this.hasPendingChanges()) {
      this.setState('saved');
      return this.current;
    }
    const base = this.current;
    // Snapshot the edit being committed and reset pendingEdit to a FRESH object,
    // so any edit that arrives during the `await` below (e.g. a checkbox change
    // firing while a textarea-blur commit is in flight) accumulates separately
    // and is NOT clobbered when this commit clears its own work.
    const editing = this.pendingEdit;
    this.pendingEdit = {};
    const next = nextAnnotationRevision(base, editing, nowIso());
    this.setState('saving');
    try {
      await saveAnnotation(next, base.revision);
      this.current = next;
      await clearDraft(next.id);
      // If new edits landed while we were saving, we're still dirty — the next
      // serialized commit will pick them up against this freshly-bumped revision.
      this.setState(this.hasPendingChanges() ? 'dirty' : 'saved');
      this.onCommitted?.(next);
      return next;
    } catch (err) {
      // Restore the attempted edit (under any newer edit) so it isn't lost.
      this.pendingEdit = { ...editing, ...this.pendingEdit };
      if (err instanceof RevisionConflictError) {
        // Preserve the user's text as a draft; do NOT overwrite the newer value.
        await this.flushDraft().catch(() => undefined);
        this.setState('conflict');
      } else {
        this.setState('error');
      }
      throw err;
    }
  }

  /**
   * Resolve a conflict by rebasing onto the latest stored value while keeping the
   * user's pending edit. The caller supplies the freshly loaded annotation.
   */
  rebaseOnto(latest: Annotation): void {
    this.current = latest;
    this.setState('dirty');
  }

  dispose(): void {
    if (this.draftTimer !== null) {
      this.timer.clear(this.draftTimer);
      this.draftTimer = null;
    }
  }
}

function arraysEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
