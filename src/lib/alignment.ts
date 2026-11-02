export interface AlignBox {
  id: string;
  position: { x: number; y: number };
  width: number;
  height: number;
}

export interface AlignmentGuide {
  axis: 'x' | 'y';
  position: number;
  start: number;
  end: number;
}

export interface AlignmentOptions {
  zoom: number;
  snapToGrid: boolean;
  enabled?: boolean;
  /** Distance in screen pixels. */
  tolerance?: number;
}

export interface AlignmentResult {
  delta: { x: number; y: number };
  guides: AlignmentGuide[];
}

interface Bounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface Candidate {
  delta: number;
  position: number;
  movingAnchor: number;
  targetAnchor: number;
  targetId: string;
  target: Bounds;
}

const GRID_SIZE = 16;

function bounds(box: AlignBox): Bounds | undefined {
  const { x, y } = box.position;
  const right = x + box.width;
  const bottom = y + box.height;
  if (![x, y, box.width, box.height, right, bottom].every(Number.isFinite) || box.width < 0 || box.height < 0) return undefined;
  return { left: x, top: y, right, bottom };
}

function anchors(box: Bounds, axis: 'x' | 'y'): number[] {
  const start = axis === 'x' ? box.left : box.top;
  const end = axis === 'x' ? box.right : box.bottom;
  return [start, start + (end - start) / 2, end];
}

function compare(a: Candidate, b: Candidate): number {
  const distance = Math.abs(a.delta) - Math.abs(b.delta);
  if (distance !== 0) return distance;
  const sameKind = Number(a.movingAnchor !== a.targetAnchor) - Number(b.movingAnchor !== b.targetAnchor);
  if (sameKind !== 0) return sameKind;
  const center = Number(a.movingAnchor !== 1) + Number(a.targetAnchor !== 1) - Number(b.movingAnchor !== 1) - Number(b.targetAnchor !== 1);
  if (center !== 0) return center;
  if (a.targetId !== b.targetId) return a.targetId < b.targetId ? -1 : 1;
  return a.movingAnchor - b.movingAnchor || a.targetAnchor - b.targetAnchor || a.delta - b.delta;
}

function nearest(group: Bounds, targets: Array<{ id: string; box: Bounds }>, axis: 'x' | 'y', tolerance: number): Candidate | undefined {
  let winner: Candidate | undefined;
  const movingAnchors = anchors(group, axis);
  for (const target of targets) {
    const targetAnchors = anchors(target.box, axis);
    for (let movingAnchor = 0; movingAnchor < 3; movingAnchor++) {
      for (let targetAnchor = 0; targetAnchor < 3; targetAnchor++) {
        const position = targetAnchors[targetAnchor];
        const delta = position - movingAnchors[movingAnchor];
        if (!Number.isFinite(delta) || Math.abs(delta) > tolerance) continue;
        const candidate = { delta, position, movingAnchor, targetAnchor, targetId: target.id, target: target.box };
        if (!winner || compare(candidate, winner) < 0) winner = candidate;
      }
    }
  }
  return winner;
}

function gridDelta(position: number): number {
  const delta = Math.round(position / GRID_SIZE) * GRID_SIZE - position;
  return Number.isFinite(delta) ? delta : 0;
}

/** Returns one translation for the moving group; callers apply it to every moving shape. */
export function alignShapes(moving: readonly AlignBox[], stationary: readonly AlignBox[], options: AlignmentOptions): AlignmentResult {
  const movingBounds = moving.map(bounds).filter((box): box is Bounds => box !== undefined);
  if (!movingBounds.length) return { delta: { x: 0, y: 0 }, guides: [] };
  const group: Bounds = {
    left: Math.min(...movingBounds.map(box => box.left)),
    top: Math.min(...movingBounds.map(box => box.top)),
    right: Math.max(...movingBounds.map(box => box.right)),
    bottom: Math.max(...movingBounds.map(box => box.bottom)),
  };
  const movingIds = new Set(moving.map(box => box.id));
  const targets = stationary.flatMap(box => {
    if (movingIds.has(box.id)) return [];
    const rectangle = bounds(box);
    return rectangle ? [{ id: box.id, box: rectangle }] : [];
  });
  const zoom = Number.isFinite(options.zoom) && options.zoom > 0 ? Math.min(4, Math.max(0.1, options.zoom)) : 1;
  const tolerance = options.tolerance !== undefined && Number.isFinite(options.tolerance) && options.tolerance >= 0 ? options.tolerance : 6;
  const x = options.enabled === false ? undefined : nearest(group, targets, 'x', tolerance / zoom);
  const y = options.enabled === false ? undefined : nearest(group, targets, 'y', tolerance / zoom);
  const delta = {
    x: (x?.delta ?? (options.snapToGrid ? gridDelta(group.left) : 0)) || 0,
    y: (y?.delta ?? (options.snapToGrid ? gridDelta(group.top) : 0)) || 0,
  };
  const guides: AlignmentGuide[] = [];
  if (x) guides.push({ axis: 'x', position: x.position, start: Math.min(group.top + delta.y, x.target.top), end: Math.max(group.bottom + delta.y, x.target.bottom) });
  if (y) guides.push({ axis: 'y', position: y.position, start: Math.min(group.left + delta.x, y.target.left), end: Math.max(group.right + delta.x, y.target.right) });
  return { delta, guides };
}
