'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ReactFlow, ReactFlowProvider, Background, BackgroundVariant, ConnectionMode, Panel, SelectionMode, Position, applyNodeChanges, useReactFlow, type Connection, type Edge, type NodeChange, type Viewport } from '@xyflow/react';
import { ArrowDownToLine, ArrowUpFromLine, Check, CircleHelp, Code2, ChevronDown, Copy, ClipboardPaste, Scissors, LockKeyhole, Unlock, Group, Ungroup, Diamond, FilePlus2, Files, Hand, Pencil, Eraser, Search, Link2, Maximize, Minus, MousePointer2, Plus, Redo2, Shapes, Trash2, Undo2, Workflow, Ellipsis, Share2, X } from 'lucide-react';
import '@xyflow/react/dist/style.css';
import './editor.css';
import { COLOR_LABELS, COLORS, HANDLES, NODE_DEFINITIONS, NODE_TYPES, NODE_TYPE_LABELS, createNode, duplicateSelection, exampleDiagram, freshId, newDiagram, parseDiagram, type CanvasBackground, type ColorName, type Diagram, type DiagramEdge, type DiagramNode, type HandleId, type NodeKind } from '@/lib/diagram';
import { PRODUCT } from '@/lib/config';
import { colorValues, nodePath, nodeTextBox, handlePoint, wrapLabel } from '@/lib/geometry';
import { downloadJson, downloadPng, downloadSvg, downloadPdf } from '@/lib/export';
import { useDocuments } from '@/lib/use-documents';
import { alignShapes, type AlignmentGuide } from '@/lib/alignment';
import { ShapeNode, type FlowNode } from './diagram-elements';
import { EditableEdge } from './editable-edge';
import ConnectorStylePicker from './connector-style-picker';
import type { EdgeStyle } from '@/lib/connectors';
import { expandSelection, copySelection, pasteSelection, groupSelection, ungroupSelection, lockSelection, moveNodes, arrangeSelection, type ArrangeMode } from '@/lib/editing';
import AlignmentOverlay from './alignment-overlay';
import DrawingOverlay from './drawing-overlay';
import { drawingBounds, type DrawingStroke } from '@/lib/drawing';
import Modal from './modal';
import ShareDialog from './share-dialog';
import TooltipButton from './tooltip-button';
import CodePanel from './code-panel';
import { prepareAllBackups, downloadBackupArchive } from '@/lib/backup';
import { diagramRepository } from '@/lib/repository';

const nodeTypes = { shape: ShapeNode };
const edgeTypes = { routed: EditableEdge };
const PALETTE_DRAG_DISTANCE = 6;
type PaletteDrag = { node: DiagramNode; documentId: string; pointerId: number; start: { x: number; y: number }; point: { x: number; y: number }; active: boolean; canceled: boolean };
function nodeHandles(node: DiagramNode) {
  const positions = { top: Position.Top, right: Position.Right, bottom: Position.Bottom, left: Position.Left };
  return HANDLES.map(id => {
    const anchor = handlePoint({ ...node, position: { x: 0, y: 0 } }, id);
    return { id, type: 'source' as const, position: positions[id], x: anchor.x - 4.5, y: anchor.y - 4.5, width: 9, height: 9 };
  });
}
function portableNode(n: DiagramNode, selected = false): FlowNode { return { id: n.id, type: 'shape', position: n.position, width: n.width, height: n.height, handles: nodeHandles(n), data: { model: n }, selected, ariaLabel: `${NODE_TYPE_LABELS[n.type]}: ${n.label || 'Untitled'}` }; }
function growLabel(node: DiagramNode, label: string): DiagramNode {
  let width = node.width, height = node.height;
  for (let attempt = 0; attempt < 30; attempt++) {
    const box = nodeTextBox(node.type, width, height);
    const lines = wrapLabel(label, box.width);
    if (lines.length * 20 <= box.height) break;
    if (height < 2000) height = Math.min(2000, Math.max(height + 20, height * (lines.length * 20 + 8) / Math.max(1, box.height)));
    else if (width < 2000) width = Math.min(2000, width + 100);
    else break;
  }
  return { ...node, label, width, height };
}
function textFocus(target: EventTarget | null) { return target instanceof HTMLElement && (!!target.closest('input,textarea,select,[contenteditable="true"],[role="dialog"],dialog')); }

export default function Editor() { return <ReactFlowProvider><Workspace /></ReactFlowProvider>; }
function Workspace() {
  const search = useSearchParams();
  const [openExample] = useState(() => search.get('example') === '1');
  const store = useDocuments(openExample);
  const { doc, current: currentHistory } = store;
  const flow = useReactFlow<FlowNode>();
  const [flowNodes, setFlowNodes] = useState<FlowNode[]>([]);
  const [selectedNodes, setSelectedNodes] = useState<string[]>([]);
  const [selectedEdges, setSelectedEdges] = useState<string[]>([]);
  const [modal, setModal] = useState<'documents' | 'help' | 'connection' | 'delete' | 'actions' | 'share' | null>(null);
  const [palette, setPalette] = useState(false);
  const [codeOpen, setCodeOpen] = useState(false);
  const [expandedShapeGroups, setExpandedShapeGroups] = useState<string[]>(['Basic']);
  const [exampleDismissed, setExampleDismissed] = useState(() => { try { return typeof window !== 'undefined' && localStorage.getItem('flowchart:hide-example') === 'true'; } catch { return false; } });
  const [backingUp, setBackingUp] = useState(false);
  const [backupError, setBackupError] = useState('');
  const backupRunning = useRef(false);
  const [shapeSearch, setShapeSearch] = useState('');
  const [tool, setTool] = useState<'pan' | 'select' | 'draw' | 'erase'>('pan');
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [drawingActive, setDrawingActive] = useState(false);
  const [edgeEditing, setEdgeEditing] = useState(false);
  const clipboard = useRef<Diagram | null>(null);
  const pasteCount = useRef(0);
  const [resizingId, setResizingId] = useState<string | null>(null);
  const resizeSession = useRef<{ id: string; documentId: string } | null>(null);
  const canceledResizes = useRef(new Set<string>());
  const [penColor, setPenColor] = useState<ColorName>('neutral');
  const [penWidth, setPenWidth] = useState(3);
  const effectiveTool = spaceHeld ? 'pan' : tool;
  const [alignmentEnabled, setAlignmentEnabled] = useState(() => { try { return typeof window === 'undefined' || localStorage.getItem('flowchart:align-shapes') !== 'false'; } catch { return true; } });
  const [guides, setGuides] = useState<AlignmentGuide[]>([]);
  const [palettePreview, setPalettePreview] = useState<DiagramNode | null>(null);
  const [paletteLabel, setPaletteLabel] = useState<{ kind: NodeKind; x: number; y: number } | null>(null);
  const paletteDrag = useRef<PaletteDrag | null>(null);
  const suppressPaletteClick = useRef(false);
  const bypassSnapping = useRef(false);
  const [arranging, setArranging] = useState(false);
  const arrangingRef = useRef(false);
  const [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState('');
  const [zoom, setZoom] = useState(1);
  const [defaultConnectionStyle, setDefaultConnectionStyle] = useState<EdgeStyle>({ color: 'neutral' });
  const [connectionDraftStyle, setConnectionDraftStyle] = useState<EdgeStyle>({ color: 'neutral' });
  const [connectionDraft, setConnectionDraft] = useState({ source: '', target: '', sourceHandle: 'bottom' as HandleId, targetHandle: 'top' as HandleId, label: '' });
  const file = useRef<HTMLInputElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const previousDocId = useRef('');
  const previousNodes = useRef<DiagramNode[] | null>(null);
  const selectionRef = useRef({ nodes: [] as string[], edges: [] as string[] });
  const readonly = store.readonly || store.busy || arranging || backingUp;
  const beginResize = (id: string) => {
    const current = currentHistory.current?.present;
    if (!current) return;
    canceledResizes.current.delete(id);
    resizeSession.current = { id, documentId: current.documentId };
    setResizingId(id); setGuides([]);
  };
  const cancelResize = () => {
    if (!resizeSession.current) return;
    canceledResizes.current.add(resizeSession.current.id);
    resizeSession.current = null;
    setResizingId(null);
    const current = currentHistory.current?.present;
    if (current) setFlowNodes(current.nodes.map(node => portableNode(node, selectionRef.current.nodes.includes(node.id))));
  };
  const lockedIds = useMemo(() => {
    const groups = new Set(doc?.nodes.filter(node => node.locked && node.groupId).map(node => node.groupId));
    return new Set(doc?.nodes.filter(node => node.locked || (node.groupId && groups.has(node.groupId))).map(node => node.id));
  }, [doc?.nodes]);
  const displayNodes = flowNodes.map(node => ({ ...node, handles: nodeHandles(node.data.model), draggable: !readonly && !spaceHeld && (tool === 'pan' || tool === 'select') && !lockedIds.has(node.id), data: { ...node.data,
    resizeEnabled: !lockedIds.has(node.id) && !node.data.model.groupId && !readonly && !spaceHeld && !modal && (tool === 'pan' || tool === 'select') && selectedNodes.length === 1 && !selectedEdges.length,
    onResizeStart: beginResize,
  } }));

  useEffect(() => {
    if (readonly || (resizeSession.current && resizeSession.current.documentId !== doc?.documentId)) cancelResize();
  });


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
  const liveDiagram = useMemo(() => {
    if (!doc) return null;
    const moved = moveNodes(doc, new Map(flowNodes.map(node => [node.id, node.position])));
    return { ...moved, nodes: moved.nodes.map(node => {
      const live = flowNodes.find(item => item.id === node.id);
      return live ? { ...node, width: live.data.model.width, height: live.data.model.height } : node;
    }) };
  }, [doc, flowNodes]);
  const changeWaypoints = (id: string, waypoints: { x: number; y: number }[]) => {
    const current = currentHistory.current?.present;
    if (!current || readonly) return;
    try { store.change({ ...current, edges: current.edges.map(edge => {
      if (edge.id !== id) return edge;
      const next: DiagramEdge = { ...edge, waypoints };
      if (!waypoints.length) delete next.waypoints;
      return next;
    }) }); }
    catch (error) { store.setError(error instanceof Error ? error.message : 'Could not update this connection.'); }
  };
  const edges: Edge[] = liveDiagram?.edges.map(edge => ({ id: edge.id, source: edge.source, target: edge.target, sourceHandle: edge.sourceHandle, targetHandle: edge.targetHandle, type: 'routed', data: { model: edge, nodes: liveDiagram.nodes, readonly: readonly || tool === 'draw' || tool === 'erase', onWaypointsChange: changeWaypoints, onEditingChange: setEdgeEditing }, selected: selectedEdges.includes(edge.id), ariaLabel: `Connection ${edge.label || 'unlabeled'}`, reconnectable: !readonly })) ?? [];
  const select = (nodes: string[], edges: string[]) => {
    const current = currentHistory.current?.present;
    const ids = current ? expandSelection(current, nodes) : nodes;
    selectionRef.current = { nodes: ids, edges }; setSelectedNodes(ids); setSelectedEdges(edges);
    setFlowNodes(previous => previous.map(node => ({ ...node, selected: ids.includes(node.id) })));
  };
  const commit = (next: Diagram, record = true) => { if (!readonly) { try { store.change(next, record); } catch (e) { store.setError(e instanceof Error ? e.message : 'This edit could not be applied.'); } } };
  const updateNode = (id: string, update: Partial<DiagramNode>) => { const d = store.current.current?.present; if (d && !lockedIds.has(id)) commit({ ...d, nodes: d.nodes.map(n => n.id === id ? { ...n, ...update } : n) }); };
  const updateEdge = (id: string, update: Partial<DiagramEdge>) => { const d = store.current.current?.present; if (d) { const edge = d.edges.find(e => e.id === id); if (edge && (update.source ?? edge.source) === (update.target ?? edge.target)) { store.setError('Connect two different nodes. Use a second node to create a loop.'); return; } commit({ ...d, edges: d.edges.map(e => e.id === id ? { ...e, ...update } : e) }); } };
  const deleteSelection = () => {
    const d = store.current.current?.present;
    if (!d || readonly) return;
    const nodes = new Set(expandSelection(d, selectionRef.current.nodes).filter(id => !lockedIds.has(id))), edges = new Set(selectionRef.current.edges);
    if (!nodes.size && !edges.size) return;
    commit({ ...d, nodes: d.nodes.filter(n => !nodes.has(n.id)), edges: d.edges.filter(e => !nodes.has(e.source) && !nodes.has(e.target) && !edges.has(e.id)) }); select([], []);
  };
  const duplicate = () => {
    const d = store.current.current?.present;
    if (!d || readonly || !selectionRef.current.nodes.length) return;
    try { const next = duplicateSelection(d, selectionRef.current.nodes); commit(next); select(next.nodes.filter(n => !d.nodes.some(p => p.id === n.id)).map(n => n.id), []); } catch (e) { store.setError(e instanceof Error ? e.message : 'Could not duplicate the selection.'); }
  };
  const copy = async (cut = false) => {
    const current = currentHistory.current?.present;
    if (!current || readonly || resizeSession.current || edgeEditing) return;
    const ids = cut ? selectionRef.current.nodes.filter(id => !lockedIds.has(id)) : selectionRef.current.nodes;
    const fragment = copySelection(current, ids);
    if (!fragment) return;
    clipboard.current = fragment; pasteCount.current = 0;
    if (cut) deleteSelection();
    setNotice(`${cut ? 'Cut' : 'Copied'} ${fragment.nodes.length} shapes.`);
    try { await navigator.clipboard.writeText(JSON.stringify({ format: 'flowchart-studio/selection', diagram: fragment })); }
    catch { setNotice('Copied within this editor.'); }
  };
  const paste = async () => {
    const initial = currentHistory.current?.present;
    if (!initial || readonly || resizeSession.current || edgeEditing || !canvas.current) return;
    let fragment = clipboard.current;
    try {
      const text = await navigator.clipboard.readText();
      if (text.length <= 10 * 1024 * 1024) {
        try {
          const content = JSON.parse(text);
          fragment = content?.format === 'flowchart-studio/selection' ? parseDiagram(JSON.stringify(content.diagram)) : null;
        } catch { fragment = null; }
      }
    } catch { /* Use this editor's clipboard if system access is unavailable. */ }
    const current = currentHistory.current?.present;
    if (!fragment?.nodes.length || !current || current.documentId !== initial.documentId) { setNotice('Copy shapes before pasting.'); return; }
    try {
      const bounds = canvas.current.getBoundingClientRect();
      const center = flow.screenToFlowPosition({ x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 }, { snapToGrid: false });
      const offset = (pasteCount.current++ % 10) * 24;
      const result = pasteSelection(current, fragment, { x: center.x + offset, y: center.y + offset });
      commit(result.diagram); select(result.nodeIds, []); setTool('pan');
      setNotice(`Pasted ${result.nodeIds.length} shapes.`);
    } catch (error) { store.setError(error instanceof Error ? error.message : 'Could not paste these shapes.'); }
  };
  const arrangeSelected = (mode: ArrangeMode) => {
    const current = currentHistory.current?.present;
    if (current) commit(arrangeSelection(current, selectionRef.current.nodes, mode));
  };
  const groupSelected = (ungroup = false) => {
    const current = currentHistory.current?.present;
    if (current) { const next = ungroup ? ungroupSelection(current, selectionRef.current.nodes) : groupSelection(current, selectionRef.current.nodes); commit(next); select(expandSelection(next, selectionRef.current.nodes), []); }
  };
  const lockSelected = (locked: boolean) => {
    const current = currentHistory.current?.present;
    if (current) { commit(lockSelection(current, selectionRef.current.nodes, locked)); select(selectionRef.current.nodes, selectionRef.current.edges); }
  };
  const hidePalettePreview = () => { setPalettePreview(null); setPaletteLabel(null); setGuides([]); };
  const clearPaletteDrag = () => { paletteDrag.current = null; hidePalettePreview(); };
  const insideCanvas = (point: { x: number; y: number }) => {
    const element = document.elementFromPoint(point.x, point.y);
    return !!element && !!canvas.current?.contains(element) && !element.closest('button,a,input,select,textarea');
  };
  const palettePlacement = (node: DiagramNode, point: { x: number; y: number }, bypass = false) => {
    const d = store.current.current!.present;
    const center = flow.screenToFlowPosition(point, { snapToGrid: false });
    const candidate = { ...node, position: { x: center.x - node.width / 2, y: center.y - node.height / 2 } };
    const aligned = alignShapes([candidate], d.nodes, { zoom: flow.getZoom(), snapToGrid: d.settings.snapToGrid && !bypass, enabled: alignmentEnabled && !bypass });
    return { node: { ...candidate, position: { x: candidate.position.x + aligned.delta.x, y: candidate.position.y + aligned.delta.y } }, guides: aligned.guides };
  };
  const updatePalettePreview = (point: { x: number; y: number }, bypass: boolean) => {
    const drag = paletteDrag.current;
    if (!drag || drag.canceled || readonly || drag.documentId !== store.current.current?.present.documentId) { hidePalettePreview(); return; }
    drag.point = point;
    if (insideCanvas(point)) {
      const placement = palettePlacement(drag.node, point, bypass);
      setPalettePreview(placement.node); setGuides(placement.guides); setPaletteLabel(null);
    } else {
      setPalettePreview(null); setGuides([]); setPaletteLabel({ kind: drag.node.type, ...point });
    }
  };
  const startPaletteDrag = (event: ReactPointerEvent<HTMLButtonElement>, kind: NodeKind) => {
    if (readonly || event.button !== 0 || !event.isPrimary || !doc) return;
    const point = { x: event.clientX, y: event.clientY };
    paletteDrag.current = { node: createNode(kind, { x: 0, y: 0 }), documentId: doc.documentId, pointerId: event.pointerId, start: point, point, active: false, canceled: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const movePaletteDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = paletteDrag.current;
    if (!drag || drag.pointerId !== event.pointerId || drag.canceled) return;
    const point = { x: event.clientX, y: event.clientY };
    drag.point = point;
    if (!drag.active && Math.hypot(point.x - drag.start.x, point.y - drag.start.y) < PALETTE_DRAG_DISTANCE) return;
    drag.active = true; event.preventDefault();
    updatePalettePreview(point, event.altKey);
  };
  const finishPaletteDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = paletteDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const point = { x: event.clientX, y: event.clientY };
    // A quick release can arrive before a movement update. Use its position too.
    drag.active ||= Math.hypot(point.x - drag.start.x, point.y - drag.start.y) >= PALETTE_DRAG_DISTANCE;
    if (drag.active || drag.canceled) {
      event.preventDefault();
      suppressPaletteClick.current = true;
      setTimeout(() => { suppressPaletteClick.current = false; }, 0);
      const d = store.current.current?.present;
      if (!drag.canceled && !readonly && d?.documentId === drag.documentId && insideCanvas(point)) {
        const { node } = palettePlacement(drag.node, point, event.altKey);
        commit({ ...d, nodes: [...d.nodes, node] }); select([node.id], []); setPalette(false); setTool('pan');
      }
    }
    clearPaletteDrag();
  };
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Alt') {
        bypassSnapping.current = true; setGuides([]);
        if (paletteDrag.current?.active) updatePalettePreview(paletteDrag.current.point, true);
      }
      if (event.key === 'Escape' && paletteDrag.current) {
        event.preventDefault(); paletteDrag.current.canceled = true; hidePalettePreview(); return;
      }
      if (resizeSession.current || edgeEditing) {
        if (event.key === 'Escape' && resizeSession.current) { event.preventDefault(); cancelResize(); }
        else if ((event.metaKey || event.ctrlKey) && ['z', 'y', 'd', 'a'].includes(event.key.toLowerCase())) event.preventDefault();
        return;
      }
      if (textFocus(event.target) || modal) return;
      if (event.code === 'Space') { event.preventDefault(); setSpaceHeld(true); return; }
      if (readonly || drawingActive) return;
      const mod = event.metaKey || event.ctrlKey;
      const char = event.key.toLowerCase();
      if (mod && char === 'z') { event.preventDefault(); if (event.shiftKey) store.redo(); else store.undo(); }
      else if (mod && char === 'y') { event.preventDefault(); store.redo(); }
      else if (mod && char === 'a') { event.preventDefault(); if (doc) select(doc.nodes.map(n => n.id), doc.edges.map(e => e.id)); }
      else if (mod && char === 'd') { event.preventDefault(); duplicate(); }
      else if (mod && char === 'c' && selectionRef.current.nodes.length) { event.preventDefault(); void copy(); }
      else if (mod && char === 'x' && selectionRef.current.nodes.length) { event.preventDefault(); void copy(true); }
      else if (mod && char === 'v') { event.preventDefault(); void paste(); }
      else if (mod && char === 'g') { event.preventDefault(); groupSelected(event.shiftKey); }
      else if (event.key === 'Backspace' || event.key === 'Delete') { event.preventDefault(); deleteSelection(); }
      else if (event.key === 'Escape') { select([], []); setTool('pan'); }
      else if (!mod && !event.altKey && char === 'h') setTool('pan');
      else if (!mod && !event.altKey && char === 'v') setTool('select');
      else if (!mod && !event.altKey && char === 'p') { select([], []); setTool('draw'); }
      else if (!mod && !event.altKey && char === 'e') { select([], []); setTool('erase'); }
    };
    const release = (event: KeyboardEvent) => {
      if (event.code === 'Space') setSpaceHeld(false);
      if (event.key !== 'Alt') return;
      bypassSnapping.current = false;
      if (paletteDrag.current?.active) updatePalettePreview(paletteDrag.current.point, false);
    };
    const blur = () => { cancelResize(); setSpaceHeld(false); bypassSnapping.current = false; clearPaletteDrag(); };
    window.addEventListener('keydown', key); window.addEventListener('keyup', release); window.addEventListener('blur', blur);
    return () => { window.removeEventListener('keydown', key); window.removeEventListener('keyup', release); window.removeEventListener('blur', blur); };
  });

  const addNode = (kind: NodeKind) => {
    const current = store.current.current?.present;
    if (!current || readonly || !canvas.current) return;
    const rect = canvas.current.getBoundingClientRect();
    const point = flow.screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }, { snapToGrid: false });
    const node = createNode(kind, { x: 0, y: 0 });
    const snap = (v: number) => current.settings.snapToGrid ? Math.round(v / 16) * 16 : v;
    let position = { x: snap(point.x - node.width / 2), y: snap(point.y - node.height / 2) };
    while (current.nodes.some(n => Math.abs(n.position.x - position.x) < 20 && Math.abs(n.position.y - position.y) < 20)) position = { x: position.x + 32, y: position.y + 32 };
    commit({ ...current, nodes: [...current.nodes, { ...node, position }] }); select([node.id], []); setPalette(false); setTool('pan');
  };
  const connect = (connection: Connection, label = '', style: EdgeStyle = defaultConnectionStyle) => {
    const d = store.current.current?.present;
    if (!d || readonly) return;
    if (connection.source === connection.target) { store.setError('Connect two different nodes. Use a second node to create a loop.'); return; }
    commit({ ...d, edges: [...d.edges, { id: freshId(), source: connection.source, target: connection.target, sourceHandle: (connection.sourceHandle as HandleId) ?? 'bottom', targetHandle: (connection.targetHandle as HandleId) ?? 'top', label, style: { ...style } }] });
  };
  const onNodesChange = (changes: NodeChange<FlowNode>[]) => {
    const allowed = changes.filter(change => {
      if ('id' in change && lockedIds.has(change.id) && (change.type === 'position' || (change.type === 'dimensions' && change.resizing !== undefined))) return false;
      if ('id' in change && canceledResizes.current.has(change.id) && (change.type === 'position' || (change.type === 'dimensions' && change.resizing !== undefined))) {
        if (change.type === 'dimensions' && change.resizing === false) canceledResizes.current.delete(change.id);
        return false;
      }
      return !readonly || change.type === 'select' || (change.type === 'dimensions' && change.resizing === undefined);
    });
    let next = applyNodeChanges(allowed, flowNodes);
    const resizing = allowed.filter((change): change is Extract<NodeChange<FlowNode>, { type: 'dimensions' }> => change.type === 'dimensions' && change.resizing !== undefined);
    if (resizing.length) {
      const ids = new Set(resizing.map(change => change.id));
      next = next.map(node => ids.has(node.id) ? { ...node, data: { ...node.data, model: { ...node.data.model, position: node.position, width: node.width ?? node.data.model.width, height: node.height ?? node.data.model.height } } } : node);
    }
    const positions = allowed.filter(c => c.type === 'position');
    const pointerPositions = positions.filter(c => c.dragging !== undefined);
    const d = store.current.current?.present;
    if (!readonly && d && pointerPositions.length) {
      const ids = new Set(expandSelection(d, pointerPositions.map(change => change.id)));
      const moved = moveNodes(d, new Map(pointerPositions.map(change => [change.id, next.find(node => node.id === change.id)!.position])));
      next = next.map(node => ids.has(node.id) ? { ...node, position: moved.nodes.find(item => item.id === node.id)!.position } : node);
      const boxes = next.map(node => ({ ...node.data.model, position: node.position }));
      const aligned = alignShapes(boxes.filter(node => ids.has(node.id)), boxes.filter(node => !ids.has(node.id)), { zoom: flow.getZoom(), snapToGrid: d.settings.snapToGrid && !bypassSnapping.current, enabled: alignmentEnabled && !bypassSnapping.current });
      next = next.map(node => ids.has(node.id) ? { ...node, position: { x: node.position.x + aligned.delta.x, y: node.position.y + aligned.delta.y } } : node);
      setGuides(pointerPositions.some(change => change.dragging) ? aligned.guides : []);
    }
    setFlowNodes(next);
    if (resizing.some(change => change.type === 'dimensions' && change.resizing === false)) {
      const session = resizeSession.current;
      resizeSession.current = null; setResizingId(null);
      if (!readonly && d && session?.documentId === d.documentId) {
        const resized = next.find(node => node.id === session.id);
        if (resized) commit({ ...d, nodes: d.nodes.map(node => node.id === session.id ? { ...node, position: resized.position, width: resized.data.model.width, height: resized.data.model.height } : node) });
      }
    } else if (!readonly && !resizeSession.current && !resizing.length && d && positions.length && positions.every(c => c.dragging !== true)) commit(moveNodes(d, new Map(next.map(node => [node.id, node.position]))));
  };
  const moveEnd = (_: MouseEvent | TouchEvent | null, viewport: Viewport) => {
    setZoom(viewport.zoom);
    const d = store.current.current?.present;
    if (d && !readonly && (Math.abs(d.viewport.x - viewport.x) > .01 || Math.abs(d.viewport.y - viewport.y) > .01 || Math.abs(d.viewport.zoom - viewport.zoom) > .0001)) commit({ ...d, viewport }, false);
  };
  const arrange = async () => {
    const snapshot = store.current.current?.present;
    if (!snapshot?.nodes.length || readonly || arrangingRef.current) return;
    arrangingRef.current = true; setArranging(true); clearPaletteDrag();
    try {
      const { autoArrange } = await import('@/lib/auto-layout');
      const arranged = await autoArrange(snapshot);
      const current = store.current.current?.present;
      if (!current || current.documentId !== snapshot.documentId || JSON.stringify([current.nodes, current.edges]) !== JSON.stringify([snapshot.nodes, snapshot.edges])) return;
      store.change({ ...current, nodes: arranged.nodes, edges: arranged.edges });
      if (JSON.stringify([store.current.current?.present.nodes, store.current.current?.present.edges]) !== JSON.stringify([arranged.nodes, arranged.edges])) return;
      setNotice(`Arranged ${arranged.nodes.length} shapes.`);
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (store.current.current?.present.documentId === snapshot.documentId) void flow.fitView({ padding: .2, maxZoom: 1 });
      }));
    } catch (error) {
      store.setError(error instanceof Error ? error.message : 'Could not arrange this diagram. Its current positions have been kept.');
    } finally { arrangingRef.current = false; setArranging(false); }
  };
  const startConnection = () => { if (!doc) return; const source = selectedNodes[0] ?? doc.nodes[0]?.id ?? ''; setConnectionDraft({ source, target: doc.nodes.find(n => n.id !== source)?.id ?? '', sourceHandle: 'bottom', targetHandle: 'top', label: '' }); setConnectionDraftStyle({ ...defaultConnectionStyle }); setModal('connection'); };
  const exportJSON = () => { const d = store.current.current?.present; if (d) { downloadJson(d); setNotice('JSON backup downloaded.'); } };
  const exportAllBackups = async () => {
    if (backupRunning.current) return;
    backupRunning.current = true; setBackingUp(true); setBackupError(''); setNotice('');
    try {
      const { bytes, count } = await prepareAllBackups(store.save, () => diagramRepository.list());
      downloadBackupArchive(bytes);
      setNotice(`Backups downloaded (${count} ${count === 1 ? 'diagram' : 'diagrams'}).`);
    } catch (error) {
      setBackupError(`Backup failed. ${error instanceof Error ? error.message : 'Could not create the ZIP archive. Try again or export individual JSON files.'}`);
    } finally { backupRunning.current = false; setBackingUp(false); }
  };
  const exportSVG = () => { if (doc) { try { downloadSvg(doc); setNotice('SVG downloaded.'); } catch (error) { store.setError(error instanceof Error ? error.message : 'SVG export failed.'); } } };
  const exportPDF = async () => { if (!doc) return; setExporting(true); try { await downloadPdf(doc); setNotice('PDF downloaded.'); } catch (error) { store.setError(error instanceof Error ? error.message : 'PDF export failed.'); } finally { setExporting(false); } };
  const exportPNG = async () => { if (!doc) return; setExporting(true); setNotice('Exporting PNG…'); try { const result = await downloadPng(doc); setNotice(`PNG downloaded (${result.width} × ${result.height}).${result.limited ? ' Size limited; use SVG or PDF for full vector detail.' : ''}`); } catch (e) { setNotice(''); store.setError(e instanceof Error ? e.message : 'PNG export failed. JSON download remains available.'); } finally { setExporting(false); } };
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
  const selectedModels = doc?.nodes.filter(node => selectedNodes.includes(node.id)) ?? [];
  const selectedLocked = selectedModels.some(node => lockedIds.has(node.id));
  const selectedUnits = new Set(selectedModels.filter(node => !lockedIds.has(node.id)).map(node => node.groupId ?? node.id)).size;
  const nodeReadonly = readonly || !!(chosenNode && lockedIds.has(chosenNode.id));
  const visibleShapes = NODE_TYPES.filter(kind => `${NODE_TYPE_LABELS[kind]} ${NODE_DEFINITIONS[kind].keywords}`.toLowerCase().includes(shapeSearch.trim().toLowerCase()));
  const addDrawing = (stroke: DrawingStroke) => {
    const current = store.current.current?.present;
    if (current && !readonly) commit({ ...current, drawings: [...current.drawings, stroke] });
  };
  const eraseDrawings = (ids: string[]) => {
    const current = store.current.current?.present;
    if (current && !readonly && ids.length) commit({ ...current, drawings: current.drawings.filter(stroke => !ids.includes(stroke.id)) });
  };
  const fitContent = () => {
    const current = store.current.current?.present;
    if (!current || (!current.nodes.length && !current.drawings.length)) return;
    const boxes = [...current.nodes.map(node => ({ ...node.position, width: node.width, height: node.height })), ...current.drawings.map(drawingBounds)];
    const left = Math.min(...boxes.map(box => box.x)), top = Math.min(...boxes.map(box => box.y));
    const right = Math.max(...boxes.map(box => box.x + box.width)), bottom = Math.max(...boxes.map(box => box.y + box.height));
    void flow.fitBounds({ x: left, y: top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) }, { padding: .2 });
  };

  if (!doc) return <main className="editor-loading" role="status">Opening editor…</main>;
  const secondaryActions = <>
      <TooltipButton tooltip="Share" wrapperClassName="mobile-share-tooltip" className="button mobile-share-action" onClick={() => setModal('share')} disabled={drawingActive || !!resizingId || edgeEditing}><Share2 size={16} />Share</TooltipButton>
      <span className="toolbar-divider" />
      <TooltipButton className="icon-button" aria-label="Copy selection" tooltip="Copy (⌘/Ctrl C)" disabledReason={!selectedNodes.length ? 'Select a shape' : 'Editing is unavailable'} disabled={!selectedNodes.length || readonly} onClick={() => void copy()}><Copy size={17} /><span className="toolbar-action-label">Copy</span></TooltipButton>
      <TooltipButton className="icon-button" aria-label="Cut selection" tooltip="Cut (⌘/Ctrl X)" disabledReason={selectedLocked ? 'Unlock the selection' : !selectedNodes.length ? 'Select a shape' : 'Editing is unavailable'} disabled={!selectedNodes.length || readonly || selectedLocked} onClick={() => void copy(true)}><Scissors size={17} /><span className="toolbar-action-label">Cut</span></TooltipButton>
      <TooltipButton className="icon-button" aria-label="Paste" tooltip="Paste (⌘/Ctrl V)" disabledReason="Editing is unavailable" disabled={readonly} onClick={() => void paste()}><ClipboardPaste size={17} /><span className="toolbar-action-label">Paste</span></TooltipButton>
      <TooltipButton className="icon-button" aria-label="Duplicate selection" tooltip="Duplicate selection (⌘/Ctrl D)" disabledReason={!selectedNodes.length ? 'Select a shape' : 'Editing is unavailable'} disabled={!selectedNodes.length || readonly} onClick={duplicate}><Copy size={17} /><span className="toolbar-action-label">Duplicate</span></TooltipButton>
      <TooltipButton className="icon-button" aria-label="Delete selection" tooltip="Delete selection (Delete / Backspace)" disabledReason={!hasSelection ? 'Select a shape or connection' : 'Editing is unavailable'} disabled={!hasSelection || readonly} onClick={deleteSelection}><Trash2 size={17} /><span className="toolbar-action-label">Delete</span></TooltipButton>
      <span className="toolbar-divider" />
      <TooltipButton tooltip="Connect nodes" className="button" onClick={startConnection} disabled={doc.nodes.length < 2 || readonly}><Link2 size={16} /><span>Connect nodes</span></TooltipButton>
      <TooltipButton tooltip="Auto arrange" className="button" aria-label="Auto arrange" disabled={!doc.nodes.length || readonly || drawingActive || !!resizingId || edgeEditing} onClick={() => void arrange()}><Workflow size={16} /><span>{arranging ? 'Arranging…' : 'Auto arrange'}</span></TooltipButton>
      <label className="snap-toggle"><input type="checkbox" checked={doc.settings.snapToGrid} disabled={readonly} onChange={e => commit({ ...doc, settings: { ...doc.settings, snapToGrid: e.target.checked } })} />Snap to grid</label>
      <label className="snap-toggle"><input type="checkbox" checked={alignmentEnabled} disabled={readonly} onChange={e => { setAlignmentEnabled(e.target.checked); setGuides([]); try { localStorage.setItem('flowchart:align-shapes', String(e.target.checked)); } catch { /* Optional preference. */ } }} />Align shapes</label>
  </>;
  const fileActions = <>
        <TooltipButton tooltip="Import JSON" className="button" disabled={store.busy || backingUp || arranging || drawingActive || !!resizingId || edgeEditing} onClick={() => file.current?.click()}><ArrowUpFromLine size={15} /><span>Import JSON</span></TooltipButton>
        <TooltipButton tooltip="Export JSON" className="button" onClick={exportJSON}><ArrowDownToLine size={15} /><span>Export JSON</span></TooltipButton>
        <TooltipButton tooltip="Export SVG" className="button" onClick={exportSVG}><ArrowDownToLine size={15} /><span>Export SVG</span></TooltipButton>
        <TooltipButton tooltip="Export PDF" className="button" disabled={exporting} onClick={() => void exportPDF()}><ArrowDownToLine size={15} /><span>Export PDF</span></TooltipButton>
        <TooltipButton tooltip="Export PNG" className="button button-dark" disabled={exporting} onClick={() => void exportPNG()}><ArrowDownToLine size={15} /><span>{exporting ? 'Exporting…' : 'Export PNG'}</span></TooltipButton>
  </>;
  return <main className="editor-shell">
    <header className="editor-header">
      <Link href="/" prefetch={false} className="editor-brand" aria-label={`${PRODUCT.name} home`}><Diamond size={22} strokeWidth={1.8} /><span>{PRODUCT.name}</span></Link>
      <span className="header-divider" />
      <input key={`${doc.documentId}:${doc.title}`} className="document-title" aria-label="Diagram title" defaultValue={doc.title} maxLength={200} disabled={readonly} onBlur={e => { const title = e.target.value.trim(); if (title && title !== doc.title) commit({ ...store.current.current!.present, title }); else e.target.value = doc.title; }} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
      <span className={`save-status ${store.status === 'error' || store.status === 'conflict' ? 'save-error' : ''}`} role="status">{store.status === 'saved' ? <><Check size={13} />Saved on this device</> : store.status === 'saving' ? 'Saving…' : store.status === 'conflict' ? 'Read-only copy' : 'Save failed'}</span>
      <div className="header-actions">
        <TooltipButton tooltip="Share" wrapperClassName="desktop-share-tooltip" className="button desktop-share-action" onClick={() => setModal('share')} disabled={drawingActive || !!resizingId || edgeEditing}><Share2 size={16} />Share</TooltipButton>
        <TooltipButton tooltip="View Mermaid code" className="button code-toggle" aria-label="Code" aria-pressed={codeOpen} onClick={() => { setCodeOpen(!codeOpen); setPalette(false); }}><Code2 size={16} /><span>Code</span></TooltipButton>
        <TooltipButton tooltip="Documents" wrapperClassName="" className="button documents-toggle" aria-label="Documents" disabled={arranging || drawingActive || !!resizingId || edgeEditing} onClick={() => setModal('documents')}><Files size={15} /><span>Documents</span></TooltipButton>
      </div>
    </header>
    <div className="editor-toolbar" role="toolbar" aria-label="Diagram tools">
      <TooltipButton tooltip="Shapes" wrapperClassName="palette-toggle-tooltip" className="button palette-toggle" onClick={() => { setPalette(!palette); setCodeOpen(false); }} aria-expanded={palette}><Shapes size={16} />Shapes</TooltipButton>
      <TooltipButton className="icon-button" aria-label="Undo" tooltip="Undo (⌘/Ctrl Z)" disabledReason={!store.canUndo ? 'No changes to undo' : 'Finish the current action first'} disabled={!store.canUndo || readonly || drawingActive || !!resizingId || edgeEditing} onClick={store.undo}><Undo2 size={18} /></TooltipButton>
      <TooltipButton className="icon-button" aria-label="Redo" tooltip="Redo (⌘/Ctrl Shift Z)" disabledReason={!store.canRedo ? 'No changes to redo' : 'Finish the current action first'} disabled={!store.canRedo || readonly || drawingActive || !!resizingId || edgeEditing} onClick={store.redo}><Redo2 size={18} /></TooltipButton>
      <div className="toolbar-secondary">{secondaryActions}</div>
      <div className="toolbar-end">{fileActions}</div>
      <TooltipButton tooltip="Actions" wrapperClassName="mobile-actions-tooltip" className="button mobile-actions-toggle" aria-haspopup="dialog" onClick={() => setModal('actions')} disabled={drawingActive || !!resizingId || edgeEditing}><Ellipsis size={18} />Actions</TooltipButton>
    </div>
    <input ref={file} type="file" accept=".json,application/json" aria-label="Import diagram file" hidden onChange={e => void importFile(e.target.files?.[0])} />
    {store.error && <div className="error-banner" role="alert"><span>{store.error}</span><div>{(store.status === 'error' || store.readonly) && <><button onClick={() => void store.saveCopy()} disabled={store.busy || backingUp}>Save a separate copy</button><button onClick={exportJSON}>Download JSON</button></>}{store.status === 'error' && <button onClick={() => void store.save()}>Retry save</button>}{store.status !== 'error' && !store.readonly && <button aria-label="Dismiss error" onClick={() => store.setError('')}><X size={16} /></button>}</div></div>}
    <div className="editor-body">
      {!codeOpen && <aside className={`shape-palette ${palette ? 'palette-open' : ''}`} aria-label="Shapes">
        <div className="panel-title"><h2>Shapes</h2></div>
        <label className="shape-search"><Search size={14} aria-hidden="true" /><input aria-label="Search shapes" placeholder="Search shapes" value={shapeSearch} onChange={event => setShapeSearch(event.target.value)} />{shapeSearch && <button className="icon-button" aria-label="Clear shape search" onClick={() => setShapeSearch('')}><X size={13} /></button>}</label>
        <div className="shape-library">{[...new Set(Object.values(NODE_DEFINITIONS).map(definition => definition.group))].map(group => {
          const kinds = visibleShapes.filter(kind => NODE_DEFINITIONS[kind].group === group);
          const expanded = !!shapeSearch.trim() || expandedShapeGroups.includes(group);
          return kinds.length ? <section className="shape-group" key={group} aria-label={`${group} shapes`}><h3><button type="button" className="shape-group-toggle" aria-label={`${group} shapes`} aria-expanded={expanded} aria-controls={`shape-group-${group.replaceAll(' ', '-')}`} onClick={() => { if (shapeSearch) setShapeSearch(''); setExpandedShapeGroups(previous => expanded ? previous.filter(name => name !== group) : [...previous, group]); }}><span>{group}</span><span className="shape-group-count" aria-hidden="true">{kinds.length}</span><ChevronDown size={12} aria-hidden="true" /></button></h3><div className="shape-options" id={`shape-group-${group.replaceAll(' ', '-')}`} hidden={!expanded}>{kinds.map(kind => {
            const shape = NODE_DEFINITIONS[kind];
            return <button key={kind} className="shape-option" aria-label={`Add ${NODE_TYPE_LABELS[kind]}`} title={NODE_TYPE_LABELS[kind]} disabled={readonly} draggable={false}
              onClick={event => { if (suppressPaletteClick.current && event.detail > 0) { event.preventDefault(); return; } addNode(kind); }}
              onPointerDown={event => startPaletteDrag(event, kind)} onPointerMove={movePaletteDrag} onPointerUp={finishPaletteDrag}
              onPointerCancel={clearPaletteDrag} onLostPointerCapture={clearPaletteDrag} onDragStart={event => event.preventDefault()}>
              <svg width="42" height="28" viewBox={`-3 -3 ${shape.width + 6} ${shape.height + 6}`} aria-hidden="true"><path d={nodePath(kind, shape.width, shape.height)} fill="white" stroke="currentColor" strokeWidth="1.25" vectorEffect="non-scaling-stroke" /></svg><span>{NODE_TYPE_LABELS[kind]}</span>
            </button>;
          })}</div></section> : null;
        })}{!visibleShapes.length && <p className="no-shapes">No shapes found.</p>}</div>
        <div className="palette-bottom" hidden={exampleDismissed}><button className="button" disabled={readonly} onClick={async () => { await store.add(exampleDiagram()); select([], []); }}><FilePlus2 size={16} />Programming example</button><button className="icon-button dismiss-example" aria-label="Dismiss programming example" onClick={() => { setExampleDismissed(true); try { localStorage.setItem('flowchart:hide-example', 'true'); } catch { /* Optional preference. */ } }}><X size={14} /></button></div>
      </aside>}
      {codeOpen && <CodePanel diagram={doc} onClose={() => setCodeOpen(false)} />}
      <section ref={canvas} className={`canvas canvas-tool-${effectiveTool}${palettePreview && !readonly ? ' canvas-drop-ready' : ''}`} aria-label="Diagram canvas">
        <ReactFlow<FlowNode> proOptions={{ hideAttribution: true }} nodes={displayNodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} onNodesChange={onNodesChange} onEdgesChange={changes => { for (const change of changes) if (change.type === 'select') setSelectedEdges(prev => change.selected ? [...new Set([...prev, change.id])] : prev.filter(id => id !== change.id)); }}
          onSelectionChange={onSelectionChange} onNodeClick={(_, node) => { if (node.data.model.groupId) select([node.id], []); }} onNodeDragStart={event => { bypassSnapping.current = 'altKey' in event && event.altKey; }}
          onConnect={connection => connect(connection)} onReconnect={(old, connection) => updateEdge(old.id, { source: connection.source, target: connection.target, sourceHandle: (connection.sourceHandle as HandleId) ?? 'bottom', targetHandle: (connection.targetHandle as HandleId) ?? 'top' })}
          onNodeDoubleClick={(_, node) => { select([node.id], []); setTimeout(() => document.getElementById('node-label')?.focus(), 0); }}
          connectionMode={ConnectionMode.Loose} nodesDraggable={!readonly && !spaceHeld && (tool === 'pan' || tool === 'select')} nodesConnectable={!readonly && (effectiveTool === 'pan' || effectiveTool === 'select')} edgesReconnectable={!readonly && (effectiveTool === 'pan' || effectiveTool === 'select')} deleteKeyCode={null} multiSelectionKeyCode={['Meta', 'Control', 'Shift']} selectionOnDrag={effectiveTool === 'select'} selectionMode={SelectionMode.Partial} panOnDrag={effectiveTool === 'pan' ? [0, 1, 2] : [1, 2]} panActivationKeyCode="Space" selectionKeyCode="Shift" zoomOnDoubleClick={false} minZoom={.1} maxZoom={4} snapToGrid={false} snapGrid={[16,16]} defaultViewport={doc.viewport} onMove={(_, vp) => setZoom(vp.zoom)} onMoveEnd={moveEnd} onlyRenderVisibleElements={false}>
          {doc.settings.background === 'dots' && <Background id="dots" variant={BackgroundVariant.Dots} gap={16} size={1} color="#d2d2d2" />}
          {doc.settings.background === 'graph' && <><Background id="graph-minor" variant={BackgroundVariant.Lines} gap={16} lineWidth={.5} color="#e3e3e3" /><Background id="graph-major" variant={BackgroundVariant.Lines} gap={80} lineWidth={1} color="#c9c9c9" /></>}
          <DrawingOverlay key={doc.documentId} strokes={doc.drawings} mode={effectiveTool} color={penColor} width={penWidth} disabled={readonly || !!modal} onAdd={addDrawing} onErase={eraseDrawings} onDrawingChange={setDrawingActive} />
          <Panel position="top-center" className="canvas-toolbox" role="toolbar" aria-label="Canvas tools">
            {([{ mode: 'pan', label: 'Pan', shortcut: 'H', Icon: Hand }, { mode: 'select', label: 'Select', shortcut: 'V', Icon: MousePointer2 }, { mode: 'draw', label: 'Draw', shortcut: 'P', Icon: Pencil }, { mode: 'erase', label: 'Eraser', shortcut: 'E', Icon: Eraser }] as const).map(({ mode, label, shortcut, Icon }) => <TooltipButton key={mode} className={`icon-button${effectiveTool === mode ? ' active' : ''}`} aria-label={label} aria-pressed={effectiveTool === mode} tooltip={`${label} (${shortcut})`} disabled={drawingActive || (readonly && (mode === 'draw' || mode === 'erase'))} onClick={() => { setTool(mode); if (mode === 'draw' || mode === 'erase') select([], []); }}><Icon size={18} /></TooltipButton>)}
            {tool === 'draw' && <div className="pen-options"><label>Width<select aria-label="Pen width" value={penWidth} onChange={event => setPenWidth(Number(event.target.value))}>{[1, 3, 6, 12].map(width => <option key={width} value={width}>{width} px</option>)}</select></label><label>Color<select aria-label="Pen color" value={penColor} onChange={event => setPenColor(event.target.value as ColorName)}>{COLORS.map(color => <option key={color} value={color}>{color === 'neutral' ? 'Black' : COLOR_LABELS[color]}</option>)}</select></label></div>}
          </Panel>
          {!doc.nodes.length && !doc.drawings.length && effectiveTool !== 'draw' && effectiveTool !== 'erase' && <Panel position="top-center" className="empty-canvas"><MousePointer2 size={22} /><h1>Blank diagram</h1><p>Choose a shape to start drawing.</p>{!exampleDismissed && <button className="text-button" onClick={async () => { await store.add(exampleDiagram()); }}>Open programming example</button>}</Panel>}
          <Panel position="bottom-left" className="canvas-controls"><TooltipButton className="icon-button" aria-label="Zoom out" tooltip="Zoom out" onClick={() => void flow.zoomOut()}><Minus size={16} /></TooltipButton><span aria-label="Zoom level">{Math.round(zoom * 100)}%</span><TooltipButton className="icon-button" aria-label="Zoom in" tooltip="Zoom in" onClick={() => void flow.zoomIn()}><Plus size={16} /></TooltipButton><span className="toolbar-divider" /><TooltipButton className="icon-button" aria-label="Fit view" tooltip="Fit diagram" onClick={fitContent}><Maximize size={16} /></TooltipButton><label className="background-control"><span>Background</span><select aria-label="Background" value={doc.settings.background} disabled={readonly} onChange={event => commit({ ...doc, settings: { ...doc.settings, background: event.target.value as CanvasBackground, gridVisible: event.target.value !== 'blank' } })}><option value="dots">Dot grid</option><option value="graph">Graph paper</option><option value="blank">Blank</option></select></label></Panel>
        </ReactFlow>
        {!readonly && <AlignmentOverlay guides={guides} preview={palettePreview} />}
      </section>
      {hasSelection && <aside className="properties-panel" aria-label="Properties"><div className="panel-title"><h2>{chosenNode ? NODE_TYPE_LABELS[chosenNode.type] : chosenEdge ? 'Connection' : 'Selection'}</h2><button className="icon-button" aria-label="Clear selection" onClick={() => select([], [])}><X size={16} /></button></div>
        {chosenNode && <div className="property-fields" key={chosenNode.id}>
          <label>Label<textarea id="node-label" aria-label="Node label" defaultValue={chosenNode.label} key={`${chosenNode.id}:${chosenNode.label}`} maxLength={4000} disabled={nodeReadonly} onBlur={e => { if (e.target.value !== chosenNode.label) updateNode(chosenNode.id, growLabel(chosenNode, e.target.value)); }} rows={4} /></label>
          <label>Notes<textarea aria-label="Notes" defaultValue={chosenNode.notes} key={`${chosenNode.id}:${chosenNode.notes}`} maxLength={20000} disabled={nodeReadonly} onBlur={e => { if (e.target.value !== chosenNode.notes) updateNode(chosenNode.id, { notes: e.target.value }); }} rows={4} /></label><p className="field-hint">Notes are saved in JSON. They do not appear on the canvas or PNG.</p>
          <fieldset className="color-options" disabled={nodeReadonly}><legend>Color</legend>{COLORS.map(color => <button key={color} className="color-choice" aria-label={COLOR_LABELS[color]} aria-pressed={chosenNode.style.color === color} style={{ background: colorValues(color).fill, borderColor: colorValues(color).stroke }} onClick={() => updateNode(chosenNode.id, { style: { color } })}>{chosenNode.style.color === color && <Check size={14} />}</button>)}</fieldset>
          <button className="button" disabled={doc.nodes.length < 2 || readonly} onClick={startConnection}><Link2 size={15} />Connect node</button>
        </div>}
        {chosenEdge && <div className="property-fields" key={chosenEdge.id}><label>Label<textarea aria-label="Connection label" defaultValue={chosenEdge.label} key={`${chosenEdge.id}:${chosenEdge.label}`} maxLength={4000} rows={3} disabled={readonly} onBlur={e => { if (e.target.value !== chosenEdge.label) updateEdge(chosenEdge.id, { label: e.target.value }); }} /></label>
          {(['source','target'] as const).map(side => <div className="connection-end" key={side}><label>{side === 'source' ? 'From' : 'To'}<select aria-label={side === 'source' ? 'Connection source' : 'Connection target'} value={chosenEdge[side]} disabled={readonly} onChange={e => updateEdge(chosenEdge.id, { [side]: e.target.value })}>{doc.nodes.map(n => <option key={n.id} value={n.id}>{n.label.slice(0,50) || NODE_TYPE_LABELS[n.type]}</option>)}</select></label><label>Connection point<select aria-label={`${side} handle`} value={chosenEdge[`${side}Handle`]} disabled={readonly} onChange={e => updateEdge(chosenEdge.id, { [`${side}Handle`]: e.target.value as HandleId })}>{HANDLES.map(h => <option key={h} value={h}>{h}</option>)}</select></label></div>)}
        </div>}
        {chosenEdge && <div className="property-fields"><ConnectorStylePicker value={chosenEdge.style} disabled={readonly} onChange={style => updateEdge(chosenEdge.id, { style })} /><button type="button" className="button" disabled={readonly} onClick={() => { setDefaultConnectionStyle({ ...chosenEdge.style }); setNotice('Connection style set as default'); }}>Use for new connections</button></div>}
        {chosenEdge && <div className="property-fields"><button className="button" aria-label="Reset connection route" disabled={readonly || !chosenEdge.waypoints?.length} onClick={() => updateEdge(chosenEdge.id, { waypoints: [] })}>Reset route</button><p className="field-hint">Drag a point on the selected connection to change its route. Double-click a bend to remove it.</p></div>}
        {selectedNodes.length > 0 && <div className="selection-tools">
          <div className="selection-actions"><button className="button" aria-label="Group selection" disabled={readonly || selectedLocked || selectedUnits < 2} onClick={() => groupSelected()}><Group size={15} />Group</button><button className="button" aria-label="Ungroup selection" disabled={readonly || selectedLocked || !selectedModels.some(node => node.groupId)} onClick={() => groupSelected(true)}><Ungroup size={15} />Ungroup</button></div>
          <div className="selection-actions"><button className="button" aria-label="Lock selection" disabled={readonly || selectedModels.every(node => lockedIds.has(node.id))} onClick={() => lockSelected(true)}><LockKeyhole size={15} />Lock</button><button className="button" aria-label="Unlock selection" disabled={readonly || !selectedLocked} onClick={() => lockSelected(false)}><Unlock size={15} />Unlock</button></div>
          {selectedUnits > 1 && <><h3>Align</h3><div className="align-buttons">{(['left', 'center', 'right', 'top', 'middle', 'bottom'] as const).map(mode => <button className="button" key={mode} aria-label={`Align ${mode}`} disabled={readonly} onClick={() => arrangeSelected(mode)}>{mode[0].toUpperCase() + mode.slice(1)}</button>)}</div><h3>Distribute</h3><div className="selection-actions"><button className="button" aria-label="Distribute horizontally" disabled={readonly || selectedUnits < 3} onClick={() => arrangeSelected('horizontal')}>Horizontally</button><button className="button" aria-label="Distribute vertically" disabled={readonly || selectedUnits < 3} onClick={() => arrangeSelected('vertical')}>Vertically</button></div></>}
        </div>}
        {!chosenNode && !chosenEdge && <p className="selection-count">{selectedNodes.length} shapes · {selectedEdges.length} connections</p>}
        <div className="properties-actions"><button className="button" onClick={duplicate} disabled={!selectedNodes.length || readonly}><Copy size={15} />Duplicate</button><button className="button danger" onClick={deleteSelection} disabled={readonly || selectedLocked}><Trash2 size={15} />Delete</button></div>
      </aside>}
    </div>
    {paletteLabel && !readonly && <div className="palette-drag-label" aria-hidden="true" style={{ left: paletteLabel.x + 14, top: paletteLabel.y + 14 }}>{NODE_TYPE_LABELS[paletteLabel.kind]}</div>}
    <footer className="editor-footer"><span>{doc.nodes.length} shapes<span className="footer-dot">·</span>{doc.edges.length} connections{doc.drawings.length > 0 && <><span className="footer-dot">·</span>{doc.drawings.length} strokes</>}</span><span className="footer-notice" aria-live="polite">{notice}</span><button className="text-button" disabled={drawingActive} onClick={() => setModal('help')}>Local storage & help</button></footer>
    {modal === 'share' && <ShareDialog diagram={doc} onClose={() => setModal(null)} />}
    {modal === 'actions' && <Modal title="Actions" icon={<Ellipsis size={20} />} onClose={() => setModal(null)}><div className="mobile-action-menu" onClick={event => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
      if (button && !button.disabled) setModal(current => current === 'actions' ? null : current);
    }}><section><h3>Edit and arrange</h3><div className="mobile-actions">{secondaryActions}</div></section><section><h3>Files</h3><div className="mobile-actions">{fileActions}</div></section></div></Modal>}
    {modal === 'help' && <Modal title="Local storage & help" icon={<CircleHelp size={20} />} onClose={() => setModal(null)}><div className="help-content"><button className="button" disabled={readonly} onClick={async () => { await store.add(exampleDiagram()); select([], []); setModal(null); }}><FilePlus2 size={16} />Open programming example</button><h3>Drawing</h3><p>Click a sidebar shape to add it, or drag it onto the canvas to preview and place it. Drag canvas shapes to move them. Select one shape and drag a corner to resize it; labels reflow and connections follow. Each resize is one undo step. Press Escape before releasing to cancel. Alignment guides snap nearby edges and centers; hold Option (Alt) to bypass snapping. Copy and paste shapes with ⌘/Ctrl C and V, including between documents. Group a selection with ⌘/Ctrl G; Shift adds Ungroup. Lock shapes to prevent edits. Align and Distribute controls appear for multiple selected shapes. Auto arrange positions the whole diagram from top to bottom and can be undone in one step. Click a label to select its shape and edit it in Properties. Changes apply when you leave the field.</p><p>Select a connection and drag its circular controls to add bends; drag square controls to move bends, or double-click to remove them. Automatic routes avoid other shapes when space permits. Drag between connection points, or use Connect nodes to choose endpoints and labels. Multiple branches, merges, and multi-node loops work. Same-node loops are not supported.</p><h3>Freehand drawing</h3><p>Choose Draw to sketch with a mouse, touch, or pen. Supported pens vary stroke width with pressure. Eraser removes whole strokes; each gesture can be undone. Hold Space to pan while drawing. Choose Dot grid, Graph paper, or Blank from Background. Drawings and backgrounds are saved and included in PNG exports.</p><h3>Canvas and keyboard</h3><p>Drag empty canvas to pan. Use Select or Shift + drag to select a group. Hold Space to pan from any tool. Use the mouse wheel to zoom. ⌘/Ctrl + click or Shift + click adds to a selection. Focus a shape and use arrow keys to move it.</p><dl className="shortcuts"><dt>Undo / redo</dt><dd>⌘/Ctrl Z / Shift Z</dd><dt>Duplicate</dt><dd>⌘/Ctrl D</dd><dt>Select all</dt><dd>⌘/Ctrl A</dd><dt>Delete selection</dt><dd>Delete / Backspace</dd></dl><h3>Local files</h3><p>Diagrams save in this browser on this device. Clearing browser data or storage eviction can remove them. Export JSON for an editable backup, or use Download all backups in Documents for a ZIP containing one JSON file per diagram. Import a JSON file to create a new document. PNG and SVG include the whole diagram. SVG stays vector. PDF preserves vector shapes and embedded text on a page sized to the diagram; unsupported scripts and emoji use high-resolution label images.</p><p>Editing and saving continue if you disconnect after loading. Reopening offline is not supported yet. Editing and local saves do not upload diagram content. Share creates an encrypted snapshot that expires after 24 hours. Anyone with its link can view it or save a separate copy.</p><Link href="/privacy" target="_blank">Privacy and storage details</Link><p>Diagram canvas: <a href="https://reactflow.dev" target="_blank" rel="noreferrer">React Flow</a> · <a href="/licenses/react-flow.txt" target="_blank" rel="noreferrer">MIT license</a></p><p><a href="/licenses/elkjs.txt" target="_blank" rel="noreferrer">Layout engine license and source</a></p></div></Modal>}
    {modal === 'documents' && <Modal title="Documents" icon={<Files size={20} />} onClose={() => setModal(null)}><div className="document-actions"><button className="button button-dark" disabled={store.busy || backingUp} onClick={async () => { await store.add(newDiagram()); setModal(null); }}><Plus size={16} />New diagram</button><button className="button" disabled={store.busy || backingUp} onClick={async () => { await store.saveCopy(); setModal(null); }}><Copy size={15} aria-hidden="true" />Duplicate document</button><button className="button danger" disabled={readonly} onClick={() => setModal('delete')}><Trash2 size={15} aria-hidden="true" />Delete document</button></div><div className="backup-actions"><button className="button" disabled={store.busy || backingUp} onClick={() => void exportAllBackups()}><ArrowDownToLine size={15} aria-hidden="true" />{backingUp ? 'Preparing backups…' : 'Download all backups'}</button><p className="storage-copy">ZIP with one editable JSON file per diagram stored in this browser.</p></div>{backupError && <p className="backup-error" role="alert">{backupError}</p>}<ul className="document-list">{store.documents.map(d => <li key={d.documentId}><button className={d.documentId === doc.documentId ? 'current-document' : ''} disabled={store.busy || backingUp} onClick={async () => { await store.switchTo(d.documentId); setModal(null); }}><Files size={18} /><span><strong>{d.title}</strong><small>{d.nodes.length} shapes · {new Date(d.updatedAt).toLocaleDateString()}</small></span>{d.documentId === doc.documentId && <Check size={16} />}</button></li>)}</ul><button className="button" onClick={() => { setModal(null); setTimeout(() => document.querySelector<HTMLInputElement>('[aria-label="Diagram title"]')?.focus(),0); }} disabled={readonly}><Pencil size={14} aria-hidden="true" />Rename current document</button></Modal>}
    {modal === 'delete' && <Modal title="Delete document" restoreFocusTo=".documents-toggle" icon={<Trash2 size={20} />} onClose={() => setModal(null)}><p>Delete “{doc.title}” from this device? This cannot be undone. Download JSON first if you want a backup.</p><div className="dialog-actions"><button className="button" onClick={exportJSON}>Download JSON</button><button className="button" onClick={() => setModal(null)}>Cancel</button><button className="button button-dark" disabled={store.busy || backingUp} onClick={async () => { await store.remove(); setModal(null); }}>Delete permanently</button></div></Modal>}
    {modal === 'connection' && <Modal title="Connect nodes" restoreFocusTo=".mobile-actions-toggle" icon={<Link2 size={20} />} onClose={() => setModal(null)}><form className="connection-form" onSubmit={e => { e.preventDefault(); if (connectionDraft.source === connectionDraft.target) return; connect(connectionDraft, connectionDraft.label, connectionDraftStyle); setDefaultConnectionStyle({ ...connectionDraftStyle }); setModal(null); }}>
      {(['source','target'] as const).map(side => <div key={side} className="connection-end"><label>{side === 'source' ? 'From' : 'To'}<select aria-label={side === 'source' ? 'From node' : 'To node'} value={connectionDraft[side]} onChange={e => setConnectionDraft({ ...connectionDraft, [side]: e.target.value })}>{doc.nodes.map(n => <option key={n.id} value={n.id}>{n.label.slice(0,80) || NODE_TYPE_LABELS[n.type]}</option>)}</select></label><label>Connection point<select aria-label={`${side} connection point`} value={connectionDraft[`${side}Handle`]} onChange={e => setConnectionDraft({ ...connectionDraft, [`${side}Handle`]: e.target.value as HandleId })}>{HANDLES.map(h => <option key={h} value={h}>{h}</option>)}</select></label></div>)}
      <ConnectorStylePicker value={connectionDraftStyle} onChange={setConnectionDraftStyle} disabled={readonly} />
      <label>Label<input aria-label="New connection label" value={connectionDraft.label} maxLength={4000} placeholder="Yes, No, success…" onChange={e => setConnectionDraft({ ...connectionDraft, label: e.target.value })} /></label><div className="dialog-actions"><button type="button" className="button" onClick={() => setModal(null)}>Cancel</button><button className="button button-dark" disabled={!connectionDraft.source || !connectionDraft.target || connectionDraft.source === connectionDraft.target}>Add connection</button></div></form></Modal>}
  </main>;
}
