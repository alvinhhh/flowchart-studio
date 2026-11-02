import type { ColorName } from './diagram';

export type DrawingPoint = { x: number; y: number; pressure: number };
export type DrawingStroke = { id: string; points: DrawingPoint[]; color: ColorName; width: number };
export type DrawingBounds = { x: number; y: number; width: number; height: number };
type Point = { x: number; y: number };

/** Mouse and tablets without pressure support use the nominal brush width. */
export function drawingPressure(value: number, pointerType = 'pen'): number {
  return pointerType !== 'pen' || !Number.isFinite(value) || value <= 0 ? 0.5 : Math.max(0.05, Math.min(1, value));
}

function radius(stroke: DrawingStroke, point: DrawingPoint): number {
  return Math.max(0.1, Number.isFinite(stroke.width) ? stroke.width : 2) * drawingPressure(point.pressure);
}
function cleanPoints(stroke: DrawingStroke): DrawingPoint[] {
  const result: DrawingPoint[] = [];
  for (const point of stroke.points) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
    const previous = result.at(-1);
    if (previous && Math.hypot(point.x - previous.x, point.y - previous.y) < 0.001) {
      result[result.length - 1] = { ...point, pressure: Math.max(drawingPressure(previous.pressure), drawingPressure(point.pressure)) };
    } else result.push(point);
  }
  return result;
}
const number = (value: number) => String(Math.round(value * 1000) / 1000);
const coordinate = (point: Point) => `${number(point.x)} ${number(point.y)}`;
const midpoint = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

function smoothSide(points: Point[]): string {
  let path = '';
  for (let i = 1; i < points.length; i++) {
    const end = i === points.length - 1 ? points[i] : midpoint(points[i], points[i + 1]);
    path += ` Q ${coordinate(points[i])} ${coordinate(end)}`;
  }
  return path;
}

/** A closed, pressure-sensitive outline shared by the canvas and PNG export. */
export function drawingPath(stroke: DrawingStroke): string {
  const points = cleanPoints(stroke);
  if (!points.length) return '';
  if (points.length === 1) {
    const point = points[0], r = radius(stroke, point);
    return `M ${number(point.x - r)} ${number(point.y)} a ${number(r)} ${number(r)} 0 1 0 ${number(r * 2)} 0 a ${number(r)} ${number(r)} 0 1 0 ${number(-r * 2)} 0 Z`;
  }
  const left: Point[] = [], right: Point[] = [];
  for (let i = 0; i < points.length; i++) {
    const before = points[Math.max(0, i - 1)], after = points[Math.min(points.length - 1, i + 1)];
    let dx = after.x - before.x, dy = after.y - before.y;
    // A stroke can double back exactly on itself; keep a defined normal there.
    if (Math.hypot(dx, dy) < 0.001) { dx = points[i].x - before.x; dy = points[i].y - before.y; }
    const length = Math.hypot(dx, dy) || 1, r = radius(stroke, points[i]);
    const nx = -dy / length * r, ny = dx / length * r;
    left.push({ x: points[i].x + nx, y: points[i].y + ny });
    right.push({ x: points[i].x - nx, y: points[i].y - ny });
  }
  const startRadius = number(radius(stroke, points[0]));
  const endRadius = number(radius(stroke, points.at(-1)!));
  const reversed = [...right].reverse();
  return `M ${coordinate(left[0])}${smoothSide(left)} A ${endRadius} ${endRadius} 0 0 0 ${coordinate(reversed[0])}${smoothSide(reversed)} A ${startRadius} ${startRadius} 0 0 0 ${coordinate(left[0])} Z`;
}

/** Conservative bounds include round caps and every pressure-expanded sample. */
export function drawingBounds(stroke: DrawingStroke): DrawingBounds {
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const point of cleanPoints(stroke)) {
    const r = radius(stroke, point);
    left = Math.min(left, point.x - r); top = Math.min(top, point.y - r);
    right = Math.max(right, point.x + r); bottom = Math.max(bottom, point.y + r);
  }
  return Number.isFinite(left) ? { x: left, y: top, width: right - left, height: bottom - top } : { x: 0, y: 0, width: 0, height: 0 };
}

function pointSegmentDistance(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy);
}
function segmentsDistance(a: Point, b: Point, c: Point, d: Point): number {
  const cross = (p: Point, q: Point, r: Point) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  if (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0) return 0;
  return Math.min(pointSegmentDistance(a, c, d), pointSegmentDistance(b, c, d), pointSegmentDistance(c, a, b), pointSegmentDistance(d, a, b));
}

/** Swept eraser hit test prevents fast pointer movement from skipping ink. */
export function drawingIntersectsSegment(stroke: DrawingStroke, start: Point, end: Point, tolerance: number): boolean {
  const bounds = drawingBounds(stroke);
  if (Math.max(start.x, end.x) + tolerance < bounds.x || Math.min(start.x, end.x) - tolerance > bounds.x + bounds.width || Math.max(start.y, end.y) + tolerance < bounds.y || Math.min(start.y, end.y) - tolerance > bounds.y + bounds.height) return false;
  const points = cleanPoints(stroke);
  for (let i = 0; i < points.length; i++) {
    const a = points[Math.max(0, i - 1)], b = points[i];
    if (segmentsDistance(start, end, a, b) <= tolerance + Math.max(radius(stroke, a), radius(stroke, b))) return true;
  }
  return false;
}
