'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { copyDiagram, exampleDiagram, newDiagram, type Diagram } from './diagram';
import { commitHistory, createHistory, redoHistory, undoHistory, type History } from './history';
import { ConflictError, diagramRepository } from './repository';

type SaveState = 'saving' | 'saved' | 'error' | 'conflict';
const message = (e: unknown) => e instanceof Error ? e.message : 'The diagram could not be saved. Download a JSON backup.';
export function useDocuments(example: boolean) {
  const [history, setHistory] = useState<History | null>(null);
  const [documents, setDocuments] = useState<Diagram[]>([]);
  const [status, setStatus] = useState<SaveState>('saving');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const operation = useRef(false);
  const current = useRef<History | null>(null);
  const revision = useRef<number | null>(null);
  const sequence = useRef(0);
  const savedSequence = useRef(-1);
  const failedSequence = useRef<number | null>(null);
  const inflight = useRef<Promise<boolean> | null>(null);
  const conflict = useRef(false);
  const channel = useRef<BroadcastChannel | null>(null);

  const refresh = useCallback(async () => { setDocuments(await diagramRepository.list()); }, []);
  const remember = (id: string) => { try { localStorage.setItem('flowchart:last-document', id); } catch { /* Preferences are optional. */ } };
  const install = useCallback((doc: Diagram, saved: boolean) => {
    const next = createHistory(doc);
    current.current = next; setHistory(next);
    revision.current = saved ? doc.revision : null;
    sequence.current = 0; savedSequence.current = saved ? 0 : -1;
    failedSequence.current = null;
    conflict.current = false; setError(''); setStatus(saved ? 'saved' : 'saving');
    remember(doc.documentId);
  }, []);

  const save = useCallback(async (): Promise<boolean> => {
    if (inflight.current) return inflight.current;
    if (!current.current || conflict.current) return false;
    const run = async () => {
      let attemptedSequence = sequence.current;
      try {
        while (savedSequence.current !== sequence.current) {
          if (conflict.current) return false;
          const snapshot = current.current!.present;
          const seq = sequence.current;
          attemptedSequence = seq;
          setStatus('saving');
          const saved = await diagramRepository.save(snapshot, revision.current);
          if (current.current?.present.documentId !== snapshot.documentId) return false;
          revision.current = saved.revision;
          savedSequence.current = seq;
          failedSequence.current = null;
          const next = { ...current.current!, present: { ...current.current!.present, revision: saved.revision, updatedAt: saved.updatedAt } };
          current.current = next; setHistory(next);
          try { channel.current?.postMessage({ documentId: saved.documentId, revision: saved.revision }); } catch { /* Storage is authoritative if tab notifications are unavailable. */ }
        }
        if (conflict.current) return false;
        setStatus('saved'); setError('');
        void refresh().catch(() => { /* A completed write remains saved even if listing fails. */ });
        return true;
      } catch (e) {
        failedSequence.current = attemptedSequence;
        const stale = e instanceof ConflictError || conflict.current;
        conflict.current = stale; setStatus(stale ? 'conflict' : 'error');
        setError(stale ? 'This diagram changed in another tab. This copy is read-only. Save a separate copy or download JSON to keep these edits.' : `${message(e)} Download JSON to keep a backup.`);
        return false;
      }
    };
    inflight.current = run();
    try { return await inflight.current; } finally { inflight.current = null; }
  }, [refresh]);

  useEffect(() => {
    let active = true;
    const open = async () => {
      try {
        const docs = await diagramRepository.list();
        if (!active) return;
        setDocuments(docs);
        let last: string | null = null;
        try { last = localStorage.getItem('flowchart:last-document'); } catch { /* Optional preference. */ }
        const found = docs.find(d => d.documentId === last) ?? docs[0];
        install(example ? exampleDiagram() : found ?? newDiagram(), !example && !!found);
      } catch (e) {
        if (!active) return;
        install(example ? exampleDiagram() : newDiagram(), false);
        failedSequence.current = sequence.current;
        setStatus('error'); setError(`${message(e)} Editing and JSON downloads remain available.`);
      }
    };
    void open();
    return () => { active = false; };
  }, [example, install]);

  useEffect(() => {
    if (!history || busy || conflict.current || savedSequence.current === sequence.current || failedSequence.current === sequence.current) return;
    const timer = setTimeout(() => {
      if (!operation.current && !conflict.current && failedSequence.current !== sequence.current) void save();
    }, 300);
    return () => clearTimeout(timer);
  }, [history, busy, save]);

  useEffect(() => {
    if (typeof BroadcastChannel !== 'undefined') {
      const bus = new BroadcastChannel('flowchart-studio-documents');
      channel.current = bus;
      bus.onmessage = (event: MessageEvent<{documentId: string; revision?: number}>) => {
        const data = event.data;
        if (current.current?.present.documentId === data.documentId && data.revision !== revision.current) {
          conflict.current = true; setStatus('conflict');
          setError('This diagram changed in another tab. This copy is read-only. Save a separate copy or download JSON to keep these edits.');
        }
        void refresh().catch(() => {});
      };
    }
    const hidden = () => { if (document.visibilityState === 'hidden' && !operation.current && failedSequence.current !== sequence.current) void save(); };
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (current.current && savedSequence.current !== sequence.current) { event.preventDefault(); event.returnValue = ''; }
    };
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('beforeunload', beforeUnload);
    return () => { channel.current?.close(); channel.current = null; document.removeEventListener('visibilitychange', hidden); window.removeEventListener('beforeunload', beforeUnload); };
  }, [refresh, save]);

  const change = useCallback((next: Diagram, record = true) => {
    if (!current.current || conflict.current || operation.current || next.documentId !== current.current.present.documentId) return;
    const present = { ...next, revision: current.current.present.revision, updatedAt: current.current.present.updatedAt };
    if (JSON.stringify(present) === JSON.stringify(current.current.present)) return;
    const state = record ? commitHistory(current.current, present) : { ...current.current, present };
    if (state === current.current) return;
    current.current = state; setHistory(state); sequence.current++; setStatus('saving');
  }, []);
  const undo = useCallback(() => {
    if (!current.current || conflict.current || operation.current) return;
    const next = undoHistory(current.current);
    if (next === current.current) return;
    current.current = next; setHistory(next); sequence.current++; setStatus('saving');
  }, []);
  const redo = useCallback(() => {
    if (!current.current || conflict.current || operation.current) return;
    const next = redoHistory(current.current);
    if (next === current.current) return;
    current.current = next; setHistory(next); sequence.current++; setStatus('saving');
  }, []);
  const beginOperation = () => {
    if (operation.current) return false;
    operation.current = true; setBusy(true); return true;
  };
  const endOperation = () => { operation.current = false; setBusy(false); };
  const flushCurrent = async () => {
    if (inflight.current) await inflight.current;
    return savedSequence.current === sequence.current || await save();
  };
  const switchTo = async (id: string) => {
    if (id === current.current?.present.documentId || !beginOperation()) return;
    try {
      if (!(await flushCurrent())) return;
      const doc = await diagramRepository.get(id);
      if (!doc) throw new Error('This diagram was deleted in another tab.');
      install(doc, true);
    } catch (e) { setError(message(e)); } finally { endOperation(); }
  };
  const add = async (doc: Diagram, preserveCurrent = true) => {
    if (!beginOperation()) return;
    try {
      if (preserveCurrent && !(await flushCurrent())) return;
      if (inflight.current) await inflight.current;
      install(doc, false);
      await save();
    } catch (e) { setError(message(e)); } finally { endOperation(); }
  };
  const saveCopy = async () => {
    if (!current.current || !beginOperation()) return;
    try {
      if (inflight.current) await inflight.current;
      const doc = current.current.present;
      install(copyDiagram(doc, `${doc.title.slice(0, 190)} copy`), false);
      await save();
    } catch (e) { setError(message(e)); } finally { endOperation(); }
  };
  const remove = async () => {
    if (!current.current || !beginOperation()) return;
    try {
      if (!(await flushCurrent()) || conflict.current) return;
      const doc = current.current.present;
      await diagramRepository.delete(doc.documentId, revision.current!);
      install(newDiagram(), false);
      setDocuments(previous => previous.filter(item => item.documentId !== doc.documentId));
      try { channel.current?.postMessage({ documentId: doc.documentId, revision: -1 }); } catch { /* The deletion has already completed. */ }
      const docs = await diagramRepository.list();
      setDocuments(docs); install(docs[0] ?? newDiagram(), !!docs.length);
    } catch (e) {
      if (e instanceof ConflictError) { conflict.current = true; setStatus('conflict'); }
      else if (savedSequence.current !== sequence.current) { failedSequence.current = sequence.current; setStatus('error'); }
      setError(message(e));
    } finally { endOperation(); }
  };
  return { doc: history?.present ?? null, documents, status, error, setError, busy, readonly: status === 'conflict', change, undo, redo, canUndo: !!history?.past.length, canRedo: !!history?.future.length, switchTo, add, save, saveCopy, remove, current };
}
