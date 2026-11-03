export const METRIC_STATE = 'metricState';
export const METRIC_EVENTS = 'metricEvents';
const MAX_AGE_MS = 48 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 4000;

type MetricEvent = { type: 'visit' | 'chart_created'; id: string; day: string };
type QueuedEvent = MetricEvent & { queuedAt: number };
type MetricState = { key: string; counted: boolean };

export interface MetricsClientOptions {
  enabled?: () => boolean;
  privacyOptOut?: () => boolean;
  now?: () => number;
  uuid?: () => string;
  send?: typeof fetch;
}

function privacyOptOut(): boolean {
  if (typeof navigator === 'undefined') return false;
  return navigator.doNotTrack === '1' || navigator.doNotTrack === 'yes'
    || (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true;
}

/** Existing documents have no eligible marker and remain excluded. */
export function upgradeMetricStores(db: IDBDatabase): void {
  db.createObjectStore(METRIC_STATE, { keyPath: 'key' });
  db.createObjectStore(METRIC_EVENTS, { keyPath: 'id' });
}

/** Anonymous event IDs are independent of document IDs and browser identity. */
export class MetricsClient {
  private flushing?: Promise<void>;
  private flushRequested = false;
  constructor(private readonly open: () => Promise<IDBDatabase>, private readonly options: MetricsClientOptions = {}) {}

  private allowed(): boolean {
    return (this.options.enabled?.() ?? process.env.NEXT_PUBLIC_METRICS_ENABLED === '1')
      && !(this.options.privacyOptOut ?? privacyOptOut)();
  }
  private now(): number { return (this.options.now ?? Date.now)(); }
  private event(type: MetricEvent['type']): QueuedEvent {
    const queuedAt = this.now();
    return { type, id: (this.options.uuid ?? (() => crypto.randomUUID()))(), day: new Date(queuedAt).toISOString().slice(0, 10), queuedAt };
  }

  /** Runs in the document transaction: failed saves cannot enqueue events. */
  recordChartSave(tx: IDBTransaction, documentId: string, isNew: boolean, nonempty: boolean): void {
    const state = tx.objectStore(METRIC_STATE);
    const key = `chart:${documentId}`;
    const request = state.get(key);
    request.onsuccess = () => {
      try {
        const previous = request.result as MetricState | undefined;
        if (previous?.counted || (!previous && !isNew)) return;
        if (!this.allowed()) { state.put({ key, counted: true } satisfies MetricState); return; }
        if (!nonempty) { state.put({ key, counted: false } satisfies MetricState); return; }
        tx.objectStore(METRIC_EVENTS).put(this.event('chart_created'));
        state.put({ key, counted: true } satisfies MetricState);
      } catch { tx.abort(); }
    };
  }

  async visit(): Promise<void> {
    try {
      if (!this.allowed()) return;
      const db = await this.open();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction([METRIC_STATE, METRIC_EVENTS], 'readwrite');
        const state = tx.objectStore(METRIC_STATE);
        const request = state.get('visit');
        request.onsuccess = () => {
          try {
            if (!this.allowed()) return;
            if ((request.result as MetricState | undefined)?.counted) return;
            const event = this.event('visit');
            tx.objectStore(METRIC_EVENTS).put(event);
            state.put({ key: 'visit', counted: true } satisfies MetricState);
          } catch { tx.abort(); }
        };
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error);
      });
      await this.flush();
    } catch { /* Counters never interrupt editing or navigation. */ }
  }

  flush(): Promise<void> {
    if (this.flushing) { this.flushRequested = true; return this.flushing; }
    this.flushing = this.drainQueue().catch(() => {}).finally(() => { this.flushing = undefined; });
    return this.flushing;
  }

  private async drainQueue(): Promise<void> {
    // Include events saved while a request was in flight, without a retry loop
    // when the network fails or a continually active editor keeps adding work.
    for (let pass = 0; pass < 3; pass++) {
      this.flushRequested = false;
      if (!await this.flushQueue() || !this.flushRequested) return;
    }
  }

  private async flushQueue(): Promise<boolean> {
    if (!this.allowed()) return false;
    const db = await this.open();
    const events = await new Promise<QueuedEvent[]>((resolve, reject) => {
      const tx = db.transaction(METRIC_EVENTS, 'readonly');
      const request = tx.objectStore(METRIC_EVENTS).getAll();
      tx.oncomplete = () => resolve(request.result as QueuedEvent[]);
      tx.onabort = () => reject(tx.error);
    });
    for (const event of events) {
      if (!this.allowed()) return false;
      const now = this.now();
      const today = new Date(now).toISOString().slice(0, 10);
      const yesterday = new Date(now - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      if (now - event.queuedAt >= MAX_AGE_MS || (event.day !== today && event.day !== yesterday)) {
        await this.remove(db, event.id);
        continue;
      }
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const timeout = new Promise<never>((_, reject) => {
          timer = setTimeout(() => { controller.abort(); reject(new Error('Counter request timed out')); }, REQUEST_TIMEOUT_MS);
        });
        const response = await Promise.race([
          (this.options.send ?? fetch)('/api/metrics', {
            method: 'POST', credentials: 'omit', referrerPolicy: 'no-referrer',
            headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
            body: JSON.stringify({ type: event.type, id: event.id, day: event.day } satisfies MetricEvent),
          }), timeout,
        ]);
        if (response.ok || response.status === 400) await this.remove(db, event.id);
        else return false;
      } catch { return false; }
      finally { if (timer !== undefined) clearTimeout(timer); }
    }
    return true;
  }

  private remove(db: IDBDatabase, id: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(METRIC_EVENTS, 'readwrite');
      tx.objectStore(METRIC_EVENTS).delete(id);
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
    });
  }
}
