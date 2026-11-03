import { beforeAll, describe, expect, it } from 'vitest';
import DOMPurify from 'dompurify';
import type { FlowDB } from 'mermaid/dist/diagrams/flowchart/flowDb.js';
import { createNode, exampleDiagram, newDiagram, NODE_TYPES } from './diagram';
import { encodeMermaidLabel, serializeMermaid } from './mermaid';

// The official grammar runs in Node; DOM sanitization belongs to Mermaid rendering.
// Production only generates plain text and never imports the Mermaid runtime.
Object.assign(DOMPurify, { sanitize: (text: string) => text, addHook: () => undefined });
let mermaid: typeof import('mermaid')['default'];
beforeAll(async () => {
  mermaid = (await import('mermaid')).default;
  mermaid.initialize({ securityLevel: 'strict', startOnLoad: false, htmlLabels: false });
});
async function database(code: string): Promise<FlowDB> { return (await mermaid.mermaidAPI.getDiagramFromText(code)).db as FlowDB; }
const decode = (text: string) => text.replace(/(?:ﬂ°°(\d+)¶ß|#(\d+);)/g, (_, encoded: string, digits: string) => String.fromCodePoint(Number(encoded ?? digits)));

describe('Mermaid export', () => {
  it('keeps ordinary code readable and escapes label syntax, HTML and directives', () => {
    expect(encodeMermaidLabel('Order received')).toBe('Order received');
    const label = '  A "quote" #34; <img src=x> & | [bracket]\nEmoji 🧭  ';
    expect(decode(encodeMermaidLabel(label))).toBe(label);
    expect(encodeMermaidLabel(label)).not.toContain('<img');
  });
  it('exports all 44 shapes as valid Mermaid without changing the document', async () => {
    const doc = newDiagram(); doc.nodes = NODE_TYPES.map(kind => createNode(kind, { x: 50, y: 60 }));
    const before = structuredClone(doc);
    const result = serializeMermaid(doc);
    const db = await database(result.code);
    expect(db.getVertices().size).toBe(NODE_TYPES.length);
    expect(db.getVertices().get('N7')?.type).toBe('round');
    expect(db.getVertices().get('N8')?.type).toBe('win-pane');
    expect(result.warnings.join(' ')).toContain('rectangles');
    expect(doc).toEqual(before);
  });
  it('preserves branches, loops, Unicode labels and IDs through the official parser', async () => {
    const doc = exampleDiagram();
    doc.nodes[0].label = ' leading "Q" <b>hello</b> #34;\n🧭 trailing ';
    doc.edges[0].label = 'Yes | "quoted"\n🧭';
    const db = await database(serializeMermaid(doc).code);
    expect([...db.getVertices().values()].map(node => decode(node.text!))).toEqual(doc.nodes.map(node => node.label));
    expect(db.getEdges().map(edge => decode(edge.text ?? ''))).toEqual(doc.edges.map(edge => edge.label));
    expect(db.getEdges().map(edge => [edge.start, edge.end])).toEqual([['N1', 'N2'], ['N2', 'N3'], ['N3', 'N4'], ['N3', 'N5'], ['N5', 'N2'], ['N4', 'N6']]);
  });
  it('emits solid, dashed, dotted, thick and two-way connections with color styles', async () => {
    const doc = exampleDiagram();
    doc.edges[0].style = { color: 'blue', lineStyle: 'dotted', width: 2.5, startMarker: 'arrow', endMarker: 'arrow' };
    doc.edges[1].style = { color: 'neutral', lineStyle: 'dashed', endMarker: 'none' };
    doc.edges[2].style = { color: 'rose', width: 5, startMarker: 'circle', endMarker: 'circle' };
    doc.edges[3].style = { color: 'neutral', endMarker: 'none' };
    const code = serializeMermaid(doc).code;
    const db = await database(code);
    expect(db.getEdges()[0]).toMatchObject({ type: 'double_arrow_point', stroke: 'dotted' });
    expect(db.getEdges()[1]).toMatchObject({ type: 'arrow_open', stroke: 'dotted' });
    expect(db.getEdges()[2]).toMatchObject({ type: 'double_arrow_circle', stroke: 'thick' });
    expect(db.getEdges()[3]).toMatchObject({ type: 'arrow_open', stroke: 'normal' });
    expect(code).toContain('stroke-dasharray:1 7.5');
    expect(code).toContain('stroke-width:5px');
  });
  it('keeps notes, drawings and app-specific shapes intact and reports export limits', () => {
    const doc = exampleDiagram(); doc.nodes[0].type = 'star'; doc.nodes[0].notes = 'Private note'; doc.nodes[0].groupId = 'group'; doc.nodes[0].locked = true;
    doc.drawings = [{ id: 'stroke', color: 'blue', width: 2, points: [{ x: 0, y: 0, pressure: 1 }] }];
    const before = structuredClone(doc);
    const result = serializeMermaid(doc);
    expect(result.warnings.join(' ')).toContain('Star');
    expect(result.warnings.join(' ')).toContain('JSON backup');
    expect(result.code).not.toContain('Private note');
    expect(doc).toEqual(before);
    expect(serializeMermaid(newDiagram())).toEqual({ code: 'flowchart TD\n', warnings: [] });
  });
});
