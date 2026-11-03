import { describe, expect, it } from 'vitest';
import { copyDiagram, DiagramValidationError, duplicateSelection, exampleDiagram, parseDiagram, serializeDiagram, validateDiagram } from './diagram';
import { CONNECTOR_PRESETS, EDGE_MARKERS, edgeDashArray, edgeMarkerId, markerMarkup, resolveEdgeStyle } from './connectors';
import { diagramToSvg } from './export';
import { colorValues } from './geometry';
import { copySelection, pasteSelection } from './editing';
import { commitHistory, createHistory, redoHistory, undoHistory } from './history';

describe('portable connector styles', () => {
  it('keeps existing files unchanged and resolves the original arrow defaults', () => {
    const doc = exampleDiagram();
    expect(parseDiagram(serializeDiagram(doc))).toEqual(doc);
    expect(parseDiagram(serializeDiagram(doc)).edges[0].style).toEqual({ color: 'neutral' });
    expect(resolveEdgeStyle(doc.edges[0].style)).toEqual({ color: 'neutral', width: 1.5, lineStyle: 'solid', startMarker: 'none', endMarker: 'arrow' });
  });

  it('preserves custom styles through JSON, copying, and selection duplication', () => {
    const doc = exampleDiagram();
    doc.edges[0].style = { color: 'rose', width: 3, lineStyle: 'dotted', startMarker: 'diamond-filled', endMarker: 'circle' };
    expect(parseDiagram(serializeDiagram(doc)).edges[0].style).toEqual(doc.edges[0].style);
    const copied = copyDiagram(doc);
    copied.edges[0].style.width = 8;
    expect(doc.edges[0].style.width).toBe(3);
    expect(duplicateSelection(doc, [doc.edges[0].source, doc.edges[0].target]).edges.at(-1)!.style).toEqual(doc.edges[0].style);
  });

  it('keeps styles through clipboard paste, unrelated edge edits, and undo/redo without shared references', () => {
    const doc = exampleDiagram();
    const edge = doc.edges[0];
    edge.style = { color: 'violet', width: 6, lineStyle: 'dashed', startMarker: 'circle', endMarker: 'open-arrow' };
    const fragment = copySelection(doc, [edge.source, edge.target])!;
    const pasted = pasteSelection(doc, fragment, { x: 1000, y: 1000 }).diagram;
    const copy = pasted.edges.at(-1)!;
    expect(copy.style).toEqual(edge.style);
    copy.style.width = 2;
    expect(edge.style.width).toBe(6);
    expect(fragment.edges[0].style.width).toBe(6);
    const edited = validateDiagram({ ...doc, edges: doc.edges.map(item => item.id === edge.id ? { ...item, label: 'Edited', sourceHandle: 'left', waypoints: [{ x: -100, y: 40 }] } : item) });
    const state = commitHistory(createHistory(doc), edited);
    expect(undoHistory(state).present.edges[0].style).toEqual(edge.style);
    expect(redoHistory(undoHistory(state)).present.edges[0]).toEqual(edited.edges[0]);
  });

  it.each([
    { lineStyle: 'stripes' }, { startMarker: 'script' }, { endMarker: 'curved' },
    { width: 0 }, { width: 8.1 }, { width: Infinity }, { width: '3' }, { opacity: 0.5 },
  ])('rejects invalid connector properties %j', patch => {
    const doc = exampleDiagram();
    Object.assign(doc.edges[0].style, patch);
    expect(() => validateDiagram(doc)).toThrow(DiagramValidationError);
  });

  it('validates every preset and marker without a schema version change', () => {
    for (const preset of CONNECTOR_PRESETS) {
      const doc = exampleDiagram();
      doc.edges[0].style = { color: 'blue', ...preset.style };
      expect(validateDiagram(doc).schemaVersion).toBe(1);
    }
    for (const marker of EDGE_MARKERS) {
      const doc = exampleDiagram();
      doc.edges[0].style = { color: 'blue', startMarker: marker, endMarker: marker };
      expect(validateDiagram(doc).edges[0].style.startMarker).toBe(marker);
    }
  });
});

describe('shared connector rendering', () => {
  it('uses width-scaled dash patterns and round-capped dots', () => {
    expect(edgeDashArray({ color: 'neutral' })).toBeUndefined();
    expect(edgeDashArray({ color: 'neutral', lineStyle: 'dashed', width: 2 })).toBe('10 6');
    expect(edgeDashArray({ color: 'neutral', lineStyle: 'dotted', width: 3 })).toBe('0 9');
  });

  it('defines every visible marker with reversed start orientation, explicit colors and dimensions', () => {
    for (const marker of EDGE_MARKERS) {
      const markup = markerMarkup(marker, 'rose', 4);
      if (marker === 'none') { expect(markup).toBe(''); continue; }
      expect(markup).toContain(`id="${edgeMarkerId(marker, 'rose', 4)}"`);
      expect(markup).toContain('orient="auto-start-reverse"');
      expect(markup).toContain('markerUnits="userSpaceOnUse"');
      expect(markup).toContain(`stroke="${colorValues('rose').stroke}"`);
      expect(markup).not.toMatch(/NaN|Infinity|undefined/);
      if (marker === 'triangle' || marker === 'circle' || marker === 'diamond') expect(markup).toContain('fill="#ffffff"');
    }
  });

  it('exports exact styles and colored endpoints with shared marker definitions', () => {
    const doc = exampleDiagram();
    doc.edges = doc.edges.slice(0, 2).map(edge => ({ ...edge, style: { color: 'violet' as const, width: 4, lineStyle: 'dotted' as const, startMarker: 'diamond' as const, endMarker: 'crowfoot' as const } }));
    const svg = diagramToSvg(doc);
    const edge = svg.match(/<path data-edge-id="[^"]+"[^>]+>/)![0];
    expect(edge).toContain('stroke="#8b70d5"');
    expect(edge).toContain('stroke-width="4"');
    expect(edge).toContain('stroke-dasharray="0 12"');
    expect(edge).toContain('stroke-linecap="round"');
    expect(edge).toContain('marker-start="url(#connector-diamond-violet-4)"');
    expect(edge).toContain('marker-end="url(#connector-crowfoot-violet-4)"');
    expect(svg.match(/<marker /g)).toHaveLength(2);
  });

  it('omits markers on plain lines and supports independent endpoint choices', () => {
    const doc = exampleDiagram();
    doc.edges = [doc.edges[0]];
    doc.edges[0].style = { color: 'blue', startMarker: 'none', endMarker: 'none' };
    expect(diagramToSvg(doc)).not.toMatch(/<marker|marker-start=|marker-end=/);
    doc.edges[0].style.startMarker = 'circle-filled';
    const svg = diagramToSvg(doc);
    expect(svg).toContain('marker-start="url(#connector-circle-filled-blue-1-5)"');
    expect(svg).not.toContain('marker-end=');
  });
});
