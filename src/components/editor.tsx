'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ReactFlow, ReactFlowProvider, Background, BackgroundVariant, ConnectionMode, MarkerType, Panel, SelectionMode, applyNodeChanges, useReactFlow, type Connection, type Edge, type NodeChange, type Viewport } from '@xyflow/react';
import { ArrowDownToLine, ArrowUpFromLine, Check, CircleHelp, Copy, Diamond, FilePlus2, Files, Grid2X2, Link2, Maximize, Minus, MousePointer2, Plus, Redo2, Shapes, Trash2, Undo2, X } from 'lucide-react';
import '@xyflow/react/dist/style.css';
import './editor.css';
import { COLOR_LABELS, COLORS, HANDLES, NODE_TYPES, NODE_TYPE_LABELS, createNode, duplicateSelection, exampleDiagram, freshId, newDiagram, parseDiagram, type Diagram, type DiagramEdge, type DiagramNode, type HandleId, type NodeKind } from '@/lib/diagram';
import { PRODUCT } from '@/lib/config';
import { colorValues, nodePath, wrapLabel } from '@/lib/geometry';
import { downloadJson, downloadPng } from '@/lib/export';
import { useDocuments } from '@/lib/use-documents';
import { RoutedEdge, ShapeNode, type FlowNode } from './diagram-elements';
import Modal from './modal';

const nodeTypes = { shape: ShapeNode };
const edgeTypes = { routed: RoutedEdge };
const SHAPE_DRAG_TYPE = 'application/x-flowchart-studio-shape';
function portableNode(n: DiagramNode, selected = false): FlowNode { return { id: n.id, type: 'shape', position: n.position, width: n.width, height: n.height, data: { model: n }, selected, ariaLabel: `${NODE_TYPE_LABELS[n.type]}: ${n.label || 'Untitled'}` }; }
function growLabel(node: DiagramNode, label: string): DiagramNode {
  let width = node.width;
  let lines = wrapLabel(label, node.type === 'decision' ? width * .55 : width - 32);
  while (lines.length * 20 > (node.type === 'decision' ? 940 : 1900) && width < 1800) { width += 100; lines = wrapLabel(label, node.type === 'decision' ? width * .55 : width - 32); }
  return { ...node, label, width, height: Math.min(2000, Math.max(node.height, lines.length * 20 * (node.type === 'decision' ? 2 : 1) + 36)) };
}
function textFocus(target: EventTarget | null) { return target instanceof HTMLElement && (!!target.closest('input,textarea,select,[contenteditable="true"],[role="dialog"],dialog')); }

export default function Editor() { return <ReactFlowProvider><Workspace /></ReactFlowProvider>; }
function Workspace() {
  const search = useSearchParams();
  const [openExample] = useState(() => search.get('example') === '1');
  const store = useDocuments(openExample);
  const { doc } = store;
  const flow = useReactFlow<FlowNode>();
  const [flowNodes, setFlowNodes] = useState<FlowNode[]>([]);
  const [selectedNodes, setSelectedNodes] = useState<string[]>([]);
  const [selectedEdges, setSelectedEdges] = useState<string[]>([]);
  const [modal, setModal] = useState<'documents' | 'help' | 'connection' | 'delete' | null>(null);
  const [palette, setPalette] = useState(false);
  const [dropReady, setDropReady] = useState(false);
  const paletteDrag = useRef<{ kind: NodeKind; documentId: string } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState('');
  const [zoom, setZoom] = useState(1);
  const [connectionDraft, setConnectionDraft] = useState({ source: '', target: '', sourceHandle: 'bottom' as HandleId, targetHandle: 'top' as HandleId, label: '' });
  const file = useRef<HTMLInputElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const previousDocId = useRef('');
  const previousNodes = useRef<DiagramNode[] | null>(null);
  const selectionRef = useRef({ nodes: [] as string[], edges: [] as string[] });
  const readonly = store.readonly || store.busy;

  useEffect(() => {
    if (doc && openExample && new URLSearchParams(window.location.search).has('example')) window.history.replaceState(window.history.state, '', '/app');
  }, [doc, openExample]);

  useEffect(() => {
    const warnAboutDraft = (event: BeforeUnloadEvent) => {
      const field = document.activeElement;
      if ((field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) && field.closest('.editor-shell') && field.value !== field.defaultValue) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', warnAboutDraft);
    return () => window.removeEventListener('beforeunload', warnAboutDraft);
  }, []);

  useEffect(() => {
    if (!doc) return;
    const switched = previousDocId.current !== doc.documentId;
    if (switched) {
      previousDocId.current = doc.documentId;
      selectionRef.current = { nodes: [], edges: [] };
      setSelectedNodes([]); setSelectedEdges([]);
      void flow.setViewport(doc.viewport); setZoom(doc.viewport.zoom);
    }
    if (switched || previousNodes.current !== doc.nodes) {
      previousNodes.current = doc.nodes;
      setFlowNodes(doc.nodes.map(n => portableNode(n, selectionRef.current.nodes.includes(n.id))));
    }
  }, [doc, flow]);

  const onSelectionChange = useCallback(({ nodes, edges }: { nodes: FlowNode[]; edges: Edge[] }) => {
    const nodeIds = nodes.map(n => n.id), edgeIds = edges.map(e => e.id);
    selectionRef.current = { nodes: nodeIds, edges: edgeIds };
    const same = (a: string[], b: string[]) => a.length === b.length && a.every((id, i) => id === b[i]);
    setSelectedNodes(previous => same(previous, nodeIds) ? previous : nodeIds);
    setSelectedEdges(previous => same(previous, edgeIds) ? previous : edgeIds);
  }, []);
  const edges: Edge[] = useMemo(() => doc?.edges.map(edge => ({ id: edge.id, source: edge.source, target: edge.target, sourceHandle: edge.sourceHandle, targetHandle: edge.targetHandle, type: 'routed', data: { model: edge }, selected: selectedEdges.includes(edge.id), markerEnd: { type: MarkerType.ArrowClosed, color: colorValues(edge.style.color).stroke, width: 18, height: 18 }, ariaLabel: `Connection ${edge.label || 'unlabeled'}`, reconnectable: !readonly })) ?? [], [doc, readonly, selectedEdges]);
  const select = useCallback((nodes: string[], edges: string[]) => { selectionRef.current = { nodes, edges }; setSelectedNodes(nodes); setSelectedEdges(edges); setFlowNodes(previous => previous.map(n => ({ ...n, selected: nodes.includes(n.id) }))); }, []);
  const commit = (next: Diagram, record = true) => { if (!readonly) { try { store.change(next, record); } catch (e) { store.setError(e instanceof Error ? e.message : 'This edit could not be applied.'); } } };
  const updateNode = (id: string, update: Partial<DiagramNode>) => { const d = store.current.current?.present; if (d) commit({ ...d, nodes: d.nodes.map(n => n.id === id ? { ...n, ...update } : n) }); };
  const updateEdge = (id: string, update: Partial<DiagramEdge>) => { const d = store.current.current?.present; if (d) { const edge = d.edges.find(e => e.id === id); if (edge && (update.source ?? edge.source) === (update.target ?? edge.target)) { store.setError('Connect two different nodes. Use a second node to create a loop.'); return; } commit({ ...d, edges: d.edges.map(e => e.id === id ? { ...e, ...update } : e) }); } };
  const deleteSelection = () => {
    const d = store.current.current?.present;
    if (!d || readonly) return;
    const nodes = new Set(selectionRef.current.nodes), edges = new Set(selectionRef.current.edges);
    if (!nodes.size && !edges.size) return;
    commit({ ...d, nodes: d.nodes.filter(n => !nodes.has(n.id)), edges: d.edges.filter(e => !nodes.has(e.source) && !nodes.has(e.target) && !edges.has(e.id)) }); select([], []);
  };
  const duplicate = () => {
    const d = store.current.current?.present;
    if (!d || readonly || !selectionRef.current.nodes.length) return;
    try { const next = duplicateSelection(d, selectionRef.current.nodes); commit(next); select(next.nodes.filter(n => !d.nodes.some(p => p.id === n.id)).map(n => n.id), []); } catch (e) { store.setError(e instanceof Error ? e.message : 'Could not duplicate the selection.'); }
  };
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (textFocus(event.target) || modal || readonly) return;
      const mod = event.metaKey || event.ctrlKey;
      const char = event.key.toLowerCase();
      if (mod && char === 'z') { event.preventDefault(); if (event.shiftKey) store.redo(); else store.undo(); }
      else if (mod && char === 'y') { event.preventDefault(); store.redo(); }
      else if (mod && char === 'a') { event.preventDefault(); if (doc) select(doc.nodes.map(n => n.id), doc.edges.map(e => e.id)); }
      else if (mod && char === 'd') { event.preventDefault(); duplicate(); }
      else if (event.key === 'Backspace' || event.key === 'Delete') { event.preventDefault(); deleteSelection(); }
      else if (event.key === 'Escape') select([], []);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  const addNode = (kind: NodeKind, dropPoint?: { x: number; y: number }) => {
    const current = store.current.current?.present;
    if (!current || readonly || !canvas.current) return;
    const rect = canvas.current.getBoundingClientRect();
    const point = flow.screenToFlowPosition(dropPoint ?? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }, { snapToGrid: false });
    const node = createNode(kind, { x: 0, y: 0 });
    const snap = (v: number) => current.settings.snapToGrid ? Math.round(v / 16) * 16 : v;
    let position = { x: snap(point.x - node.width / 2), y: snap(point.y - node.height / 2) };
    if (!dropPoint) while (current.nodes.some(n => Math.abs(n.position.x - position.x) < 20 && Math.abs(n.position.y - position.y) < 20)) position = { x: position.x + 32, y: position.y + 32 };
    commit({ ...current, nodes: [...current.nodes, { ...node, position }] }); select([node.id], []); setPalette(false);
  };
  const clearPaletteDrag = () => { paletteDrag.current = null; setDropReady(false); };
  const canDropShape = (event: DragEvent<HTMLElement>) => !readonly && paletteDrag.current?.documentId === store.current.current?.present.documentId && event.dataTransfer.types.includes(SHAPE_DRAG_TYPE);
  const dropShape = (event: DragEvent<HTMLElement>) => {
    if (!canDropShape(event)) return;
    event.preventDefault();
    const kind = paletteDrag.current!.kind;
    const matches = event.dataTransfer.getData(SHAPE_DRAG_TYPE) === kind;
    clearPaletteDrag();
    if (matches) addNode(kind, { x: event.clientX, y: event.clientY });
  };
  const connect = (connection: Connection, label = '') => {
    const d = store.current.current?.present;
    if (!d || readonly) return;
    if (connection.source === connection.target) { store.setError('Connect two different nodes. Use a second node to create a loop.'); return; }
    commit({ ...d, edges: [...d.edges, { id: freshId(), source: connection.source, target: connection.target, sourceHandle: (connection.sourceHandle as HandleId) ?? 'bottom', targetHandle: (connection.targetHandle as HandleId) ?? 'top', label, style: { color: 'neutral' } }] });
  };
  const onNodesChange = (changes: NodeChange<FlowNode>[]) => {
    const allowed = readonly ? changes.filter(c => c.type === 'select' || c.type === 'dimensions') : changes;
    const next = applyNodeChanges(allowed, flowNodes);
    setFlowNodes(next);
    const positions = changes.filter(c => c.type === 'position');
    if (!readonly && positions.length && positions.every(c => c.type === 'position' && c.dragging !== true)) {
      const d = store.current.current?.present;
      if (d) commit({ ...d, nodes: d.nodes.map(n => ({ ...n, position: next.find(f => f.id === n.id)?.position ?? n.position })) });
    }
  };
  const moveEnd = (_: MouseEvent | TouchEvent | null, viewport: Viewport) => {
    setZoom(viewport.zoom);
    const d = store.current.current?.present;
    if (d && !readonly && (Math.abs(d.viewport.x - viewport.x) > .01 || Math.abs(d.viewport.y - viewport.y) > .01 || Math.abs(d.viewport.zoom - viewport.zoom) > .0001)) commit({ ...d, viewport }, false);
  };
  const startConnection = () => { if (!doc) return; const source = selectedNodes[0] ?? doc.nodes[0]?.id ?? ''; setConnectionDraft({ source, target: doc.nodes.find(n => n.id !== source)?.id ?? '', sourceHandle: 'bottom', targetHandle: 'top', label: '' }); setModal('connection'); };
  const exportJSON = () => { const d = store.current.current?.present; if (d) { downloadJson(d); setNotice('JSON backup downloaded.'); } };
  const exportPNG = async () => { if (!doc) return; setExporting(true); try { await downloadPng(doc); setNotice('PNG downloaded.'); } catch (e) { store.setError(e instanceof Error ? e.message : 'PNG export failed. JSON download remains available.'); } finally { setExporting(false); } };
  const importFile = async (selected?: File) => {
    if (!selected) return;
    try {
      if (selected.size > 10 * 1024 * 1024) throw new Error('This file exceeds the 10 MiB import safety limit.');
      const imported = { ...parseDiagram(await selected.text()), documentId: freshId(), revision: 0 };
      await store.add(imported);
      select([], []);
    } catch (e) { store.setError(e instanceof Error ? e.message : 'This file is not a supported diagram.'); }
    if (file.current) file.current.value = '';
  };
  const chosenNode = selectedNodes.length === 1 && !selectedEdges.length ? doc?.nodes.find(n => n.id === selectedNodes[0]) : undefined;
  const chosenEdge = selectedEdges.length === 1 && !selectedNodes.length ? doc?.edges.find(e => e.id === selectedEdges[0]) : undefined;
  const hasSelection = selectedNodes.length + selectedEdges.length > 0;

  if (!doc) return <main className="editor-loading" role="status">Opening editor…</main>;
  return <main className="editor-shell">
    <header className="editor-header">
      <Link href="/" prefetch={false} className="editor-brand" aria-label={`${PRODUCT.name} home`}><Diamond size={22} strokeWidth={1.8} /><span>{PRODUCT.name}</span></Link>
      <span className="header-divider" />
      <input key={`${doc.documentId}:${doc.title}`} className="document-title" aria-label="Diagram title" defaultValue={doc.title} maxLength={200} disabled={readonly} onBlur={e => { const title = e.target.value.trim(); if (title && title !== doc.title) commit({ ...store.current.current!.present, title }); else e.target.value = doc.title; }} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
      <span className={`save-status ${store.status === 'error' || store.status === 'conflict' ? 'save-error' : ''}`} role="status">{store.status === 'saved' ? <><Check size={13} />Saved on this device</> : store.status === 'saving' ? 'Saving…' : store.status === 'conflict' ? 'Read-only copy' : 'Save failed'}</span>
      <div className="header-actions">
        <button className="button" onClick={() => setModal('documents')}><Files size={15} /><span>Documents</span></button>
        <button className="icon-button" aria-label="Help" onClick={() => setModal('help')}><CircleHelp size={19} /></button>
      </div>
    </header>
    <div className="editor-toolbar" role="toolbar" aria-label="Diagram tools">
      <button className="button palette-toggle" onClick={() => setPalette(!palette)} aria-expanded={palette}><Shapes size={16} />Shapes</button>
      <button className="icon-button" aria-label="Undo" title="Undo (⌘/Ctrl Z)" disabled={!store.canUndo || readonly} onClick={store.undo}><Undo2 size={18} /></button>
      <button className="icon-button" aria-label="Redo" title="Redo (⌘/Ctrl Shift Z)" disabled={!store.canRedo || readonly} onClick={store.redo}><Redo2 size={18} /></button>
      <span className="toolbar-divider" />
      <button className="icon-button" aria-label="Duplicate selection" title="Duplicate selection (⌘/Ctrl D)" disabled={!selectedNodes.length || readonly} onClick={duplicate}><Copy size={17} /></button>
      <button className="icon-button" aria-label="Delete selection" title="Delete selection" disabled={!hasSelection || readonly} onClick={deleteSelection}><Trash2 size={17} /></button>
      <span className="toolbar-divider" />
      <button className="button" onClick={startConnection} disabled={doc.nodes.length < 2 || readonly}><Link2 size={16} /><span>Connect nodes</span></button>
      <label className="snap-toggle"><input type="checkbox" checked={doc.settings.snapToGrid} disabled={readonly} onChange={e => commit({ ...doc, settings: { ...doc.settings, snapToGrid: e.target.checked } })} />Snap to grid</label>
      <div className="toolbar-end">
        <input ref={file} type="file" accept=".json,application/json" aria-label="Import diagram file" hidden onChange={e => void importFile(e.target.files?.[0])} />
        <button className="button" disabled={store.busy} onClick={() => file.current?.click()}><ArrowUpFromLine size={15} /><span>Import JSON</span></button>
        <button className="button" onClick={exportJSON}><ArrowDownToLine size={15} /><span>Export JSON</span></button>
        <button className="button button-dark" disabled={exporting} onClick={() => void exportPNG()}><ArrowDownToLine size={15} /><span>{exporting ? 'Exporting…' : 'Export PNG'}</span></button>
      </div>
    </div>
    {store.error && <div className="error-banner" role="alert"><span>{store.error}</span><div>{(store.status === 'error' || store.readonly) && <><button onClick={() => void store.saveCopy()} disabled={store.busy}>Save a separate copy</button><button onClick={exportJSON}>Download JSON</button></>}{store.status === 'error' && <button onClick={() => void store.save()}>Retry save</button>}{store.status !== 'error' && !store.readonly && <button aria-label="Dismiss error" onClick={() => store.setError('')}><X size={16} /></button>}</div></div>}
    <div className="editor-body">
      <aside className={`shape-palette ${palette ? 'palette-open' : ''}`} aria-label="Shapes">
        <div className="panel-title"><h2>Shapes</h2><span>Click or drag</span></div>
        <div className="shape-options">{NODE_TYPES.map(kind => <button key={kind} className="shape-option" aria-label={`Add ${NODE_TYPE_LABELS[kind]}`} onClick={() => addNode(kind)} disabled={readonly} draggable={!readonly}
          onDragStart={event => {
            if (readonly) { event.preventDefault(); return; }
            paletteDrag.current = { kind, documentId: doc.documentId };
            event.dataTransfer.setData(SHAPE_DRAG_TYPE, kind);
            event.dataTransfer.effectAllowed = 'copy';
          }} onDragEnd={clearPaletteDrag}>
          <svg width="44" height="30" viewBox="-2 -2 84 54" aria-hidden="true"><path d={nodePath(kind, 80, 50)} fill="white" stroke="currentColor" strokeWidth="2" /></svg><span>{NODE_TYPE_LABELS[kind]}</span>
        </button>)}</div>
        <div className="palette-bottom"><button className="button" disabled={readonly} onClick={async () => { await store.add(exampleDiagram()); select([], []); }}><FilePlus2 size={16} />Programming example</button><p>Drag between connection points to link shapes.</p></div>
      </aside>
      <section ref={canvas} className={`canvas${dropReady && !readonly ? ' canvas-drop-ready' : ''}`} aria-label="Diagram canvas"
        onDragOver={event => { if (canDropShape(event)) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; setDropReady(true); } }}
        onDragLeave={event => { if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDropReady(false); }}
        onDrop={dropShape}>
        <ReactFlow<FlowNode> nodes={flowNodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} onNodesChange={onNodesChange} onEdgesChange={changes => { for (const change of changes) if (change.type === 'select') setSelectedEdges(prev => change.selected ? [...new Set([...prev, change.id])] : prev.filter(id => id !== change.id)); }}
          onSelectionChange={onSelectionChange}
          onConnect={connection => connect(connection)} onReconnect={(old, connection) => updateEdge(old.id, { source: connection.source, target: connection.target, sourceHandle: (connection.sourceHandle as HandleId) ?? 'bottom', targetHandle: (connection.targetHandle as HandleId) ?? 'top' })}
          onNodeDoubleClick={(_, node) => { select([node.id], []); setTimeout(() => document.getElementById('node-label')?.focus(), 0); }}
          connectionMode={ConnectionMode.Loose} nodesDraggable={!readonly} nodesConnectable={!readonly} edgesReconnectable={!readonly} deleteKeyCode={null} multiSelectionKeyCode={['Meta', 'Control', 'Shift']} selectionOnDrag selectionMode={SelectionMode.Partial} panOnDrag={[1, 2]} panActivationKeyCode="Space" selectionKeyCode="Shift" zoomOnDoubleClick={false} minZoom={.1} maxZoom={4} snapToGrid={doc.settings.snapToGrid} snapGrid={[16,16]} defaultViewport={doc.viewport} onMove={(_, vp) => setZoom(vp.zoom)} onMoveEnd={moveEnd} onlyRenderVisibleElements={false}>
          {doc.settings.gridVisible && <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="#d2d2d2" />}
          {!doc.nodes.length && <Panel position="top-center" className="empty-canvas"><MousePointer2 size={22} /><h1>Blank diagram</h1><p>Choose a shape to start drawing.</p><button className="text-button" onClick={async () => { await store.add(exampleDiagram()); }}>Open programming example</button></Panel>}
          <Panel position="bottom-left" className="canvas-controls"><button className="icon-button" aria-label="Zoom out" onClick={() => void flow.zoomOut()}><Minus size={16} /></button><span aria-label="Zoom level">{Math.round(zoom * 100)}%</span><button className="icon-button" aria-label="Zoom in" onClick={() => void flow.zoomIn()}><Plus size={16} /></button><span className="toolbar-divider" /><button className="icon-button" aria-label="Fit view" title="Fit diagram" onClick={() => void flow.fitView({ padding: .2, maxZoom: 1 })}><Maximize size={16} /></button><button className={`icon-button ${doc.settings.gridVisible ? 'active' : ''}`} aria-label="Toggle grid" aria-pressed={doc.settings.gridVisible} disabled={readonly} onClick={() => commit({ ...doc, settings: { ...doc.settings, gridVisible: !doc.settings.gridVisible } })}><Grid2X2 size={16} /></button></Panel>
          <Panel position="bottom-right" className="canvas-hint">Space + drag to pan · Shift + click to select</Panel>
        </ReactFlow>
      </section>
      {hasSelection && <aside className="properties-panel" aria-label="Properties"><div className="panel-title"><h2>{chosenNode ? NODE_TYPE_LABELS[chosenNode.type] : chosenEdge ? 'Connection' : 'Selection'}</h2><button className="icon-button" aria-label="Clear selection" onClick={() => select([], [])}><X size={16} /></button></div>
        {chosenNode && <div className="property-fields" key={chosenNode.id}>
          <label>Label<textarea id="node-label" aria-label="Node label" defaultValue={chosenNode.label} key={`${chosenNode.id}:${chosenNode.label}`} maxLength={4000} disabled={readonly} onBlur={e => { if (e.target.value !== chosenNode.label) updateNode(chosenNode.id, growLabel(chosenNode, e.target.value)); }} rows={4} /></label>
          <label>Notes<textarea aria-label="Notes" defaultValue={chosenNode.notes} key={`${chosenNode.id}:${chosenNode.notes}`} maxLength={20000} disabled={readonly} onBlur={e => { if (e.target.value !== chosenNode.notes) updateNode(chosenNode.id, { notes: e.target.value }); }} rows={4} /></label><p className="field-hint">Notes are saved in JSON. They do not appear on the canvas or PNG.</p>
          <fieldset className="color-options" disabled={readonly}><legend>Color</legend>{COLORS.map(color => <button key={color} className="color-choice" aria-label={COLOR_LABELS[color]} aria-pressed={chosenNode.style.color === color} style={{ background: colorValues(color).fill, borderColor: colorValues(color).stroke }} onClick={() => updateNode(chosenNode.id, { style: { color } })}>{chosenNode.style.color === color && <Check size={14} />}</button>)}</fieldset>
          <button className="button" disabled={doc.nodes.length < 2 || readonly} onClick={startConnection}><Link2 size={15} />Connect node</button>
        </div>}
        {chosenEdge && <div className="property-fields" key={chosenEdge.id}><label>Label<textarea aria-label="Connection label" defaultValue={chosenEdge.label} key={`${chosenEdge.id}:${chosenEdge.label}`} maxLength={4000} rows={3} disabled={readonly} onBlur={e => { if (e.target.value !== chosenEdge.label) updateEdge(chosenEdge.id, { label: e.target.value }); }} /></label>
          {(['source','target'] as const).map(side => <div className="connection-end" key={side}><label>{side === 'source' ? 'From' : 'To'}<select aria-label={side === 'source' ? 'Connection source' : 'Connection target'} value={chosenEdge[side]} disabled={readonly} onChange={e => updateEdge(chosenEdge.id, { [side]: e.target.value })}>{doc.nodes.map(n => <option key={n.id} value={n.id}>{n.label.slice(0,50) || NODE_TYPE_LABELS[n.type]}</option>)}</select></label><label>Connection point<select aria-label={`${side} handle`} value={chosenEdge[`${side}Handle`]} disabled={readonly} onChange={e => updateEdge(chosenEdge.id, { [`${side}Handle`]: e.target.value as HandleId })}>{HANDLES.map(h => <option key={h} value={h}>{h}</option>)}</select></label></div>)}
        </div>}
        {!chosenNode && !chosenEdge && <p className="selection-count">{selectedNodes.length} shapes · {selectedEdges.length} connections</p>}
        <div className="properties-actions"><button className="button" onClick={duplicate} disabled={!selectedNodes.length || readonly}><Copy size={15} />Duplicate</button><button className="button danger" onClick={deleteSelection} disabled={readonly}><Trash2 size={15} />Delete</button></div>
      </aside>}
    </div>
    <footer className="editor-footer"><span>{doc.nodes.length} shapes<span className="footer-dot">·</span>{doc.edges.length} connections</span><span className="footer-notice" aria-live="polite">{notice}</span><button className="text-button" onClick={() => setModal('help')}>Local storage & help</button></footer>
    {modal === 'help' && <Modal title="Help" onClose={() => setModal(null)}><div className="help-content"><h3>Drawing</h3><p>Click a sidebar shape to add it, or drag it onto the canvas to place it. Drag canvas shapes to move them. Click a label to select its shape and edit it in Properties. Changes apply when you leave the field.</p><p>Drag between connection points, or use Connect nodes to choose endpoints and labels. Multiple branches, merges, and multi-node loops work. Same-node loops are not supported.</p><h3>Canvas and keyboard</h3><p>Use the mouse wheel to zoom. Hold Space and drag, or use the middle/right mouse button, to pan. Drag on empty canvas to select a group. Shift + click adds to a selection. Focus a shape and use arrow keys to move it.</p><dl className="shortcuts"><dt>Undo / redo</dt><dd>⌘/Ctrl Z / Shift Z</dd><dt>Duplicate</dt><dd>⌘/Ctrl D</dd><dt>Select all</dt><dd>⌘/Ctrl A</dd><dt>Delete selection</dt><dd>Delete / Backspace</dd></dl><h3>Local files</h3><p>Diagrams save in this browser on this device. Clearing browser data or storage eviction can remove them. Export JSON for an editable backup; import always creates a new document. PNG includes the whole diagram.</p><p>Editing and saving continue if you disconnect after loading. Reopening offline is not supported yet. Nothing in a diagram is uploaded.</p><Link href="/privacy" target="_blank">Privacy and storage details</Link></div></Modal>}
    {modal === 'documents' && <Modal title="Documents" onClose={() => setModal(null)}><div className="document-actions"><button className="button button-dark" disabled={store.busy} onClick={async () => { await store.add(newDiagram()); setModal(null); }}><Plus size={16} />New diagram</button><button className="button" disabled={store.busy} onClick={async () => { await store.saveCopy(); setModal(null); }}>Duplicate document</button><button className="button danger" disabled={readonly} onClick={() => setModal('delete')}>Delete document</button></div><p className="storage-copy">Saved in this browser. Keep JSON backups before clearing browser data.</p><ul className="document-list">{store.documents.map(d => <li key={d.documentId}><button className={d.documentId === doc.documentId ? 'current-document' : ''} disabled={store.busy} onClick={async () => { await store.switchTo(d.documentId); setModal(null); }}><Files size={18} /><span><strong>{d.title}</strong><small>{d.nodes.length} shapes · {new Date(d.updatedAt).toLocaleDateString()}</small></span>{d.documentId === doc.documentId && <Check size={16} />}</button></li>)}</ul><button className="button" onClick={() => { setModal(null); setTimeout(() => document.querySelector<HTMLInputElement>('[aria-label="Diagram title"]')?.focus(),0); }} disabled={readonly}>Rename current document</button></Modal>}
    {modal === 'delete' && <Modal title="Delete document" onClose={() => setModal(null)}><p>Delete “{doc.title}” from this device? This cannot be undone. Download JSON first if you want a backup.</p><div className="dialog-actions"><button className="button" onClick={exportJSON}>Download JSON</button><button className="button" onClick={() => setModal(null)}>Cancel</button><button className="button button-dark" disabled={store.busy} onClick={async () => { await store.remove(); setModal(null); }}>Delete permanently</button></div></Modal>}
    {modal === 'connection' && <Modal title="Connect nodes" onClose={() => setModal(null)}><form className="connection-form" onSubmit={e => { e.preventDefault(); if (connectionDraft.source === connectionDraft.target) return; connect(connectionDraft, connectionDraft.label); setModal(null); }}>
      {(['source','target'] as const).map(side => <div key={side} className="connection-end"><label>{side === 'source' ? 'From' : 'To'}<select aria-label={side === 'source' ? 'From node' : 'To node'} value={connectionDraft[side]} onChange={e => setConnectionDraft({ ...connectionDraft, [side]: e.target.value })}>{doc.nodes.map(n => <option key={n.id} value={n.id}>{n.label.slice(0,80) || NODE_TYPE_LABELS[n.type]}</option>)}</select></label><label>Connection point<select aria-label={`${side} connection point`} value={connectionDraft[`${side}Handle`]} onChange={e => setConnectionDraft({ ...connectionDraft, [`${side}Handle`]: e.target.value as HandleId })}>{HANDLES.map(h => <option key={h} value={h}>{h}</option>)}</select></label></div>)}
      <label>Label<input aria-label="New connection label" value={connectionDraft.label} maxLength={4000} placeholder="Yes, No, success…" onChange={e => setConnectionDraft({ ...connectionDraft, label: e.target.value })} /></label><div className="dialog-actions"><button type="button" className="button" onClick={() => setModal(null)}>Cancel</button><button className="button button-dark" disabled={!connectionDraft.source || !connectionDraft.target || connectionDraft.source === connectionDraft.target}>Add connection</button></div></form></Modal>}
  </main>;
}
