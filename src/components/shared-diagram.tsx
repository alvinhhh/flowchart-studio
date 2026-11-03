'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { ArrowDownToLine, Maximize, Minus, Plus, Workflow } from 'lucide-react';
import { copyDiagram, freshId, type Diagram } from '@/lib/diagram';
import { diagramToSvg, downloadJson, exportBounds } from '@/lib/export';
import { loadSharedDiagram, ShareError } from '@/lib/sharing';
import './shared-diagram.css';

type Shared = { diagram: Diagram; expiresAt: string };
type Status = { kind: 'loading' } | { kind: 'ready'; shared: Shared } | { kind: 'error'; error: ShareError };
type Point = { x: number; y: number };
type View = Point & { zoom: number };
const expired = () => new ShareError('expired', 'This share link has expired. Ask the sender for a new link.');

export default function SharedDiagram() {
  const router = useRouter();
  const [status, setStatus] = useState<Status>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);
  const activeShared = useRef<Shared | null>(null);
  const savingCopy = useRef(false);

  useEffect(() => {
    let active = true;
    let controller = new AbortController();
    const load = async () => {
      controller.abort();
      controller = new AbortController();
      const signal = controller.signal;
      activeShared.current = null;
      setStatus({ kind: 'loading' }); setSaveError('');
      try {
        const shared = await loadSharedDiagram(window.location.hash, signal);
        if (!active || signal.aborted) return;
        activeShared.current = shared;
        setStatus({ kind: 'ready', shared });
      } catch (error) {
        if (!active || signal.aborted) return;
        setStatus({ kind: 'error', error: error instanceof ShareError ? error : new ShareError('network', 'The shared diagram could not be loaded. Check your connection and try again.') });
      }
    };
    void load();
    window.addEventListener('hashchange', load);
    return () => { active = false; controller.abort(); activeShared.current = null; window.removeEventListener('hashchange', load); };
  }, [attempt]);

  const shared = status.kind === 'ready' ? status.shared : null;
  useEffect(() => {
    if (!shared) return;
    let timer: ReturnType<typeof setTimeout>;
    const check = () => {
      clearTimeout(timer);
      const remaining = Date.parse(shared.expiresAt) - Date.now();
      if (remaining <= 0) {
        activeShared.current = null;
        setStatus({ kind: 'error', error: expired() });
        setSaveError('');
      } else timer = setTimeout(check, Math.min(remaining, 2_147_000_000));
    };
    check();
    document.addEventListener('visibilitychange', check);
    window.addEventListener('pageshow', check);
    return () => { clearTimeout(timer); document.removeEventListener('visibilitychange', check); window.removeEventListener('pageshow', check); };
  }, [shared]);

  function available(): Shared | null {
    const current = activeShared.current;
    if (current && Date.parse(current.expiresAt) > Date.now()) return current;
    activeShared.current = null;
    setStatus({ kind: 'error', error: expired() });
    return null;
  }
  async function saveCopy() {
    const current = available();
    if (!current || savingCopy.current) return;
    savingCopy.current = true; setSaving(true); setSaveError('');
    try {
      const { diagramRepository } = await import('@/lib/repository');
      if (activeShared.current !== current || Date.parse(current.expiresAt) <= Date.now()) { available(); return; }
      const now = new Date().toISOString();
      const copy = copyDiagram(current.diagram);
      const groups = new Map<string, string>();
      for (const node of copy.nodes) {
        if (node.groupId) {
          if (!groups.has(node.groupId)) groups.set(node.groupId, freshId());
          node.groupId = groups.get(node.groupId);
        }
      }
      const saved = await diagramRepository.save({ ...copy, createdAt: now, updatedAt: now, revision: 0 }, null);
      try { localStorage.setItem('flowchart:last-document', saved.documentId); }
      catch { setSaveError('The copy was saved. Open the editor and choose it from Documents.'); return; }
      router.push('/app');
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'The copy could not be saved. Download JSON to keep a file.');
    } finally { savingCopy.current = false; setSaving(false); }
  }
  function download() {
    const current = available();
    if (!current) return;
    try { downloadJson(current.diagram); }
    catch { setSaveError('The download could not be started. Try again.'); }
  }

  return <main className="shared-shell">
    <header className="shared-header">
      <Link href="/" className="shared-brand" aria-label="flowchart.lol home"><Workflow size={22} aria-hidden="true" /><span>flowchart.lol</span></Link>
      {shared && <div className="shared-heading"><h1>{shared.diagram.title || 'Untitled diagram'}</h1><span>Read-only snapshot</span></div>}
      <div className="shared-actions">
        {shared && <><button type="button" className="shared-button" onClick={download}><ArrowDownToLine size={15} aria-hidden="true" />Download JSON</button><button type="button" className="shared-button shared-primary" disabled={saving} onClick={() => void saveCopy()}>{saving ? 'Saving…' : 'Save a copy'}</button></>}
        {!shared && <Link href="/app" className="shared-button">Open editor</Link>}
      </div>
    </header>
    {saveError && <p className="shared-notice" role="alert">{saveError}</p>}
    {status.kind === 'loading' && <div className="shared-message" role="status" aria-live="polite"><p>Opening shared diagram…</p></div>}
    {status.kind === 'error' && <div className="shared-message" role="alert"><h1>{status.error.code === 'expired' ? 'Link unavailable' : status.error.code === 'invalid-link' ? 'Invalid link' : 'Unable to open diagram'}</h1><p>{status.error.message}</p>{['network', 'service', 'expired'].includes(status.error.code) && <button type="button" className="shared-button" onClick={() => setAttempt(value => value + 1)}>Try again</button>}</div>}
    {shared && <><ReadonlyCanvas diagram={shared.diagram} /><footer className="shared-footer"><p>Link expires <time dateTime={shared.expiresAt}>{new Date(shared.expiresAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</time>. Save a copy or download JSON to keep it.</p><Link href="/privacy" referrerPolicy="no-referrer">Privacy</Link></footer></>}
  </main>;
}

function ReadonlyCanvas({ diagram }: { diagram: Diagram }) {
  const canvas = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, Point>());
  const viewport = useRef<View>({ x: 0, y: 0, zoom: 1 });
  const [view, setView] = useState<View>({ x: 0, y: 0, zoom: 1 });
  const scene = useMemo(() => ({ bounds: exportBounds(diagram), source: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(diagramToSvg(diagram))}` }), [diagram]);
  const update = useCallback((next: View) => { viewport.current = next; setView(next); }, []);
  const fit = useCallback(() => {
    const element = canvas.current;
    if (!element) return;
    const zoom = Math.min(1.5, Math.max(0.001, Math.min((element.clientWidth - 32) / scene.bounds.width, (element.clientHeight - 32) / scene.bounds.height)));
    update({ x: (element.clientWidth - scene.bounds.width * zoom) / 2, y: (element.clientHeight - scene.bounds.height * zoom) / 2, zoom });
  }, [scene, update]);
  const zoomAt = useCallback((factor: number, point?: Point) => {
    const element = canvas.current;
    if (!element) return;
    const anchor = point ?? { x: element.clientWidth / 2, y: element.clientHeight / 2 };
    const current = viewport.current, zoom = Math.max(0.001, Math.min(4, current.zoom * factor)), ratio = zoom / current.zoom;
    update({ x: anchor.x - (anchor.x - current.x) * ratio, y: anchor.y - (anchor.y - current.y) * ratio, zoom });
  }, [update]);
  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      zoomAt(Math.exp(-Math.max(-200, Math.min(200, event.deltaY)) * 0.003), { x: event.clientX - rect.left, y: event.clientY - rect.top });
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => { observer.disconnect(); element.removeEventListener('wheel', wheel); };
  }, [fit, zoomAt]);
  function point(event: PointerEvent): Point {
    const rect = canvas.current!.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }
  function move(event: PointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(event.pointerId)) return;
    event.preventDefault();
    const before = [...pointers.current.values()];
    pointers.current.set(event.pointerId, point(event));
    const after = [...pointers.current.values()];
    const current = viewport.current;
    if (before.length === 1) update({ ...current, x: current.x + after[0].x - before[0].x, y: current.y + after[0].y - before[0].y });
    else {
      const center = (points: Point[]) => ({ x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 });
      const distance = (points: Point[]) => Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
      const a = center(before), b = center(after), ratio = distance(after) / Math.max(1, distance(before));
      const zoom = Math.max(0.001, Math.min(4, current.zoom * ratio)), scale = zoom / current.zoom;
      update({ x: b.x - (a.x - current.x) * scale, y: b.y - (a.y - current.y) * scale, zoom });
    }
  }
  function end(event: PointerEvent<HTMLDivElement>) {
    pointers.current.delete(event.pointerId);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  return <section className="shared-canvas-region" aria-label="Shared diagram">
    <div ref={canvas} className="shared-canvas" tabIndex={0} role="img" aria-label={`${diagram.title || 'Untitled diagram'}. ${diagram.nodes.length} shapes and ${diagram.edges.length} connections. Drag to pan. Use plus and minus to zoom, or zero to fit.`}
      onKeyDown={event => {
        if (['+', '=', '-', '0', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) event.preventDefault();
        if (event.key === '+' || event.key === '=') zoomAt(1.25);
        else if (event.key === '-') zoomAt(0.8);
        else if (event.key === '0') fit();
        else if (event.key.startsWith('Arrow')) update({ ...viewport.current, x: viewport.current.x + (event.key === 'ArrowLeft' ? 40 : event.key === 'ArrowRight' ? -40 : 0), y: viewport.current.y + (event.key === 'ArrowUp' ? 40 : event.key === 'ArrowDown' ? -40 : 0) });
      }}
      onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); pointers.current.set(event.pointerId, point(event)); event.currentTarget.setPointerCapture(event.pointerId); }}
      onPointerMove={move} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={event => pointers.current.delete(event.pointerId)}>
      {/* The exported SVG is self-contained and uses the same shapes, routes, and drawings as downloads. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={scene.source} alt="" draggable={false} width={scene.bounds.width} height={scene.bounds.height} style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }} />
    </div>
    <div className="shared-canvas-controls" role="group" aria-label="Canvas controls"><button type="button" aria-label="Zoom out" onClick={() => zoomAt(0.8)}><Minus size={17} /></button><output aria-label="Zoom level">{Math.round(view.zoom * 100)}%</output><button type="button" aria-label="Zoom in" onClick={() => zoomAt(1.25)}><Plus size={17} /></button><button type="button" aria-label="Fit diagram" onClick={fit}><Maximize size={17} /></button></div>
    {!diagram.nodes.length && !diagram.drawings.length && <p className="shared-empty">This diagram is empty.</p>}
  </section>;
}
