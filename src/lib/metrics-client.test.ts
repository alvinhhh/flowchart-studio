import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { METRIC_EVENTS, METRIC_STATE, type MetricsClientOptions } from './metrics-client';
import { IndexedDBDiagramRepository } from './repository';
import { exampleDiagram } from './diagram';

const dayOne = Date.parse('2026-11-03T10:00:00Z');
const success = () => Promise.resolve(new Response(null, { status: 204 }));
const setup = (options: MetricsClientOptions = {}) => {
  const factory = new IDBFactory();
  const send = vi.fn<typeof fetch>(success);
  const config = { enabled: () => true, privacyOptOut: () => false, now: () => dayOne, send, ...options };
  const first = new IndexedDBDiagramRepository('metrics', factory, config);
  const second = new IndexedDBDiagramRepository('metrics', factory, config);
  return { factory, first, second, send };
};

export async function metricRows(factory: IDBFactory, store: string): Promise<Record<string, unknown>[]> {
  return new Promise((resolve, reject) => {
    const opening = factory.open('metrics');
    opening.onerror = () => reject(opening.error);
    opening.onsuccess = () => {
      const db = opening.result;
      const tx = db.transaction(store, 'readonly');
      const request = tx.objectStore(store).getAll();
      tx.oncomplete = () => { db.close(); resolve(request.result); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  });
}

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('anonymous counter client', () => {
  it('counts a browser once across concurrent tabs, reloads and UTC day changes', async () => {
    let now = dayOne;
    const { first, second, send, factory } = setup({ now: () => now });
    await Promise.all([first.metrics.visit(), second.metrics.visit()]);
    // Concurrent delivery can retry the same receipt, but never create another.
    const ids = new Set(send.mock.calls.map(([, init]) => JSON.parse(init!.body as string).id));
    expect(ids.size).toBe(1);
    const count = send.mock.calls.length;
    now += 24 * 60 * 60 * 1000;
    await first.metrics.visit();
    await second.metrics.visit();
    expect(send).toHaveBeenCalledTimes(count);
    expect(await metricRows(factory, METRIC_STATE)).toEqual([{ key: 'visit', counted: true }]);
  });

  it('sends exactly the public event payload without document or browser context', async () => {
    const { first, send } = setup();
    await first.metrics.visit();
    const [url, init] = send.mock.calls[0];
    const body = JSON.parse(init!.body as string);
    expect(url).toBe('/api/metrics');
    expect(Object.keys(body).sort()).toEqual(['day', 'id', 'type']);
    expect(body).toEqual({ type: 'visit', day: '2026-11-03', id: expect.stringMatching(/^[0-9a-f-]{36}$/) });
    expect(init).toMatchObject({ credentials: 'omit', referrerPolicy: 'no-referrer', method: 'POST' });
    expect(init!.headers).toEqual({ 'Content-Type': 'application/json' });
  });

  it('keeps the same one-use receipt offline and retries after a reload', async () => {
    const send = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error('offline')).mockImplementation(success);
    const { first, second, factory } = setup({ send });
    await first.metrics.visit();
    const pending = await metricRows(factory, METRIC_EVENTS);
    expect(pending).toHaveLength(1);
    await second.metrics.visit();
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0][1]!.body).toBe(send.mock.calls[1][1]!.body);
    expect(await metricRows(factory, METRIC_EVENTS)).toEqual([]);
  });

  it('drains charts saved while the initial visit request is in flight', async () => {
    let started!: () => void;
    const sent = new Promise<void>(resolve => { started = resolve; });
    let finish!: (response: Response) => void;
    const send = vi.fn<typeof fetch>()
      .mockImplementationOnce(() => { started(); return new Promise(resolve => { finish = resolve; }); })
      .mockImplementation(success);
    const { first, factory } = setup({ send });
    const visit = first.metrics.visit();
    await sent;
    await first.save(exampleDiagram(), null);
    const flushing = first.metrics.flush();
    finish(new Response(null, { status: 204 }));
    await Promise.all([visit, flushing]);
    expect(send.mock.calls.map(([, init]) => JSON.parse(init!.body as string).type)).toEqual(['visit', 'chart_created']);
    expect(await metricRows(factory, METRIC_EVENTS)).toEqual([]);
  });

  it('does not immediately retry a failed request when a new save requests another drain', async () => {
    let started!: () => void;
    const sent = new Promise<void>(resolve => { started = resolve; });
    let fail!: (reason: Error) => void;
    const send = vi.fn<typeof fetch>(() => { started(); return new Promise((_, reject) => { fail = reject; }); });
    const { first, factory } = setup({ send });
    const visit = first.metrics.visit();
    await sent;
    await first.save(exampleDiagram(), null);
    fail(new Error('offline'));
    await visit;
    expect(send).toHaveBeenCalledTimes(1);
    expect(await metricRows(factory, METRIC_EVENTS)).toHaveLength(2);
  });

  it('drops expired receipts and never recounts the browser after expiry', async () => {
    let now = dayOne;
    const send = vi.fn<typeof fetch>().mockRejectedValue(new Error('offline'));
    const { first, factory } = setup({ send, now: () => now });
    await first.metrics.visit();
    now += 48 * 60 * 60 * 1000;
    await first.metrics.visit();
    expect(send).toHaveBeenCalledTimes(1);
    expect(await metricRows(factory, METRIC_EVENTS)).toEqual([]);
  });

  it('drops receipts older than yesterday even if their age is under 48 hours', async () => {
    let now = Date.parse('2026-11-03T23:59:00Z');
    const send = vi.fn<typeof fetch>().mockRejectedValue(new Error('offline'));
    const { first, factory } = setup({ send, now: () => now });
    await first.metrics.visit();
    now = Date.parse('2026-11-05T00:01:00Z');
    await first.metrics.flush();
    expect(send).toHaveBeenCalledTimes(1);
    expect(await metricRows(factory, METRIC_EVENTS)).toEqual([]);
  });

  it('bounds even a transport that ignores cancellation', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let started!: () => void;
    const sent = new Promise<void>(resolve => { started = resolve; });
    const send = vi.fn<typeof fetch>(() => { started(); return new Promise(() => {}); });
    const { first } = setup({ send });
    const visit = first.metrics.visit();
    await sent;
    await vi.advanceTimersByTimeAsync(4000);
    await visit;
    expect(send.mock.calls[0][1]!.signal!.aborted).toBe(true);
  });

  it.each([{ doNotTrack: '1' }, { doNotTrack: 'yes' }, { globalPrivacyControl: true }])('honors privacy signal %j', async (navigator) => {
    vi.stubGlobal('navigator', navigator);
    const { first, send } = setup({ privacyOptOut: undefined });
    await first.metrics.visit();
    expect(send).not.toHaveBeenCalled();
  });

  it('requires the explicit public environment flag', async () => {
    vi.stubEnv('NEXT_PUBLIC_METRICS_ENABLED', '0');
    const { first, send } = setup({ enabled: undefined });
    await first.metrics.visit();
    expect(send).not.toHaveBeenCalled();
    vi.stubEnv('NEXT_PUBLIC_METRICS_ENABLED', '1');
    await first.metrics.visit();
    expect(send).toHaveBeenCalledTimes(1);
  });
});
