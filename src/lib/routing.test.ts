import { describe, expect, it } from 'vitest';
import type { DiagramEdge, DiagramNode, HandleId } from './diagram';
import { handlePoint, type Point } from './geometry';
import { routeDiagramEdge } from './routing';

function node(id: string, x: number, y: number, width = 100, height = 60): DiagramNode {
  return { id, type: 'process', position: { x, y }, width, height, label: id, notes: '', style: { color: 'neutral' } };
}
function edge(source: DiagramNode, target: DiagramNode, sourceHandle: HandleId = 'right', targetHandle: HandleId = 'left', waypoints?: Point[]): DiagramEdge {
  return { id: 'edge', source: source.id, target: target.id, sourceHandle, targetHandle, label: '', style: { color: 'neutral' }, ...(waypoints ? { waypoints } : {}) };
}
function crosses(a: Point, b: Point, box: DiagramNode, clearance = 16) {
  const left = box.position.x - clearance, right = box.position.x + box.width + clearance;
  const top = box.position.y - clearance, bottom = box.position.y + box.height + clearance;
  return a.x === b.x
    ? a.x > left && a.x < right && Math.max(a.y, b.y) > top && Math.min(a.y, b.y) < bottom
    : a.y > top && a.y < bottom && Math.max(a.x, b.x) > left && Math.min(a.x, b.x) < right;
}
const orthogonal = (points: Point[]) => points.slice(1).every((point, i) => point.x === points[i].x || point.y === points[i].y);

describe('diagram routing', () => {
  it.each([1, 15, 30, 40, 55, 56, 80])('keeps facing ports straight across a %ipx gap', gap => {
    const a = node('a', 0, 0);
    for (const [b, sourceHandle, targetHandle] of [
      [node('b', 100 + gap, 0), 'right', 'left'],
      [node('b', -100 - gap, 0), 'left', 'right'],
      [node('b', 0, 60 + gap), 'bottom', 'top'],
      [node('b', 0, -60 - gap), 'top', 'bottom'],
    ] as const) {
      const start = handlePoint(a, sourceHandle), end = handlePoint(b, targetHandle);
      const route = routeDiagramEdge(edge(a, b, sourceHandle, targetHandle), a, b, [a, b]);
      expect(route.points).toEqual([start, end]);
      expect(route.labelX).toBe((start.x + end.x) / 2);
      expect(route.labelY).toBe((start.y + end.y) / 2);
    }
  });

  it.each([15, 30, 50])('uses the available corridor for offset facing ports with a %ipx gap', gap => {
    for (const [a, b, sourceHandle, targetHandle] of [
      [node('a', 0, 0), node('b', 100 + gap, 45), 'right', 'left'],
      [node('a', 100 + gap, 45), node('b', 0, 0), 'left', 'right'],
      [node('a', 0, 0), node('b', 45, 60 + gap), 'bottom', 'top'],
      [node('a', 45, 60 + gap), node('b', 0, 0), 'top', 'bottom'],
    ] as const) {
      const route = routeDiagramEdge(edge(a, b, sourceHandle, targetHandle), a, b, [a, b]);
      const start = handlePoint(a, sourceHandle), end = handlePoint(b, targetHandle);
      expect(route.points[0]).toEqual(start); expect(route.points.at(-1)).toEqual(end);
      expect(orthogonal(route.points)).toBe(true);
      const length = route.points.slice(1).reduce((sum, point, i) => sum + Math.abs(point.x - route.points[i].x) + Math.abs(point.y - route.points[i].y), 0);
      expect(length).toBe(Math.abs(end.x - start.x) + Math.abs(end.y - start.y));
      for (const shape of [a, b]) expect(route.points.slice(1).some((point, i) => crosses(route.points[i], point, shape, 0))).toBe(false);
    }
  });

  it('connects close sloped contour ports without a detour, including touching bounds', () => {
    const a = { ...node('a', 0, 0, 180, 80), type: 'manual_operation' as const };
    for (const gap of [0, 30]) {
      const b = { ...node('b', 180 + gap, 0, 180, 80), type: 'preparation' as const };
      const start = handlePoint(a, 'right'), end = handlePoint(b, 'left');
      expect(routeDiagramEdge(edge(a, b), a, b, [a, b]).points).toEqual([start, end]);
    }
  });

  it('keeps clearance from a third shape that blocks a narrow offset corridor', () => {
    const a = node('a', 0, 0), b = node('b', 130, 220), obstacle = node('obstacle', 100, 100, 30, 60);
    const route = routeDiagramEdge(edge(a, b), a, b, [a, b, obstacle]);
    expect(orthogonal(route.points)).toBe(true);
    expect(route.points.slice(1).some((point, i) => crosses(route.points[i], point, obstacle))).toBe(false);
    expect(route.points[1].x).toBeGreaterThan(route.points[0].x);
    expect(route.points.at(-2)!.x).toBeLessThan(route.points.at(-1)!.x);
  });

  it('preserves explicit bends when the endpoint ports are close and aligned', () => {
    const a = node('a', 0, 0), b = node('b', 130, 0), bends = [{ x: 115, y: -100 }, { x: 115, y: -60 }];
    const route = routeDiagramEdge(edge(a, b, 'right', 'left', bends), a, b, [a, b]);
    expect(orthogonal(route.points)).toBe(true);
    const indices = bends.map(bend => route.points.findIndex(point => point.x === bend.x && point.y === bend.y));
    expect(indices[0]).toBeGreaterThan(0);
    expect(indices[1]).toBeGreaterThan(indices[0]);
    expect(route.points[1].x).toBeGreaterThan(route.points[0].x);
    expect(route.points.at(-2)!.x).toBeLessThan(route.points.at(-1)!.x);
  });

  it('routes around an intervening shape with clearance', () => {
    const a = node('a', 0, 0), b = node('b', 600, 0), obstacle = node('obstacle', 240, -70, 120, 200);
    const route = routeDiagramEdge(edge(a, b), a, b, [a, b, obstacle]);
    expect(orthogonal(route.points)).toBe(true);
    expect(route.points.slice(1).some((point, i) => crosses(route.points[i], point, obstacle))).toBe(false);
    expect(route.points.some(point => point.y <= -86 || point.y >= 146)).toBe(true);
  });

  it('finds a corridor with multiple turns between staggered obstacles', () => {
    const a = node('a', 0, 150), b = node('b', 700, 150);
    const obstacles = [node('one', 200, -100, 100, 300), node('two', 400, 160, 100, 300), node('three', 550, -100, 60, 300)];
    const route = routeDiagramEdge(edge(a, b), a, b, [a, b, ...obstacles]);
    expect(orthogonal(route.points)).toBe(true);
    for (const obstacle of obstacles) expect(route.points.slice(1).some((point, i) => crosses(route.points[i], point, obstacle))).toBe(false);
  });

  it('preserves both port orientations for every port pair', () => {
    const a = node('a', 0, 0), b = node('b', 420, 240);
    const directions = { top: { x: 0, y: -1 }, right: { x: 1, y: 0 }, bottom: { x: 0, y: 1 }, left: { x: -1, y: 0 } };
    for (const sourceHandle of Object.keys(directions) as HandleId[]) for (const targetHandle of Object.keys(directions) as HandleId[]) {
      const route = routeDiagramEdge(edge(a, b, sourceHandle, targetHandle), a, b, [a, b]);
      const first = route.points[0], next = route.points[1], last = route.points.at(-1)!, previous = route.points.at(-2)!;
      expect(orthogonal(route.points)).toBe(true);
      expect((next.x - first.x) * directions[sourceHandle].x + (next.y - first.y) * directions[sourceHandle].y).toBeGreaterThan(0);
      expect((previous.x - last.x) * directions[targetHandle].x + (previous.y - last.y) * directions[targetHandle].y).toBeGreaterThan(0);
      expect(route.points.slice(2, -1).some((point, i) => crosses(route.points[i + 1], point, a))).toBe(false);
      expect(route.points.slice(2, -1).some((point, i) => crosses(route.points[i + 1], point, b))).toBe(false);
    }
  });

  it('retains explicit bends in order and avoids intervening shapes', () => {
    const a = node('a', 0, 0), b = node('b', 600, 0), obstacle = node('obstacle', 280, 140);
    const waypoints = [{ x: 200, y: 200 }, { x: 450, y: 200 }];
    const route = routeDiagramEdge(edge(a, b, 'right', 'left', waypoints), a, b, [a, b, obstacle]);
    const indices = waypoints.map(point => route.points.findIndex(current => current.x === point.x && current.y === point.y));
    expect(indices[0]).toBeGreaterThan(0); expect(indices[1]).toBeGreaterThan(indices[0]);
    expect(orthogonal(route.points)).toBe(true);
    expect(route.points.slice(1).some((point, i) => crosses(route.points[i], point, obstacle))).toBe(false);
  });

  it('honors a bend intentionally placed inside a shape', () => {
    const a = node('a', 0, 0), b = node('b', 600, 0), obstacle = node('obstacle', 280, 140);
    const bend = { x: 320, y: 160 };
    const route = routeDiagramEdge(edge(a, b, 'right', 'left', [bend]), a, b, [a, b, obstacle]);
    expect(route.points).toContainEqual(bend);
    expect(orthogonal(route.points)).toBe(true);
  });

  it('uses shape contour ports and optional live endpoints', () => {
    const a = { ...node('a', 0, 0), type: 'merge' as const }, b = node('b', 420, 0);
    const model = edge(a, b);
    expect(routeDiagramEdge(model, a, b, [a, b]).points[0]).toEqual(handlePoint(a, 'right'));
    const live = { source: { x: 80, y: 30 }, target: { x: 418, y: 30 } };
    const route = routeDiagramEdge(model, a, b, [a, b], live);
    expect(route.points[0]).toEqual(live.source); expect(route.points.at(-1)).toEqual(live.target);
  });

  it('is deterministic, independent of obstacle ordering, and does not mutate input', () => {
    const a = node('a', 0, 0), b = node('b', 600, 0), obstacles = [node('one', 220, -20), node('two', 380, -80)];
    const nodes = [a, b, ...obstacles], model = edge(a, b), before = JSON.stringify({ nodes, model });
    const route = routeDiagramEdge(model, a, b, nodes);
    expect(routeDiagramEdge(model, a, b, nodes)).toEqual(route);
    expect(routeDiagramEdge(model, a, b, [...nodes].reverse())).toEqual(route);
    expect(JSON.stringify({ nodes, model })).toBe(before);
    expect(route.path).not.toMatch(/NaN|Infinity/);
  });

  it('produces a finite orthogonal route when endpoints coincide', () => {
    const a = node('a', 0, 0);
    const route = routeDiagramEdge(edge(a, a, 'right', 'top'), a, a, [a]);
    expect(orthogonal(route.points)).toBe(true);
    expect(route.path).not.toMatch(/NaN|Infinity/);
    expect(route.points.length).toBeGreaterThan(3);
  });

  it('handles 200 nodes with bounded routing data', () => {
    const a = node('a', 0, 0), b = node('b', 6000, 0);
    const obstacles = Array.from({ length: 198 }, (_, i) => node(`obstacle-${i}`, 180 + (i % 25) * 180, -300 + Math.floor(i / 25) * 120));
    const route = routeDiagramEdge(edge(a, b), a, b, [a, b, ...obstacles]);
    expect(orthogonal(route.points)).toBe(true);
    expect(route.points.length).toBeLessThan(1000);
    expect(route.path).not.toMatch(/NaN|Infinity/);
    for (const obstacle of obstacles) expect(route.points.slice(1).some((point, i) => crosses(route.points[i], point, obstacle))).toBe(false);
  });
});
