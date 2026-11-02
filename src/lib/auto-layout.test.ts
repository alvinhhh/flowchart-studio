import { describe, expect, it } from 'vitest';
import { autoArrange } from './auto-layout';
import { type Diagram, type DiagramEdge, type DiagramNode, exampleDiagram, newDiagram, validateDiagram } from './diagram';
import { edgeRoute, handlePoint } from './geometry';

function node(id: string, type: DiagramNode['type'] = 'process', width = 180, height = 80): DiagramNode {
  return { id, type, width, height, position: { x: -400, y: -300 }, label: `${id} — 確認`, notes: `Notes for ${id}`, style: { color: 'blue' } };
}
function edge(id: string, source: string, target: string, label = ''): DiagramEdge {
  return { id, source, target, label, sourceHandle: 'left', targetHandle: 'right', style: { color: 'violet' } };
}
function branchingGraph(): Diagram {
  return {
    ...newDiagram('Branch, merge, loop'),
    nodes: [node('start', 'terminal'), node('decision', 'decision', 220, 140), node('yes'), node('no'), node('merge'), node('end', 'terminal')],
    edges: [edge('entry', 'start', 'decision'), edge('yes-edge', 'decision', 'yes', 'Yes'), edge('no-edge', 'decision', 'no', 'No'), edge('yes-merge', 'yes', 'merge'), edge('no-merge', 'no', 'merge'), edge('finish', 'merge', 'end'), edge('retry', 'merge', 'decision', 'Retry after checking the previous result')],
  };
}
function assertNoOverlap(doc: Diagram) {
  for (let index = 0; index < doc.nodes.length; index++) {
    const a = doc.nodes[index];
    for (const b of doc.nodes.slice(index + 1)) {
      const overlapping = a.position.x < b.position.x + b.width && a.position.x + a.width > b.position.x && a.position.y < b.position.y + b.height && a.position.y + a.height > b.position.y;
      expect(overlapping, `${a.id} overlaps ${b.id}`).toBe(false);
    }
  }
}
function portableContent(doc: Diagram) {
  return {
    ...doc,
    nodes: doc.nodes.map(node => ({ ...node, position: undefined })),
    edges: doc.edges.map(edge => ({ ...edge, sourceHandle: undefined, targetHandle: undefined })),
  };
}

describe('local automatic layout', () => {
  it('makes the example a compact straight main path with a distinct side branch and an outside retry loop', async () => {
    const original = exampleDiagram();
    const result = await autoArrange(original);
    const [start, review, decision, ship, retry, done] = result.nodes;
    const spine = [start, review, decision, ship, done].map(node => node.position.x + node.width / 2);
    expect(Math.max(...spine) - Math.min(...spine)).toBeLessThan(0.01);
    expect(done.position.y + done.height - start.position.y).toBeLessThanOrEqual(850);
    expect(retry.position.y + retry.height / 2).toBe(decision.position.y + decision.height / 2);
    expect(retry.position.x + retry.width).toBeLessThan(decision.position.x);
    const [entry, reviewDecision, yes, no, feedback, finish] = result.edges;
    for (const edge of [entry, reviewDecision, yes, finish]) {
      expect([edge.sourceHandle, edge.targetHandle]).toEqual(['bottom', 'top']);
    }
    expect([no.sourceHandle, no.targetHandle]).toEqual(['left', 'right']);
    expect(no.sourceHandle).not.toBe(yes.sourceHandle);
    expect([feedback.sourceHandle, feedback.targetHandle]).toEqual(['left', 'left']);
    const loop = edgeRoute(handlePoint(retry, feedback.sourceHandle), handlePoint(review, feedback.targetHandle), feedback.sourceHandle, feedback.targetHandle);
    expect(Math.min(...loop.points.map(point => point.x))).toBeLessThan(Math.min(...result.nodes.map(node => node.position.x)));
    assertNoOverlap(result);
    const byId = new Map(result.nodes.map(node => [node.id, node]));
    for (const edge of result.edges) {
      const source = byId.get(edge.source)!, target = byId.get(edge.target)!;
      const route = edgeRoute(handlePoint(source, edge.sourceHandle), handlePoint(target, edge.targetHandle), edge.sourceHandle, edge.targetHandle);
      for (let index = 1; index < route.points.length; index++) {
        const a = route.points[index - 1], b = route.points[index];
        for (const obstacle of result.nodes.filter(node => node.id !== edge.source && node.id !== edge.target)) {
          const insideX = Math.max(a.x, b.x) > obstacle.position.x && Math.min(a.x, b.x) < obstacle.position.x + obstacle.width;
          const insideY = Math.max(a.y, b.y) > obstacle.position.y && Math.min(a.y, b.y) < obstacle.position.y + obstacle.height;
          expect(insideX && insideY, `${edge.label || edge.id} crosses ${obstacle.label}`).toBe(false);
        }
      }
    }
    expect(portableContent(result)).toEqual(portableContent(original));
    expect(await autoArrange(result)).toEqual(result);
  });

  it('uses branch meaning, rather than input edge order, to keep a positive continuation on the main path', async () => {
    const original = exampleDiagram();
    original.edges.reverse();
    original.edges.find(edge => edge.label === 'Yes')!.label = 'Success';
    original.edges.find(edge => edge.label === 'No')!.label = 'Failure';
    const result = await autoArrange(original);
    const success = result.edges.find(edge => edge.label === 'Success')!;
    const failure = result.edges.find(edge => edge.label === 'Failure')!;
    expect(success.sourceHandle).toBe('bottom');
    expect(failure.sourceHandle).toBe('left');
    const decision = result.nodes.find(node => node.id === success.source)!;
    const continuation = result.nodes.find(node => node.id === success.target)!;
    expect(decision.position.x + decision.width / 2).toBe(continuation.position.x + continuation.width / 2);
    expect(portableContent(result)).toEqual(portableContent(original));
    assertNoOverlap(result);
  });

  it('lays out a cycle without an entry node as a straight forward chain and a side return', async () => {
    const original = { ...newDiagram(), nodes: [node('a'), node('b'), node('c')], edges: [edge('ab', 'a', 'b'), edge('bc', 'b', 'c'), edge('ca', 'c', 'a')] };
    const result = await autoArrange(original);
    expect(result.nodes.map(node => node.position.x)).toEqual([result.nodes[0].position.x, result.nodes[0].position.x, result.nodes[0].position.x]);
    expect(result.nodes[0].position.y).toBeLessThan(result.nodes[1].position.y);
    expect(result.nodes[1].position.y).toBeLessThan(result.nodes[2].position.y);
    expect(['left', 'right']).toContain(result.edges[2].sourceHandle);
    expect(result.edges[2].targetHandle).toBe(result.edges[2].sourceHandle);
    expect(await autoArrange(result)).toEqual(result);
    assertNoOverlap(result);
  });

  it('preserves the complete diagram graph and portable content while arranging a branch, merge, and cycle', async () => {
    const doc = branchingGraph();
    const before = structuredClone(doc);
    const result = await autoArrange(doc);
    expect(portableContent(result)).toEqual(portableContent(doc));
    expect(doc).toEqual(before);
    expect(result.nodes.some((node, index) => node.position.x !== doc.nodes[index].position.x || node.position.y !== doc.nodes[index].position.y)).toBe(true);
    expect(() => validateDiagram(result)).not.toThrow();
    assertNoOverlap(result);
    const byId = new Map(result.nodes.map(node => [node.id, node]));
    const backwards = result.edges.filter(edge => byId.get(edge.target)!.position.y < byId.get(edge.source)!.position.y);
    expect(backwards.length).toBeGreaterThan(0);
    for (const edge of backwards) {
      expect(['left', 'right']).toContain(edge.sourceHandle);
      expect(edge.targetHandle).toBe(edge.sourceHandle);
    }
    const entry = result.edges.find(edge => edge.id === 'entry')!;
    expect(entry.sourceHandle).toBe('bottom');
    expect(entry.targetHandle).toBe('top');
  });

  it('keeps disconnected components, isolated notes, and every node dimension without overlap', async () => {
    const doc: Diagram = {
      ...newDiagram('Separate components'),
      nodes: [node('wide', 'io', 1400, 190), node('tall', 'function', 380, 700), node('other-start'), node('other-end'), node('note', 'note', 600, 360)],
      edges: [edge('first', 'wide', 'tall', 'A longer label that reserves room between these differently sized shapes'), edge('second', 'other-start', 'other-end')],
    };
    const result = await autoArrange(doc);
    expect(result.nodes.map(node => node.id)).toEqual(doc.nodes.map(node => node.id));
    expect(result.nodes.map(({ width, height }) => ({ width, height }))).toEqual(doc.nodes.map(({ width, height }) => ({ width, height })));
    expect(portableContent(result)).toEqual(portableContent(doc));
    for (const node of result.nodes) {
      expect(Number.isFinite(node.position.x)).toBe(true);
      expect(Number.isFinite(node.position.y)).toBe(true);
      expect(Math.abs(node.position.x)).toBeLessThanOrEqual(100000);
      expect(Math.abs(node.position.y)).toBeLessThanOrEqual(100000);
    }
    assertNoOverlap(result);
  });

  it('produces the same actual ELK layout on repeat runs, including an already arranged graph', async () => {
    const original = branchingGraph();
    const first = await autoArrange(original);
    const second = await autoArrange(original);
    const third = await autoArrange(first);
    expect(second).toEqual(first);
    expect(third).toEqual(first);
  });

  it('handles empty and single-node diagrams while retaining independent snapshots', async () => {
    const empty = newDiagram();
    expect(await autoArrange(empty)).toEqual(empty);
    const single = { ...empty, nodes: [node('only', 'note', 700, 350)] };
    const result = await autoArrange(single);
    expect(result.nodes[0].position).toEqual({ x: 48, y: 48 });
    expect(portableContent(result)).toEqual(portableContent(single));
    result.nodes[0].notes = 'Changed';
    expect(single.nodes[0].notes).toBe('Notes for only');
  });

  it('supports imported IDs that resemble internal graph IDs', async () => {
    const doc = { ...newDiagram(), nodes: [node('layout-root'), node('node-0'), node('label-0')], edges: [edge('edge-0', 'layout-root', 'node-0', 'First'), edge('edge-1', 'node-0', 'label-0')] };
    const result = await autoArrange(doc);
    expect(portableContent(result)).toEqual(portableContent(doc));
    assertNoOverlap(result);
  });

  it('arranges 200 connected shapes without losing connections or overlapping shapes', async () => {
    const doc: Diagram = {
      ...newDiagram('200 connected shapes'),
      nodes: Array.from({ length: 200 }, (_, index) => node(`shape-${index}`)),
      edges: Array.from({ length: 199 }, (_, index) => edge(`connection-${index}`, `shape-${Math.floor(index / 2)}`, `shape-${index + 1}`)),
    };
    const result = await autoArrange(doc);
    expect(portableContent(result)).toEqual(portableContent(doc));
    assertNoOverlap(result);
    expect(() => validateDiagram(result)).not.toThrow();
  });

  it('rejects invalid source data before returning any replacement diagram', async () => {
    const invalid = branchingGraph();
    invalid.nodes[0].position.x = Number.NaN;
    await expect(autoArrange(invalid)).rejects.toThrow(/finite/);
  });
});
