import { describe, expect, it } from 'vitest';
import { copyDiagram, createNode, DiagramValidationError, duplicateSelection, exampleDiagram, MAX_IMPORT_BYTES, newDiagram, NODE_TYPES, parseDiagram, serializeDiagram, validateDiagram } from './diagram';

describe('portable diagrams', () => {
  it('round trips groups, locks and bends, and duplicates groups independently', () => {
    const doc = exampleDiagram();
    doc.nodes[0].groupId = doc.nodes[1].groupId = 'pair';
    doc.nodes[0].locked = true;
    doc.edges[0].waypoints = [{ x: -40, y: 100 }];
    expect(parseDiagram(serializeDiagram(doc))).toEqual(doc);
    const duplicated = duplicateSelection(doc, doc.nodes.slice(0, 2).map(node => node.id));
    expect(duplicated.nodes[6].groupId).toBe(duplicated.nodes[7].groupId);
    expect(duplicated.nodes[6].groupId).not.toBe('pair');
    expect(duplicated.edges.at(-1)!.waypoints).toEqual([{ x: -8, y: 132 }]);
  });

  it('rejects malformed groups, locks and connection bends', () => {
    const doc = exampleDiagram();
    for (const fields of [{ groupId: '' }, { locked: 'yes' }]) {
      expect(() => validateDiagram({ ...doc, nodes: [{ ...doc.nodes[0], ...fields }, ...doc.nodes.slice(1)] })).toThrow(DiagramValidationError);
    }
    for (const waypoints of [[{ x: Infinity, y: 0 }], [{ x: 0, y: 0, selected: true }], Array(65).fill({ x: 0, y: 0 })]) {
      expect(() => validateDiagram({ ...doc, edges: [{ ...doc.edges[0], waypoints }] })).toThrow(DiagramValidationError);
    }
  });

  it('opens older files with no drawings or background setting', () => {
    const value = JSON.parse(JSON.stringify(exampleDiagram()));
    delete value.drawings;
    delete value.settings.background;
    expect(validateDiagram(value).drawings).toEqual([]);
    expect(validateDiagram(value).settings.background).toBe('dots');
    value.settings.gridVisible = false;
    expect(validateDiagram(value).settings.background).toBe('blank');
  });

  it('round trips every shape, pressure strokes, and background with independent copies', () => {
    const doc = newDiagram('Shapes and drawing');
    doc.nodes = NODE_TYPES.map((type, index) => createNode(type, { x: index * 200, y: 0 }));
    doc.drawings = [{ id: 'ink-1', width: 6, color: 'neutral', points: [{ x: -10, y: 25, pressure: .1 }, { x: 50, y: 40, pressure: 1 }] }];
    doc.settings.background = 'graph';
    const parsed = parseDiagram(serializeDiagram(doc));
    expect(parsed).toEqual(doc);
    const copied = copyDiagram(parsed);
    expect(copied.drawings[0]).toEqual({ ...doc.drawings[0], id: copied.drawings[0].id });
    expect(copied.drawings[0].id).not.toBe(doc.drawings[0].id);
    copied.drawings[0].points[0].x = 20;
    expect(doc.drawings[0].points[0].x).toBe(-10);
  });

  it('rejects invalid drawing data and conflicting IDs', () => {
    const doc = exampleDiagram();
    const stroke = { id: 'ink-1', width: 3, color: 'neutral', points: [{ x: 0, y: 0, pressure: .5 }] };
    for (const invalid of [{ ...stroke, id: doc.nodes[0].id }, { ...stroke, width: 0 }, { ...stroke, points: [] }, { ...stroke, points: [{ x: NaN, y: 0, pressure: .5 }] }, { ...stroke, points: [{ x: 0, y: 0, pressure: 2 }] }, { ...stroke, secret: 'unknown' }]) {
      expect(() => validateDiagram({ ...doc, drawings: [invalid] })).toThrow(DiagramValidationError);
    }
    expect(() => validateDiagram({ ...doc, drawings: Array(1001).fill(stroke) })).toThrow(/1,000/);
    expect(() => validateDiagram({ ...doc, drawings: [{ ...stroke, points: Array(20001).fill(stroke.points[0]) }] })).toThrow(/20,000/);
    expect(() => validateDiagram({ ...doc, settings: { ...doc.settings, background: 'photo' } })).toThrow(/background/);
  });

  it('round trips text and portable content without changing the source', () => {
    const doc = exampleDiagram();
    doc.nodes[0].label = '<script>literal text</script>\n日本語';
    doc.nodes[0].notes = 'First\nSecond';
    expect(parseDiagram(serializeDiagram(doc))).toEqual(doc);
    const copy = copyDiagram(doc, 'Copy');
    expect(copy.documentId).not.toBe(doc.documentId);
    expect(copy.revision).toBe(doc.revision);
    expect(copy.createdAt).toBe(doc.createdAt);
    expect(copy.nodes[0]).toEqual({ ...doc.nodes[0], id: copy.nodes[0].id });
    expect(copy.nodes.every((node) => !doc.nodes.some((original) => original.id === node.id))).toBe(true);
    expect(copy.edges[0].source).toBe(copy.nodes[0].id);
    expect(copy.edges[0].target).toBe(copy.nodes[1].id);
    expect(copy.edges[0].id).not.toBe(doc.edges[0].id);
    expect(copyDiagram(doc).title).toBe(doc.title);
  });

  it.each([
    ['future schema', (doc: Record<string, unknown>) => { doc.schemaVersion = 2; }],
    ['UI state', (doc: Record<string, unknown>) => { doc.selection = []; }],
    ['nested UI state', (doc: Record<string, unknown>) => { (doc.nodes as Record<string, unknown>[])[0].selected = true; }],
    ['missing title', (doc: Record<string, unknown>) => { delete doc.title; }],
    ['long title', (doc: Record<string, unknown>) => { doc.title = 'a'.repeat(201); }],
    ['invalid revision', (doc: Record<string, unknown>) => { doc.revision = 1.5; }],
    ['invalid date', (doc: Record<string, unknown>) => { doc.createdAt = 'yesterday'; }],
    ['invalid coordinate', (doc: Record<string, unknown>) => { ((doc.nodes as Record<string, unknown>[])[0].position as Record<string, unknown>).x = 100001; }],
    ['invalid size', (doc: Record<string, unknown>) => { (doc.nodes as Record<string, unknown>[])[0].width = 2001; }],
    ['invalid label', (doc: Record<string, unknown>) => { (doc.nodes as Record<string, unknown>[])[0].label = 'a'.repeat(4001); }],
    ['invalid notes', (doc: Record<string, unknown>) => { (doc.nodes as Record<string, unknown>[])[0].notes = 'a'.repeat(20001); }],
    ['invalid handle', (doc: Record<string, unknown>) => { (doc.edges as Record<string, unknown>[])[0].sourceHandle = 'other'; }],
    ['invalid reference', (doc: Record<string, unknown>) => { (doc.edges as Record<string, unknown>[])[0].source = 'missing'; }],
    ['duplicate IDs across types', (doc: Record<string, unknown>) => { (doc.edges as Record<string, unknown>[])[0].id = (doc.nodes as Record<string, unknown>[])[0].id; }],
    ['invalid zoom', (doc: Record<string, unknown>) => { (doc.viewport as Record<string, unknown>).zoom = 0.01; }],
  ] as const)('rejects %s', (_, mutate) => {
    const value = JSON.parse(JSON.stringify(exampleDiagram())) as Record<string, unknown>;
    mutate(value);
    expect(() => parseDiagram(JSON.stringify(value))).toThrow(DiagramValidationError);
  });

  it('rejects malformed, excessive, and nonfinite input with a typed error', () => {
    expect(() => parseDiagram('{')).toThrow(DiagramValidationError);
    expect(() => parseDiagram(' '.repeat(MAX_IMPORT_BYTES + 1))).toThrow(/10 MiB/);
    const doc = exampleDiagram();
    doc.nodes[0].position.x = Infinity;
    expect(() => validateDiagram(doc)).toThrow(/finite/);
    const empty = newDiagram();
    expect(() => validateDiagram({ ...empty, nodes: Array(5001).fill(createNode('process', { x: 0, y: 0 })) })).toThrow(/5,000/);
    expect(() => validateDiagram({ ...empty, edges: Array(10001).fill({}) })).toThrow(/10,000/);
  });

  it('accepts multi-node cycles and explains the self-connection limitation', () => {
    const doc = exampleDiagram();
    const edge = doc.edges[0];
    doc.edges.push({ ...edge, id: crypto.randomUUID(), source: edge.target, target: edge.source });
    expect(parseDiagram(serializeDiagram(doc)).edges).toHaveLength(7);
    doc.edges[0].target = doc.edges[0].source;
    expect(() => validateDiagram(doc)).toThrow(/same node.*not supported/);
  });

  it('duplicates selected nodes and only their internal connections', () => {
    const doc = exampleDiagram();
    const ids = doc.nodes.slice(0, 2).map((node) => node.id);
    const result = duplicateSelection(doc, ids);
    expect(doc.nodes).toHaveLength(6);
    expect(result.nodes).toHaveLength(8);
    expect(result.edges).toHaveLength(7);
    expect(result.nodes[6].position).toEqual({ x: doc.nodes[0].position.x + 32, y: doc.nodes[0].position.y + 32 });
    expect(result.edges[6].source).toBe(result.nodes[6].id);
    expect(result.edges[6].target).toBe(result.nodes[7].id);
    expect(duplicateSelection(doc, ids, []).edges).toHaveLength(6);
    expect(duplicateSelection(doc, ids, [doc.edges[0].id]).edges).toHaveLength(7);
    expect(duplicateSelection(doc, [ids[0]], doc.edges.map((edge) => edge.id)).edges).toHaveLength(6);
  });
});
