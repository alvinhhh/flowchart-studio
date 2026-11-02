import { type Diagram, validateDiagram } from './diagram';

export interface DiagramRepository {
  list(): Promise<Diagram[]>;
  get(id: string): Promise<Diagram | undefined>;
  save(doc: Diagram, expectedRevision: number | null): Promise<Diagram>;
  delete(id: string, expectedRevision: number): Promise<void>;
}
export class ConflictError extends Error {
  constructor(message = 'This diagram changed in another tab or was deleted. Reload the saved version or save your work as a copy.') {
    super(message); this.name = 'ConflictError';
  }
}
export class StorageError extends Error {
  readonly cause: unknown;
  constructor(cause: unknown) {
    const name = cause && typeof cause === 'object' && 'name' in cause ? cause.name : '';
    super(name === 'QuotaExceededError'
      ? 'Browser storage is full. Export your diagram, then free space before saving again.'
      : 'Browser storage is unavailable. Your changes have not been saved. Export your diagram to keep a copy.');
    this.name = 'StorageError'; this.cause = cause;
  }
}
const storageError = (error: unknown): Error => error instanceof ConflictError || error instanceof StorageError ? error : new StorageError(error);
const DIAGRAMS = 'diagrams';
const DELETED = 'deletedDiagrams';

/** All comparisons and writes share a transaction, including deletion tombstones. */
export class IndexedDBDiagramRepository implements DiagramRepository {
  private database?: Promise<IDBDatabase>;
  constructor(private readonly dbName = 'flowchart-studio', private readonly factory?: IDBFactory) {}

  private open(): Promise<IDBDatabase> {
    if (this.database) return this.database;
    this.database = new Promise<IDBDatabase>((resolve, reject) => {
      const factory = this.factory ?? globalThis.indexedDB;
      if (!factory) { reject(new StorageError(new Error('IndexedDB is unavailable'))); return; }
      let request: IDBOpenDBRequest;
      try { request = factory.open(this.dbName, 1); } catch (error) { reject(storageError(error)); return; }
      let rejected = false;
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(DIAGRAMS)) db.createObjectStore(DIAGRAMS, { keyPath: 'documentId' });
        if (!db.objectStoreNames.contains(DELETED)) db.createObjectStore(DELETED, { keyPath: 'documentId' });
      };
      request.onsuccess = () => {
        const db = request.result;
        if (rejected) { db.close(); return; }
        db.onversionchange = () => { db.close(); this.database = undefined; };
        resolve(db);
      };
      request.onerror = () => reject(storageError(request.error));
      request.onblocked = () => { rejected = true; reject(new StorageError(new Error('Storage upgrade is blocked by another tab'))); };
    });
    this.database.catch(() => { this.database = undefined; });
    return this.database;
  }

  async list(): Promise<Diagram[]> {
    const rows = await this.read<unknown[]>(undefined);
    try { return rows.map(validateDiagram).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); }
    catch (error) { throw new StorageError(error); }
  }
  async get(id: string): Promise<Diagram | undefined> {
    const row = await this.read<unknown>(id);
    if (row === undefined) return undefined;
    try { return validateDiagram(row); } catch (error) { throw new StorageError(error); }
  }
  private async read<T>(id: string | undefined): Promise<T> {
    const db = await this.open();
    return new Promise<T>((resolve, reject) => {
      try {
        const tx = db.transaction(DIAGRAMS, 'readonly');
        const store = tx.objectStore(DIAGRAMS);
        const request = id === undefined ? store.getAll() : store.get(id);
        let result: T;
        request.onsuccess = () => { result = request.result as T; };
        tx.oncomplete = () => resolve(result);
        tx.onabort = () => reject(storageError(tx.error ?? request.error));
      } catch (error) { reject(storageError(error)); }
    });
  }

  async save(doc: Diagram, expectedRevision: number | null): Promise<Diagram> {
    const clean = validateDiagram(doc);
    if (expectedRevision !== null && (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || expectedRevision >= Number.MAX_SAFE_INTEGER)) {
      throw new ConflictError('The saved revision is invalid. Save this diagram as a copy.');
    }
    return this.mutate(clean.documentId, (store, _deleted, current, tombstone) => {
      if (expectedRevision === null ? current !== undefined || tombstone !== undefined : !current || current.revision !== expectedRevision) throw new ConflictError();
      const saved: Diagram = { ...clean, revision: (expectedRevision ?? 0) + 1, updatedAt: new Date().toISOString() };
      store.put(saved);
      return saved;
    });
  }
  async delete(id: string, expectedRevision: number): Promise<void> {
    await this.mutate(id, (store, deleted, current) => {
      if (!current || current.revision !== expectedRevision) throw new ConflictError();
      store.delete(id);
      deleted.put({ documentId: id, revision: current.revision + 1, deletedAt: new Date().toISOString() });
    });
  }
  private async mutate<T>(id: string, change: (store: IDBObjectStore, deleted: IDBObjectStore, current: Diagram | undefined, tombstone: unknown) => T): Promise<T> {
    const db = await this.open();
    return new Promise<T>((resolve, reject) => {
      let failure: unknown;
      try {
        const tx = db.transaction([DIAGRAMS, DELETED], 'readwrite');
        const store = tx.objectStore(DIAGRAMS);
        const deleted = tx.objectStore(DELETED);
        const currentRequest = store.get(id);
        const deletedRequest = deleted.get(id);
        let result: T;
        let remaining = 2;
        const ready = () => {
          remaining -= 1;
          if (remaining !== 0) return;
          try { result = change(store, deleted, currentRequest.result as Diagram | undefined, deletedRequest.result); }
          catch (error) { failure = error; tx.abort(); }
        };
        currentRequest.onsuccess = ready;
        deletedRequest.onsuccess = ready;
        tx.oncomplete = () => resolve(result);
        tx.onabort = () => reject(storageError(failure ?? tx.error));
      } catch (error) { reject(storageError(error)); }
    });
  }
}

export const diagramRepository: DiagramRepository = new IndexedDBDiagramRepository();
