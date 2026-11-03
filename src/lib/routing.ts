import type { DiagramEdge, DiagramNode, HandleId } from './diagram';
import { edgeRoute, handlePoint, type Point } from './geometry';

export type { Point } from './geometry';
export interface DiagramRoute { path: string; points: Point[]; labelX: number; labelY: number }
type Box = { left: number; right: number; top: number; bottom: number };
const CLEARANCE = 16;
const MAX_GRID_POINTS = 180_000;
const directions: Record<HandleId, Point> = { top: { x: 0, y: -1 }, right: { x: 1, y: 0 }, bottom: { x: 0, y: 1 }, left: { x: -1, y: 0 } };
const distance = (a: Point, b: Point) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const same = (a: Point, b: Point) => a.x === b.x && a.y === b.y;
const bounds = (node: DiagramNode): Box => ({ left: node.position.x - CLEARANCE, right: node.position.x + node.width + CLEARANCE, top: node.position.y - CLEARANCE, bottom: node.position.y + node.height + CLEARANCE });
const inside = (point: Point, box: Box) => point.x > box.left && point.x < box.right && point.y > box.top && point.y < box.bottom;
function clear(a: Point, b: Point, boxes: Box[]): boolean {
  if (a.x !== b.x && a.y !== b.y) return false;
  return !boxes.some(box => a.x === b.x
    ? a.x > box.left && a.x < box.right && Math.max(a.y, b.y) > box.top && Math.min(a.y, b.y) < box.bottom
    : a.y > box.top && a.y < box.bottom && Math.max(a.x, b.x) > box.left && Math.min(a.x, b.x) < box.right);
}
function simplify(points: Point[]): Point[] {
  const result: Point[] = [];
  for (const point of points) {
    if (result.length && same(result[result.length - 1], point)) continue;
    while (result.length > 1) {
      const a = result[result.length - 2], b = result[result.length - 1];
      if ((a.x === b.x && b.x === point.x && (b.y - a.y) * (point.y - b.y) >= 0) || (a.y === b.y && b.y === point.y && (b.x - a.x) * (point.x - b.x) >= 0)) result.pop();
      else break;
    }
    result.push(point);
  }
  return result;
}
function finish(points: Point[]): DiagramRoute {
  const clean = points.filter((point, i) => !i || !same(point, points[i - 1]));
  let remaining = clean.slice(1).reduce((sum, point, i) => sum + distance(clean[i], point), 0) / 2;
  let label = clean[0];
  for (let i = 1; i < clean.length; i++) {
    const a = clean[i - 1], b = clean[i], length = distance(a, b);
    if (remaining <= length) { const t = length ? remaining / length : 0; label = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }; break; }
    remaining -= length;
  }
  return { points: clean, path: clean.map((point, i) => `${i ? 'L' : 'M'} ${point.x} ${point.y}`).join(' '), labelX: label.x, labelY: label.y };
}

type Entry = { id: number; cost: number; score: number };
class Queue {
  items: Entry[] = [];
  less(a: Entry, b: Entry) { return a.score < b.score || (a.score === b.score && (a.cost < b.cost || (a.cost === b.cost && a.id < b.id))); }
  push(value: Entry) {
    const items = this.items; let i = items.length; items.push(value);
    while (i) { const parent = (i - 1) >> 1; if (!this.less(value, items[parent])) break; items[i] = items[parent]; i = parent; } items[i] = value;
  }
  pop(): Entry | undefined {
    const items = this.items, first = items[0], last = items.pop();
    if (items.length && last) { let i = 0; while (true) { let child = i * 2 + 1; if (child >= items.length) break; if (child + 1 < items.length && this.less(items[child + 1], items[child])) child++; if (!this.less(items[child], last)) break; items[i] = items[child]; i = child; } items[i] = last; }
    return first;
  }
}

/** Coordinate-compressed orthogonal A*. Rectangle range sums keep the search independent of obstacle count. */
function search(a: Point, b: Point, boxes: Box[]): Point[] | undefined {
  const xs = [...new Set([a.x, b.x, ...boxes.flatMap(box => [box.left, box.right])])].sort((x, y) => x - y);
  const ys = [...new Set([a.y, b.y, ...boxes.flatMap(box => [box.top, box.bottom])])].sort((x, y) => x - y);
  const nx = xs.length, ny = ys.length, count = nx * ny;
  // Very large imports and overlapping enclosed endpoints use the deterministic fallback below.
  if (count > MAX_GRID_POINTS) return undefined;
  const xIndex = new Map(xs.map((x, i) => [x, i])), yIndex = new Map(ys.map((y, i) => [y, i]));
  const stride = nx + 1, cells = stride * (ny + 1);
  const horizontal = new Int32Array(cells), vertical = new Int32Array(cells);
  function mark(array: Int32Array, x1: number, y1: number, x2: number, y2: number) {
    if (x1 >= x2 || y1 >= y2) return;
    array[y1 * stride + x1]++; array[y1 * stride + x2]--; array[y2 * stride + x1]--; array[y2 * stride + x2]++;
  }
  for (const box of boxes) {
    const l = xIndex.get(box.left)!, r = xIndex.get(box.right)!, t = yIndex.get(box.top)!, d = yIndex.get(box.bottom)!;
    mark(horizontal, l, t + 1, r, d); mark(vertical, l + 1, t, r, d);
  }
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
    const i = y * stride + x;
    for (const array of [horizontal, vertical]) array[i] += (x ? array[i - 1] : 0) + (y ? array[i - stride] : 0) - (x && y ? array[i - stride - 1] : 0);
  }
  const start = yIndex.get(a.y)! * nx + xIndex.get(a.x)!, goal = yIndex.get(b.y)! * nx + xIndex.get(b.x)!;
  const costs = new Float64Array(count * 2); costs.fill(Infinity);
  const previous = new Int32Array(count * 2); previous.fill(-1);
  const queue = new Queue();
  for (const orientation of [0, 1]) { const id = start * 2 + orientation; costs[id] = 0; queue.push({ id, cost: 0, score: distance(a, b) }); }
  while (queue.items.length) {
    const current = queue.pop()!;
    if (current.cost !== costs[current.id]) continue;
    const point = current.id >> 1, x = point % nx, y = Math.floor(point / nx), orientation = current.id & 1;
    if (point === goal) {
      const result: Point[] = []; let id = current.id;
      while (id >= 0) { const p = id >> 1; result.push({ x: xs[p % nx], y: ys[Math.floor(p / nx)] }); id = previous[id]; }
      return simplify(result.reverse());
    }
    const neighbors = [
      ...(x > 0 && !horizontal[y * stride + x - 1] ? [{ x: x - 1, y, direction: 0 }] : []),
      ...(x + 1 < nx && !horizontal[y * stride + x] ? [{ x: x + 1, y, direction: 0 }] : []),
      ...(y > 0 && !vertical[(y - 1) * stride + x] ? [{ x, y: y - 1, direction: 1 }] : []),
      ...(y + 1 < ny && !vertical[y * stride + x] ? [{ x, y: y + 1, direction: 1 }] : []),
    ];
    for (const next of neighbors) {
      const id = (next.y * nx + next.x) * 2 + next.direction;
      const cost = current.cost + Math.abs(xs[next.x] - xs[x]) + Math.abs(ys[next.y] - ys[y]) + (orientation === next.direction ? 0 : 24);
      if (cost >= costs[id]) continue;
      costs[id] = cost; previous[id] = current.id;
      queue.push({ id, cost, score: cost + Math.abs(xs[next.x] - b.x) + Math.abs(ys[next.y] - b.y) });
    }
  }
  return undefined;
}

function routeLeg(a: Point, b: Point, boxes: Box[]): Point[] | undefined {
  if (same(a, b)) return [a];
  const x = (a.x + b.x) / 2, y = (a.y + b.y) / 2;
  const candidates = [
    [a, { x: b.x, y: a.y }, b], [a, { x: a.x, y: b.y }, b],
    [a, { x, y: a.y }, { x, y: b.y }, b], [a, { x: a.x, y }, { x: b.x, y }, b],
  ].map(simplify).filter(points => points.slice(1).every((point, i) => clear(points[i], point, boxes)));
  if (candidates.length) {
    candidates.sort((p, q) => (p.length - q.length) || (p.slice(1).reduce((sum, point, i) => sum + distance(p[i], point), 0) - q.slice(1).reduce((sum, point, i) => sum + distance(q[i], point), 0)));
    return candidates[0];
  }
  return search(a, b, boxes);
}

function exitPoint(point: Point, node: DiagramNode, handle: HandleId): Point {
  const box = bounds(node), direction = directions[handle];
  return { x: direction.x ? (direction.x > 0 ? Math.max(point.x + 28, box.right) : Math.min(point.x - 28, box.left)) : point.x, y: direction.y ? (direction.y > 0 ? Math.max(point.y + 28, box.bottom) : Math.min(point.y - 28, box.top)) : point.y };
}

function endpointCorridor(start: Point, end: Point, source: DiagramNode, target: DiagramNode, sourceHandle: HandleId, targetHandle: HandleId) {
  const a = exitPoint(start, source, sourceHandle), b = exitPoint(end, target, targetHandle);
  const sourceBox = bounds(source), targetBox = bounds(target);
  const sd = directions[sourceHandle], td = directions[targetHandle];
  if (sd.x !== -td.x || sd.y !== -td.y) return { a, b, sourceBox, targetBox };
  const axis = sd.x ? 'x' : 'y', forward = sd[axis], positive = forward > 0;
  const sourceSide = sd.x ? (positive ? 'right' : 'left') : (positive ? 'bottom' : 'top');
  const targetSide = sd.x ? (positive ? 'left' : 'right') : (positive ? 'top' : 'bottom');
  const sourceEdge = sourceBox[sourceSide] - forward * CLEARANCE, targetEdge = targetBox[targetSide] + forward * CLEARANCE;
  const from = positive ? Math.max(sourceEdge, start[axis]) : Math.min(sourceEdge, start[axis]);
  const to = positive ? Math.min(targetEdge, end[axis]) : Math.max(targetEdge, end[axis]);
  if ((to - from) * forward <= 0) return { a, b, sourceBox, targetBox };
  // Facing ports share a narrow gap instead of extending past one another.
  const middle = (from + to) / 2;
  a[axis] = positive ? Math.min(a[axis], middle) : Math.max(a[axis], middle);
  b[axis] = positive ? Math.max(b[axis], middle) : Math.min(b[axis], middle);
  sourceBox[sourceSide] = positive ? Math.min(sourceBox[sourceSide], middle) : Math.max(sourceBox[sourceSide], middle);
  targetBox[targetSide] = positive ? Math.max(targetBox[targetSide], middle) : Math.min(targetBox[targetSide], middle);
  return { a, b, sourceBox, targetBox };
}

/** Routes use 16px clearance where space permits. Explicit bends may enter a shape intentionally. */
export function routeDiagramEdge(edge: DiagramEdge, source: DiagramNode, target: DiagramNode, nodes: DiagramNode[], endpoints?: { source: Point; target: Point }): DiagramRoute {
  const start = endpoints?.source ?? handlePoint(source, edge.sourceHandle), end = endpoints?.target ?? handlePoint(target, edge.targetHandle);
  const { a, b, sourceBox, targetBox } = endpointCorridor(start, end, source, target, edge.sourceHandle, edge.targetHandle);
  const boxes = nodes.map(node => node.id === source.id ? sourceBox : node.id === target.id ? targetBox : bounds(node));
  const waypoints = edge.waypoints ?? [];
  const sd = directions[edge.sourceHandle], td = directions[edge.targetHandle];
  if (!waypoints.length && sd.x === -td.x && sd.y === -td.y
    && (sd.x ? start.y === end.y : start.x === end.x)
    && (end.x - start.x) * sd.x + (end.y - start.y) * sd.y > 0
    && clear(start, end, boxes.filter((_, i) => nodes[i].id !== source.id && nodes[i].id !== target.id))) return finish([start, end]);
  const stops = [a, ...waypoints, b];
  const points = [start, a];
  for (let i = 1; i < stops.length; i++) {
    const from = stops[i - 1], to = stops[i];
    const obstacles = waypoints.length ? boxes.filter(box => !inside(from, box) && !inside(to, box)) : boxes;
    const leg = routeLeg(from, to, obstacles);
    if (!leg && !waypoints.length) return edgeRoute(start, end, edge.sourceHandle, edge.targetHandle);
    points.push(...(leg ?? [from, { x: to.x, y: from.y }, to]).slice(1));
  }
  points.push(end);
  return finish(waypoints.length ? points : simplify(points));
}
