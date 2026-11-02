import { describe, expect, it } from 'vitest';
import type { Diagram, DiagramNode, HandleId } from './diagram';
import { diagramToSvg, exportBounds } from './export';
import { edgeRoute, wrapLabel } from './geometry';

function shape(id: string, x: number, y: number): DiagramNode {
  return { id, type: 'process', position: { x, y }, width: 180, height: 80, label: id, notes: '', style: { color: 'neutral' } };
}

function document(nodes: DiagramNode[]): Diagram {
  return {
    schemaVersion: 1, documentId: 'test-document', title: 'Test', createdAt: '2026-11-02T00:00:00.000Z',
    updatedAt: '2026-11-02T00:00:00.000Z', revision: 0, nodes, edges: [],
    viewport: { x: 0, y: 0, zoom: 1 }, settings: { snapToGrid: false, gridVisible: true },
  };
}

describe('complete diagram export', () => {
  it('includes negative and offscreen coordinates without depending on the viewport', () => {
    const doc = document([shape('Left', -1500, -800), shape('Right', 12000, 4000)]);
    const bounds = exportBounds(doc);
    expect(bounds.x).toBeLessThan(-1500);
    expect(bounds.y).toBeLessThan(-800);
    expect(bounds.x + bounds.width).toBeGreaterThan(12180);
    expect(bounds.y + bounds.height).toBeGreaterThan(4080);
    const svg = diagramToSvg(doc);
    doc.viewport = { x: 30000, y: -8000, zoom: 0.2 };
    expect(diagramToSvg(doc)).toBe(svg);
  });

  it('renders notes and edge labels as escaped text with no executable HTML', () => {
    const note = shape('note', 0, 0);
    note.type = 'note';
    note.label = '<script> & "hi"';
    const doc = document([note, shape('end', 600, 0)]);
    doc.edges = [{ id: 'edge', source: 'note', target: 'end', sourceHandle: 'right', targetHandle: 'left', label: '<img onerror=alert(1)>', style: { color: 'rose' } }];
    const svg = diagramToSvg(doc);
    expect(svg).toContain('&lt;script&gt;');
    expect(svg).toContain('&amp;');
    expect(svg).toContain('&quot;hi&quot;');
    expect(svg).toContain('&lt;img');
    expect(svg).toContain('marker-end="url(#arrow-rose)"');
    expect(svg).not.toMatch(/<script|<img|foreignObject|class="react-flow/);
  });

  it('reserves space for tall connector labels and routes that extend beyond the shapes', () => {
    const doc = document([shape('a', 0, 0), shape('b', 240, 0)]);
    doc.edges = [{ id: 'back', source: 'a', target: 'b', sourceHandle: 'top', targetHandle: 'top', label: Array(35).fill('label').join('\n'), style: { color: 'blue' } }];
    const bounds = exportBounds(doc);
    expect(bounds.y).toBeLessThan(-350);
    expect(bounds.y + bounds.height).toBeGreaterThan(250);
  });

  it('rejects invalid shape coordinates before building a raster image', () => {
    expect(() => diagramToSvg(document([shape('invalid', NaN, 0)]))).toThrow(/invalid dimensions/);
  });
});

describe('shared geometry', () => {
  it('routes all handle pairs orthogonally while preserving the outgoing and incoming directions', () => {
    const handles: HandleId[] = ['top', 'right', 'bottom', 'left'];
    const vector: Record<HandleId, [number, number]> = { top: [0, -1], right: [1, 0], bottom: [0, 1], left: [-1, 0] };
    for (const sourceHandle of handles) for (const targetHandle of handles) {
      for (const target of [{ x: 400, y: 180 }, { x: -100, y: -180 }, { x: 0, y: 0 }]) {
        const route = edgeRoute({ x: 0, y: 0 }, target, sourceHandle, targetHandle);
        expect(route.points[0]).toEqual({ x: 0, y: 0 });
        expect(route.points.at(-1)).toEqual(target);
        for (let i = 1; i < route.points.length; i++) {
          expect(route.points[i].x === route.points[i - 1].x || route.points[i].y === route.points[i - 1].y).toBe(true);
        }
        const first = route.points[1];
        expect(first.x * vector[sourceHandle][0] + first.y * vector[sourceHandle][1]).toBeGreaterThan(0);
        const before = route.points.at(-2)!;
        expect((before.x - target.x) * vector[targetHandle][0] + (before.y - target.y) * vector[targetHandle][1]).toBeGreaterThan(0);
      }
    }
  });

  it('wraps long Unicode labels without losing characters or breaking surrogate pairs', () => {
    const label = '🧭漢字'.repeat(80);
    const lines = wrapLabel(label, 130);
    expect(lines.length).toBeGreaterThan(10);
    expect(lines.join('')).toBe(label);
    for (const line of lines) expect(line).not.toMatch(/^[\udc00-\udfff]|[\ud800-\udbff]$/);
    const family = '👨‍👩‍👧‍👦';
    expect(wrapLabel(family.repeat(3), 20)).toEqual([family, family, family]);
    expect(wrapLabel('first\n\nlast', 200)).toEqual(['first', '', 'last']);
  });
});
