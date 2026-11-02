'use client';

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { BaseEdge, EdgeLabelRenderer, useReactFlow, type EdgeProps } from '@xyflow/react';
import type { DiagramEdge, DiagramNode } from '@/lib/diagram';
import { colorValues, edgeRoute, labelWidth, wrapLabel, type Point } from '@/lib/geometry';
import { routeDiagramEdge } from '@/lib/routing';

export interface EditableEdgeData {
  model: DiagramEdge;
  nodes: DiagramNode[];
  readonly: boolean;
  onEditingChange?: (active: boolean) => void;
  onWaypointsChange: (edgeId: string, points: Point[]) => void;
}
type Drag = { pointerId: number; element: HTMLButtonElement; points: Point[]; index: number; original: Point[] };
const bounded = (point: Point): Point => ({ x: Math.max(-100000, Math.min(100000, point.x)), y: Math.max(-100000, Math.min(100000, point.y)) });
const equalPoints = (a: Point[], b: Point[]) => a.length === b.length && a.every((point, i) => point.x === b[i].x && point.y === b[i].y);

export function EditableEdge(props: EdgeProps) {
  const data = props.data as unknown as EditableEdgeData | undefined;
  const model = data?.model;
  const [preview, setPreview] = useState<Point[] | null>(null);
  const [activeControl, setActiveControl] = useState<{ key: string; index: number; insert: boolean } | null>(null);
  const drag = useRef<Drag | null>(null);
  const { screenToFlowPosition } = useReactFlow();
  const onEditingChange = data?.onEditingChange;
  const cancel = useCallback(() => {
    const active = drag.current; drag.current = null;
    if (active?.element.hasPointerCapture(active.pointerId)) active.element.releasePointerCapture(active.pointerId);
    setPreview(null);
    setActiveControl(null);
    onEditingChange?.(false);
  }, [onEditingChange]);
  useEffect(() => {
    const escape = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape' && drag.current) { event.preventDefault(); cancel(); } };
    window.addEventListener('keydown', escape); window.addEventListener('blur', cancel);
    return () => { window.removeEventListener('keydown', escape); window.removeEventListener('blur', cancel); if (drag.current) { drag.current = null; onEditingChange?.(false); } };
  }, [cancel, onEditingChange]);
  const waypoints = (props.selected && !data?.readonly ? preview : null) ?? model?.waypoints ?? [];
  const source = data?.nodes.find(node => node.id === model?.source), target = data?.nodes.find(node => node.id === model?.target);
  const route = model && source && target
    ? routeDiagramEdge({ ...model, waypoints }, source, target, data!.nodes, { source: { x: props.sourceX, y: props.sourceY }, target: { x: props.targetX, y: props.targetY } })
    : edgeRoute({ x: props.sourceX, y: props.sourceY }, { x: props.targetX, y: props.targetY }, model?.sourceHandle ?? 'bottom', model?.targetHandle ?? 'top');
  const colors = colorValues(model?.style.color ?? 'neutral');
  const label = model?.label ?? '', lines = wrapLabel(label, 220);
  const width = Math.max(20, ...lines.map(line => labelWidth(line))) + 20;
  const editable = props.selected && data && !data.readonly;

  function begin(event: PointerEvent<HTMLButtonElement>, point: Point, index: number, insert: boolean) {
    if (!editable || event.button !== 0 || drag.current || (insert && waypoints.length >= 64)) return;
    event.preventDefault(); event.stopPropagation();
    const original = model?.waypoints ?? [], points = waypoints.map(point => ({ ...point }));
    if (insert) points.splice(index, 0, point);
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { pointerId: event.pointerId, element: event.currentTarget, points, index, original };
    setPreview(points);
    data?.onEditingChange?.(true);
    setActiveControl({ key: event.currentTarget.dataset.controlKey!, index, insert });
  }
  function move(event: PointerEvent<HTMLButtonElement>) {
    const active = drag.current;
    if (!active || event.pointerId !== active.pointerId) return;
    event.preventDefault(); event.stopPropagation();
    const point = bounded(screenToFlowPosition({ x: event.clientX, y: event.clientY }, { snapToGrid: false }));
    active.points = active.points.map((current, i) => i === active.index ? point : current);
    setPreview(active.points);
  }
  function end(event: PointerEvent<HTMLButtonElement>) {
    const active = drag.current;
    if (!active || event.pointerId !== active.pointerId) return;
    event.preventDefault(); event.stopPropagation();
    drag.current = null;
    if (active.element.hasPointerCapture(active.pointerId)) active.element.releasePointerCapture(active.pointerId);
    setPreview(null);
    setActiveControl(null);
    data?.onEditingChange?.(false);
    if (!data?.readonly && props.selected && !equalPoints(active.original, active.points)) data?.onWaypointsChange(props.id, active.points);
  }
  function keyboard(event: KeyboardEvent<HTMLButtonElement>, point: Point, index: number, insert: boolean) {
    const delta = event.shiftKey ? 10 : 1;
    const offset = event.key === 'ArrowLeft' ? { x: -delta, y: 0 } : event.key === 'ArrowRight' ? { x: delta, y: 0 } : event.key === 'ArrowUp' ? { x: 0, y: -delta } : event.key === 'ArrowDown' ? { x: 0, y: delta } : null;
    if (!offset && !(insert && (event.key === 'Enter' || event.key === ' '))) return;
    event.preventDefault(); event.stopPropagation();
    if (!editable || drag.current || (insert && waypoints.length >= 64)) return;
    const points = waypoints.map(point => ({ ...point }));
    const value = bounded({ x: point.x + (offset?.x ?? 0), y: point.y + (offset?.y ?? 0) });
    if (insert) points.splice(index, 0, value); else points[index] = value;
    data.onWaypointsChange(props.id, points);
  }

  // Preserve segment identity during insertion so the captured button remains mounted throughout the drag.
  const controls = waypoints.map((point, index) => ({ point, index, insert: false, key: `bend-${index}` }));
  if (editable && waypoints.length < 64 && !activeControl) {
    let insertionIndex = 0;
    for (let i = 1; i < route.points.length; i++) {
      const a = route.points[i - 1], b = route.points[i];
      while (insertionIndex < waypoints.length && a.x === waypoints[insertionIndex].x && a.y === waypoints[insertionIndex].y) insertionIndex++;
      if (Math.abs(b.x - a.x) + Math.abs(b.y - a.y) < 40) continue;
      controls.push({ point: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, index: insertionIndex, insert: true, key: `segment-${i}` });
    }
  }
  if (activeControl && !controls.some(control => control.key === activeControl.key)) {
    controls.push({ point: waypoints[activeControl.index], index: activeControl.index, insert: activeControl.insert, key: activeControl.key });
  }

  return <>
    <BaseEdge id={props.id} path={route.path} markerEnd={props.markerEnd} interactionWidth={24} style={{ stroke: props.selected ? '#171717' : colors.stroke, strokeWidth: props.selected ? 2.5 : 1.5 }} />
    <EdgeLabelRenderer>
      {label && <div className="edge-label nodrag nopan" style={{ transform: `translate(-50%, -50%) translate(${route.labelX}px, ${route.labelY}px)`, width }} aria-hidden="true">{lines.map((line, i) => <div key={i}>{line || '\u00a0'}</div>)}</div>}
      {editable && controls.map(({ point, index, insert, key }) => <button key={key} type="button" data-control-key={key}
        className={`edge-bend-control nodrag nopan${insert ? ' is-insert' : ''}`}
        style={{ position: 'absolute', transform: `translate(-50%, -50%) translate(${point.x}px, ${point.y}px)`, pointerEvents: 'all', touchAction: 'none', width: insert ? 14 : 18, height: insert ? 14 : 18, border: '2px solid #333', borderRadius: insert ? '50%' : 4, background: insert ? '#f1f1f1' : '#fff', padding: 0, cursor: 'move', zIndex: insert ? 5 : 6 }}
        aria-label={`${insert ? 'Add' : 'Move'} connection bend ${insert ? key.split('-')[1] : index + 1}`}
        title={insert ? 'Drag to add a bend' : 'Drag to move; double-click to remove'}
        onPointerDown={event => begin(event, point, index, insert)} onPointerMove={move} onPointerUp={end}
        onPointerCancel={cancel} onLostPointerCapture={() => { if (drag.current) cancel(); }}
        onKeyDown={event => keyboard(event, point, index, insert)}
        onClick={event => event.stopPropagation()}
        onDoubleClick={event => { event.preventDefault(); event.stopPropagation(); if (!insert && !drag.current) data.onWaypointsChange(props.id, waypoints.filter((_, i) => i !== index)); }} />)}
    </EdgeLabelRenderer>
  </>;
}
