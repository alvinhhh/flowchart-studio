import { describe, expect, it } from 'vitest';
import { handlePoint, nodePath, nodeTextBox, wrapLabel, type Point } from './geometry';
import { NODE_DEFINITIONS, NODE_TYPES, NODE_TYPE_LABELS } from './shapes';
import { createNode, newDiagram, parseDiagram, serializeDiagram } from './diagram';

const ADDED_SHAPES = ['octagon', 'star', 'cloud', 'cross', 'speech_bubble', 'arrow_right', 'arrow_left', 'arrow_up', 'arrow_down', 'arrow_horizontal', 'arrow_vertical', 'chevron'] as const;

/** Samples SVG commands independently so outline and anchor regressions are checked together. */
function samplePaths(path: string): Point[][] {
  const tokens = path.match(/[MLCZ]|[-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?/gi)!;
  const paths: Point[][] = [];
  let current: Point = { x: 0, y: 0 };
  let points: Point[] = [];
  let index = 0;
  const pair = () => ({ x: Number(tokens[index++]), y: Number(tokens[index++]) });
  while (index < tokens.length) {
    const command = tokens[index++];
    if (command === 'M') {
      current = pair(); points = [current]; paths.push(points);
    } else if (command === 'L') {
      current = pair(); points.push(current);
    } else if (command === 'C') {
      const from = current, a = pair(), b = pair(), to = pair();
      for (let step = 1; step <= 128; step++) {
        const t = step / 128, s = 1 - t;
        points.push({ x: s ** 3 * from.x + 3 * s ** 2 * t * a.x + 3 * s * t ** 2 * b.x + t ** 3 * to.x, y: s ** 3 * from.y + 3 * s ** 2 * t * a.y + 3 * s * t ** 2 * b.y + t ** 3 * to.y });
      }
      current = to;
    } else if (command === 'Z') {
      points.push(points[0]); current = points[0];
    } else throw new Error(`Unexpected SVG command ${command}`);
  }
  return paths;
}

function distance(point: Point, a: Point, b: Point) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  const t = length ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length)) : 0;
  return Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy);
}
function boundaryDistance(point: Point, polygon: Point[]) {
  return Math.min(...polygon.slice(1).map((to, index) => distance(point, polygon[index], to)));
}
function inside(point: Point, polygon: Point[]) {
  if (boundaryDistance(point, polygon) < 0.001) return true;
  let result = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const a = polygon[index], b = polygon[previous];
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) result = !result;
  }
  return result;
}

describe('shape library', () => {
  it('defines 44 distinct kinds with usable defaults and searchable metadata', () => {
    expect(NODE_TYPES).toHaveLength(44);
    expect(new Set(NODE_TYPES).size).toBe(44);
    expect(Object.keys(NODE_DEFINITIONS).sort()).toEqual([...NODE_TYPES].sort());
    expect(NODE_TYPES.filter(type => NODE_DEFINITIONS[type].group === 'Basic')).toEqual(['terminal', 'process', 'decision', 'io', 'function', 'note']);
    for (const type of NODE_TYPES) {
      const definition = NODE_DEFINITIONS[type];
      expect(definition.label).toBe(NODE_TYPE_LABELS[type]);
      expect(definition.keywords.trim().length).toBeGreaterThan(0);
      expect(definition.width).toBeGreaterThan(0);
      expect(definition.height).toBeGreaterThan(0);
      expect(definition.width).toBeLessThanOrEqual(2000);
      expect(definition.height).toBeLessThanOrEqual(2000);
    }
    expect(NODE_DEFINITIONS.connector.defaultLabel).toBe('A');
    expect(NODE_DEFINITIONS.summing_junction.defaultLabel).toBe('');
    expect(NODE_DEFINITIONS.or.defaultLabel).toBe('');
    expect(NODE_TYPES.slice(32)).toEqual(ADDED_SHAPES);
    expect(NODE_TYPES.filter(type => NODE_DEFINITIONS[type].group === 'Geometry')).toEqual(ADDED_SHAPES.slice(0, 5));
    expect(NODE_TYPES.filter(type => NODE_DEFINITIONS[type].group === 'Block arrows')).toEqual(ADDED_SHAPES.slice(5));
  });

  it('gives every kind a distinctive SVG path rather than a rectangle fallback', () => {
    const paths = NODE_TYPES.map(type => nodePath(type, 180, 120));
    expect(new Set(paths).size).toBe(NODE_TYPES.length);
    for (const path of paths) {
      expect(path).toMatch(/^M /);
      expect(path).toContain('Z');
      expect(path).not.toMatch(/NaN|Infinity|undefined/);
    }
  });

  it.each(NODE_TYPES)('%s stays inside bounds and keeps text and contour anchors finite at normal and tiny dimensions', type => {
    const definition = NODE_DEFINITIONS[type];
    for (const [width, height] of [[definition.width, definition.height], [1, 1], [1, 2000], [2000, 1]]) {
      const paths = samplePaths(nodePath(type, width, height));
      for (const points of paths) {
        for (const point of points) {
          expect(Number.isFinite(point.x) && Number.isFinite(point.y)).toBe(true);
          expect(point.x).toBeGreaterThanOrEqual(-1e-9);
          expect(point.x).toBeLessThanOrEqual(width + 1e-9);
          expect(point.y).toBeGreaterThanOrEqual(-1e-9);
          expect(point.y).toBeLessThanOrEqual(height + 1e-9);
        }
      }
      const text = nodeTextBox(type, width, height);
      expect(Object.values(text).every(Number.isFinite)).toBe(true);
      expect(text.width).toBeGreaterThan(0);
      expect(text.height).toBeGreaterThan(0);
      expect(text.x - text.width / 2).toBeGreaterThanOrEqual(0);
      expect(text.x + text.width / 2).toBeLessThanOrEqual(width);
      expect(text.y - text.height / 2).toBeGreaterThanOrEqual(0);
      expect(text.y + text.height / 2).toBeLessThanOrEqual(height);
      for (const handle of ['top', 'right', 'bottom', 'left'] as const) {
        const point = handlePoint({ type, width, height, position: { x: 30, y: -20 } }, handle);
        const local = { x: point.x - 30, y: point.y + 20 };
        expect(Number.isFinite(local.x) && Number.isFinite(local.y)).toBe(true);
        expect(boundaryDistance(local, paths[0])).toBeLessThan(0.03);
        if (handle === 'top' || handle === 'bottom') expect(local.x).toBeCloseTo(width / 2, 7);
        else expect(local.y).toBeCloseTo(height / 2, 7);
      }
    }
  });

  it.each(NODE_TYPES)('%s text box corners sit inside its default silhouette', type => {
    const { width, height } = NODE_DEFINITIONS[type];
    const text = nodeTextBox(type, width, height);
    const outline = samplePaths(nodePath(type, width, height))[0];
    for (const x of [text.x - text.width / 2, text.x + text.width / 2]) {
      for (const y of [text.y - text.height / 2, text.y + text.height / 2]) expect(inside({ x, y }, outline), `${type} text corner ${x},${y} is outside its outline`).toBe(true);
    }
  });

  it('anchors sloped and curved shapes on their contour rather than the bounding rectangle', () => {
    const base = { width: 200, height: 100, position: { x: 0, y: 0 } };
    expect(handlePoint({ ...base, type: 'io' }, 'left').x).toBeCloseTo(13);
    expect(handlePoint({ ...base, type: 'io' }, 'right').x).toBeCloseTo(187);
    expect(handlePoint({ ...base, type: 'manual_input' }, 'top').y).toBeCloseTo(11);
    expect(handlePoint({ ...base, type: 'manual_operation' }, 'left').x).toBeCloseTo(20);
    expect(handlePoint({ ...base, type: 'extract' }, 'left').x).toBeCloseTo(50);
    expect(handlePoint({ ...base, type: 'merge' }, 'right').x).toBeCloseTo(150);
    expect(handlePoint({ ...base, type: 'display' }, 'right').x).toBeLessThan(200);
    expect(handlePoint({ ...base, type: 'document' }, 'bottom').y).toBeCloseTo(88);
    expect(handlePoint(base, 'left')).toEqual({ x: 0, y: 50 });
  });

  it('normalizes invalid dimensions without emitting invalid SVG or metrics', () => {
    for (const type of NODE_TYPES) {
      expect(nodePath(type, Number.NaN, Infinity)).not.toMatch(/NaN|Infinity/);
      expect(Object.values(nodeTextBox(type, 0, -1)).every(Number.isFinite)).toBe(true);
    }
  });

  it('places directional arrow handles on the arrow tips and shaft rather than the bounding box', () => {
    const base = { width: 200, height: 100, position: { x: 0, y: 0 } };
    for (const type of ['arrow_right', 'arrow_left', 'arrow_horizontal'] as const) {
      expect(handlePoint({ ...base, type }, 'top')).toEqual({ x: 100, y: 27 });
      expect(handlePoint({ ...base, type }, 'bottom')).toEqual({ x: 100, y: 73 });
      expect(handlePoint({ ...base, type }, 'left')).toEqual({ x: 0, y: 50 });
      expect(handlePoint({ ...base, type }, 'right')).toEqual({ x: 200, y: 50 });
    }
    for (const type of ['arrow_up', 'arrow_down', 'arrow_vertical'] as const) {
      expect(handlePoint({ ...base, type }, 'top')).toEqual({ x: 100, y: 0 });
      expect(handlePoint({ ...base, type }, 'bottom')).toEqual({ x: 100, y: 100 });
      expect(handlePoint({ ...base, type }, 'left').x).toBeCloseTo(54);
      expect(handlePoint({ ...base, type }, 'right').x).toBeCloseTo(146);
    }
    expect(handlePoint({ ...base, type: 'chevron' }, 'left')).toEqual({ x: 60, y: 50 });
    expect(handlePoint({ ...base, type: 'speech_bubble' }, 'bottom').y).toBeCloseTo(86.111111);
  });

  it.each(ADDED_SHAPES)('%s fits its default label and round trips through the existing JSON schema', type => {
    const node = createNode(type, { x: 13.5, y: -42 });
    const box = nodeTextBox(type, node.width, node.height);
    expect(wrapLabel(node.label, box.width).length * 20).toBeLessThanOrEqual(box.height);
    const diagram = { ...newDiagram('Expanded shapes'), nodes: [node] };
    expect(parseDiagram(serializeDiagram(diagram))).toEqual(diagram);
  });
});
