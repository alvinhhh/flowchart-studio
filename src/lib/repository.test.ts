import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';
import { copyDiagram, createNode, exampleDiagram, newDiagram, serializeDiagram } from './diagram';
import { ConflictError, IndexedDBDiagramRepository, StorageError } from './repository';
import { METRIC_EVENTS, METRIC_STATE, type MetricsClientOptions } from './metrics-client';

const setup = () => {
  const factory = new IDBFactory();
  return { factory, first: new IndexedDBDiagramRepository('test', factory), second: new IndexedDBDiagramRepository('test', factory) };
};
describe('local diagram repository', () => {
  it('saves and loads independent portable snapshots with revision increments', async () => {
    const { first, second } = setup();
    const doc = newDiagram('First');
    const saved = await first.save(doc, null);
    expect(saved.revision).toBe(1);
    expect(doc.revision).toBe(0);
    expect(await second.get(doc.documentId)).toEqual(saved);
    saved.title = 'Local mutation';
    expect((await first.get(doc.documentId))?.title).toBe('First');
    const next = await first.save(saved, 1);
    expect(next.revision).toBe(2);
    expect(await first.list()).toEqual([next]);
  });
  it('allows only one concurrent write at a revision and leaves the winner intact', async () => {
    const { first, second } = setup();
    const saved = await first.save(newDiagram(), null);
    const outcomes = await Promise.allSettled([first.save({ ...saved, title: 'A' }, 1), second.save({ ...saved, title: 'B' }, 1)]);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    const rejected = outcomes.find((outcome) => outcome.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(ConflictError);
    const winner = outcomes.find((outcome) => outcome.status === 'fulfilled') as PromiseFulfilledResult<typeof saved>;
    expect(await first.get(saved.documentId)).toEqual(winner.value);
    await expect(first.save(saved, null)).rejects.toBeInstanceOf(ConflictError);
  });
  it('rejects stale deletes and prevents recreation after deletion across tabs', async () => {
    const { first, second } = setup();
    const saved = await first.save(newDiagram(), null);
    await expect(second.delete(saved.documentId, 0)).rejects.toBeInstanceOf(ConflictError);
    expect(await first.get(saved.documentId)).toEqual(saved);
    await second.delete(saved.documentId, 1);
    expect(await first.get(saved.documentId)).toBeUndefined();
    expect(await first.list()).toEqual([]);
    await expect(first.save(saved, 1)).rejects.toBeInstanceOf(ConflictError);
    await expect(first.save(saved, null)).rejects.toBeInstanceOf(ConflictError);
    await expect(first.delete(saved.documentId, 1)).rejects.toBeInstanceOf(ConflictError);
  });
  it('reports unavailable storage and quota failure without claiming a save', async () => {
    const unavailable = { open: () => { throw new DOMException('Denied', 'SecurityError'); } } as unknown as IDBFactory;
    await expect(new IndexedDBDiagramRepository('bad', unavailable).save(newDiagram(), null)).rejects.toBeInstanceOf(StorageError);
    const { first } = setup();
    const original = await first.save(newDiagram('Saved'), null);
    const request = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => { throw new DOMException('Full', 'QuotaExceededError'); });
    try { await expect(first.save({ ...original, title: 'Unsaved' }, 1)).rejects.toThrow(/storage is full/); }
    finally { request.mockRestore(); }
    expect(await first.get(original.documentId)).toEqual(original);
  });
});

describe('chart creation counters', () => {
  const setupMetrics = (overrides: MetricsClientOptions = {}) => {
    const factory = new IDBFactory();
    const send = vi.fn<typeof fetch>(() => Promise.resolve(new Response(null, { status: 204 })));
    const options = { enabled: () => true, privacyOptOut: () => false, send, ...overrides };
    return { factory, send, first: new IndexedDBDiagramRepository('metrics', factory, options), second: new IndexedDBDiagramRepository('metrics', factory, options) };
  };
  const events = (send: ReturnType<typeof vi.fn<typeof fetch>>) => send.mock.calls.map(([, init]) => JSON.parse(init!.body as string));

  it('counts a blank document only on its first persisted content, without altering exports', async () => {
    const { first, second, send } = setupMetrics();
    const blank = await first.save(newDiagram('Private title'), null);
    await first.metrics.flush();
    expect(send).not.toHaveBeenCalled();
    const content = await second.save({ ...blank, nodes: [createNode('process', { x: 0, y: 0 })] }, blank.revision);
    await second.metrics.flush();
    const undone = await first.save({ ...content, nodes: [] }, content.revision);
    await second.save({ ...undone, nodes: content.nodes }, undone.revision);
    await first.get(content.documentId);
    await first.list();
    await Promise.all([first.metrics.flush(), second.metrics.flush()]);
    expect(events(send)).toHaveLength(1);
    expect(events(send)[0]).toEqual({ type: 'chart_created', id: expect.any(String), day: expect.any(String) });
    expect(events(send)[0].id).not.toBe(content.documentId);
    expect(send.mock.calls[0][1]!.body).not.toContain('Private title');
    expect(JSON.parse(serializeDiagram(content))).toEqual(content);
    expect(Object.keys(content)).not.toContain(METRIC_STATE);
  });

  it('counts imported copies, examples and drawing-only documents as independent new charts', async () => {
    const { first, send } = setupMetrics();
    const example = exampleDiagram();
    await first.save(example, null);
    await first.metrics.flush();
    await first.save(copyDiagram(example), null);
    await first.metrics.flush();
    const drawing = { ...newDiagram(), drawings: [{ id: crypto.randomUUID(), color: 'neutral' as const, width: 2, points: [{ x: 1, y: 1, pressure: 0.5 }] }] };
    await first.save(drawing, null);
    await first.metrics.flush();
    expect(events(send)).toHaveLength(3);
    expect(new Set(events(send).map(event => event.id)).size).toBe(3);
  });

  it('counts only the winning first-content save across tabs', async () => {
    const { first, second, send } = setupMetrics();
    const blank = await first.save(newDiagram(), null);
    const doc = { ...blank, nodes: [createNode('process', { x: 0, y: 0 })] };
    const results = await Promise.allSettled([first.save(doc, 1), second.save(doc, 1)]);
    await Promise.all([first.metrics.flush(), second.metrics.flush()]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    // Delivery races can resend a receipt; the server deduplicates that ID.
    expect(new Set(events(send).map(event => event.id)).size).toBe(1);
  });

  it('never enqueues a chart whose content write fails', async () => {
    const { first, send } = setupMetrics();
    await first.list();
    const originalPut = IDBObjectStore.prototype.put;
    const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
      if (this.name === 'diagrams') throw new DOMException('Full', 'QuotaExceededError');
      return originalPut.apply(this, args);
    });
    try { await expect(first.save(exampleDiagram(), null)).rejects.toBeInstanceOf(StorageError); }
    finally { put.mockRestore(); }
    await first.metrics.flush();
    expect(send).not.toHaveBeenCalled();
    expect(await first.list()).toEqual([]);
  });

  it('preserves local saving if metric bookkeeping fails', async () => {
    const { first, send } = setupMetrics();
    await first.list();
    const originalPut = IDBObjectStore.prototype.put;
    const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
      if (this.name === METRIC_EVENTS) throw new DOMException('Full', 'QuotaExceededError');
      return originalPut.apply(this, args);
    });
    let saved;
    try { saved = await first.save(exampleDiagram(), null); }
    finally { put.mockRestore(); }
    expect(await first.get(saved.documentId)).toEqual(saved);
    await first.metrics.flush();
    expect(send).not.toHaveBeenCalled();
  });

  it('does not wait for the network to finish saving', async () => {
    let started!: () => void;
    const sent = new Promise<void>(resolve => { started = resolve; });
    let finish!: (response: Response) => void;
    const send = vi.fn<typeof fetch>(() => { started(); return new Promise(resolve => { finish = resolve; }); });
    const { first } = setupMetrics({ send });
    const saved = await first.save(exampleDiagram(), null);
    await sent;
    expect(saved.revision).toBe(1);
    expect(await first.get(saved.documentId)).toEqual(saved);
    finish(new Response(null, { status: 204 }));
    await first.metrics.flush();
  });

  it('keeps old documents readable and excluded during upgrade even if metric writes fail', async () => {
    const { factory, first, send } = setupMetrics();
    const old = exampleDiagram();
    const blank = newDiagram();
    await new Promise<void>((resolve, reject) => {
      const request = factory.open('metrics', 1);
      request.onupgradeneeded = () => {
        const diagrams = request.result.createObjectStore('diagrams', { keyPath: 'documentId' });
        request.result.createObjectStore('deletedDiagrams', { keyPath: 'documentId' });
        diagrams.put(old); diagrams.put(blank);
      };
      request.onsuccess = () => { request.result.close(); resolve(); };
      request.onerror = () => reject(request.error);
    });
    const originalPut = IDBObjectStore.prototype.put;
    const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
      if (this.name === METRIC_STATE) throw new DOMException('Full', 'QuotaExceededError');
      return originalPut.apply(this, args);
    });
    try {
      expect(await first.get(old.documentId)).toEqual(old);
      expect(await first.get(blank.documentId)).toEqual(blank);
      expect(await first.list()).toHaveLength(2);
      await first.save(old, 0);
      await first.save({ ...blank, nodes: [createNode('process', { x: 0, y: 0 })] }, 0);
      await first.metrics.flush();
    } finally { put.mockRestore(); }
    expect(send).not.toHaveBeenCalled();
    await first.save(exampleDiagram(), null);
    await first.metrics.flush();
    expect(send).toHaveBeenCalledTimes(1);
  });
});
