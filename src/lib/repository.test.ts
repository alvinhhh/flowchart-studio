import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';
import { newDiagram } from './diagram';
import { ConflictError, IndexedDBDiagramRepository, StorageError } from './repository';

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
