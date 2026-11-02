'use client';

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useReactFlow, useViewport } from '@xyflow/react';
import type { ColorName } from '@/lib/diagram';
import { drawingIntersectsSegment, drawingPath, drawingPressure, type DrawingPoint, type DrawingStroke } from '@/lib/drawing';
import { colorValues } from '@/lib/geometry';

type Props = {
  strokes: DrawingStroke[];
  mode: 'pan' | 'select' | 'draw' | 'erase';
  color: ColorName;
  width: number;
  disabled?: boolean;
  onAdd: (stroke: DrawingStroke) => void;
  onErase: (ids: string[]) => void;
  onDrawingChange?: (active: boolean) => void;
};
type Gesture = {
  pointerId: number;
  pointerType: string;
  element: HTMLDivElement;
  mode: 'draw' | 'erase';
  stroke: DrawingStroke;
  erased: Set<string>;
  last: DrawingPoint;
  spacing: number;
};
const ink = (color: ColorName) => color === 'neutral' ? '#242424' : colorValues(color).stroke;
const MAX_POINTS = 20_000;

export default function DrawingOverlay({ strokes, mode, color, width, disabled, onAdd, onErase, onDrawingChange }: Props) {
  const flow = useReactFlow();
  const viewport = useViewport();
  const gesture = useRef<Gesture | null>(null);
  const [preview, setPreview] = useState<DrawingStroke | null>(null);
  const [erased, setErased] = useState<Set<string>>(new Set());
  const frame = useRef<number | null>(null);
  const handlers = useRef({ onAdd, onErase, onDrawingChange });
  useEffect(() => { handlers.current = { onAdd, onErase, onDrawingChange }; }, [onAdd, onErase, onDrawingChange]);

  const cancel = useRef(() => {});
  useEffect(() => {
    cancel.current = () => {
      const active = gesture.current;
      if (!active) return;
      gesture.current = null;
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      frame.current = null;
      setPreview(null); setErased(new Set());
      if (active.element.hasPointerCapture(active.pointerId)) active.element.releasePointerCapture(active.pointerId);
      handlers.current.onDrawingChange?.(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && gesture.current) { event.preventDefault(); event.stopPropagation(); cancel.current(); }
    };
    const onBlur = () => cancel.current();
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('blur', onBlur);
      cancel.current();
    };
  }, []);
  useEffect(() => {
    if (gesture.current && (disabled || gesture.current.mode !== mode)) cancel.current();
  }, [disabled, mode]);

  const paths = useMemo(() => strokes.map(stroke => ({ stroke, path: drawingPath(stroke) })), [strokes]);
  function refresh() {
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      const active = gesture.current;
      if (!active) return;
      if (active.mode === 'draw') setPreview({ ...active.stroke, points: [...active.stroke.points] });
      else setErased(new Set(active.erased));
    });
  }
  function sample(event: PointerEvent): DrawingPoint {
    const position = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }, { snapToGrid: false });
    return { ...position, pressure: drawingPressure(event.pressure, event.pointerType) };
  }
  function accumulate(event: PointerEvent) {
    const active = gesture.current;
    if (!active || event.pointerId !== active.pointerId) return;
    const coalesced = event.getCoalescedEvents?.() ?? [];
    // Some tablet drivers deliver very large batches after a busy frame.
    const samples = coalesced.length ? coalesced : [event];
    const stride = Math.max(1, Math.ceil(samples.length / 256));
    for (let index = 0; index < samples.length; index += stride) consume(sample(samples[index]));
    if (samples.at(-1) !== event) consume(sample(event));
    refresh();
  }
  function consume(point: DrawingPoint) {
    const active = gesture.current;
    if (!active || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
    if (active.mode === 'erase') {
      for (const stroke of strokes) {
        if (!active.erased.has(stroke.id) && drawingIntersectsSegment(stroke, active.last, point, 10 / viewport.zoom)) active.erased.add(stroke.id);
      }
    } else {
      const points = active.stroke.points;
      const previous = points.at(-1)!;
      if (Math.hypot(previous.x - point.x, previous.y - point.y) >= active.spacing || Math.abs(previous.pressure - point.pressure) >= 0.04) {
        if (points.length >= MAX_POINTS) {
          // Keep the complete gesture at reduced resolution, rather than truncating it.
          active.stroke.points = points.filter((_, index) => index % 2 === 0);
          active.spacing *= 2;
        }
        active.stroke.points.push(point);
      }
    }
    active.last = point;
  }
  function start(event: ReactPointerEvent<HTMLDivElement>) {
    if (gesture.current?.pointerType === 'pen' && event.pointerType === 'touch') { event.preventDefault(); event.stopPropagation(); return; }
    if (disabled || (mode !== 'draw' && mode !== 'erase') || !event.isPrimary || event.button !== 0 || (event.buttons & 2)) return;
    if (gesture.current) {
      // A pen takes precedence over a finger already touching the tablet.
      if (event.pointerType === 'pen' && gesture.current.pointerType === 'touch') cancel.current();
      else return;
    }
    event.preventDefault(); event.stopPropagation();
    const point = sample(event.nativeEvent);
    const active: Gesture = {
      pointerId: event.pointerId, pointerType: event.pointerType, element: event.currentTarget, mode,
      stroke: { id: crypto.randomUUID(), points: [point], color, width }, erased: new Set(), last: point,
      spacing: 0.35 / viewport.zoom,
    };
    gesture.current = active;
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* Synthetic input has no active pointer to capture. */ }
    handlers.current.onDrawingChange?.(true);
    if (mode === 'draw') setPreview({ ...active.stroke });
    else { consume(point); refresh(); }
  }
  function move(event: ReactPointerEvent<HTMLDivElement>) {
    if (gesture.current?.pointerType === 'pen' && event.pointerType === 'touch') { event.preventDefault(); event.stopPropagation(); return; }
    if (!gesture.current || event.pointerId !== gesture.current.pointerId) return;
    if (event.buttons & 2) { cancel.current(); return; }
    event.preventDefault(); event.stopPropagation();
    accumulate(event.nativeEvent);
  }
  function finish(event: ReactPointerEvent<HTMLDivElement>) {
    const active = gesture.current;
    if (!active || active.pointerId !== event.pointerId) return;
    event.preventDefault(); event.stopPropagation();
    // Pointer-up pressure is commonly zero; retain the final contact pressure.
    const endpoint = sample(event.nativeEvent);
    endpoint.pressure = active.last.pressure;
    consume(endpoint);
    if (active.mode === 'draw' && Math.hypot(active.stroke.points.at(-1)!.x - endpoint.x, active.stroke.points.at(-1)!.y - endpoint.y) > 0.001) {
      if (active.stroke.points.length < MAX_POINTS) active.stroke.points.push(endpoint);
      else active.stroke.points[active.stroke.points.length - 1] = endpoint;
    }
    gesture.current = null;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    setPreview(null); setErased(new Set());
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (active.mode === 'draw') handlers.current.onAdd(active.stroke);
    else if (active.erased.size) handlers.current.onErase([...active.erased]);
    handlers.current.onDrawingChange?.(false);
  }
  const active = !disabled && (mode === 'draw' || mode === 'erase');
  return <>
    <svg className="drawing-overlay" aria-hidden="true" width="100%" height="100%" style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'visible', zIndex: 0 }}>
      <g transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.zoom})`}>
        {paths.map(({ stroke, path }) => !erased.has(stroke.id) && <path className="drawing-stroke" data-stroke-id={stroke.id} key={stroke.id} d={path} fill={ink(stroke.color)} />)}
        {preview && <path className="drawing-preview" d={drawingPath(preview)} fill={ink(preview.color)} />}
      </g>
    </svg>
    {active && <div className="drawing-input" aria-hidden="true" style={{ position: 'absolute', inset: 0, zIndex: 4, touchAction: 'none', cursor: mode === 'draw' ? 'crosshair' : 'cell' }}
      onPointerDown={start} onPointerMove={move} onPointerUp={finish}
      onPointerCancel={event => { if (event.pointerId === gesture.current?.pointerId) cancel.current(); }}
      onLostPointerCapture={event => { if (event.pointerId === gesture.current?.pointerId) cancel.current(); }} />}
  </>;
}
