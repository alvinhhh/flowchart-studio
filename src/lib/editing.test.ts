import { describe, expect, it } from 'vitest';
import { type Diagram, type DiagramNode, newDiagram, parseDiagram, serializeDiagram } from './diagram';
import { arrangeSelection, copySelection, expandSelection, groupSelection, lockSelection, moveNodes, pasteSelection, ungroupSelection } from './editing';

function node(id: string, x: number, y: number, width = 80, height = 60, groupId?: string): DiagramNode {
  return { id, type: 'process', position: { x, y }, width, height, label: `${id} — 確認`, notes: `Notes for ${id}`, style: { color: 'blue' }, ...(groupId ? { groupId } : {}) };
}
function fixture(): Diagram {
  return {
    ...newDiagram('Editing fixture'),
    nodes: [node('a', -120, -40, 80, 60, 'group'), node('b', 40, 70, 120, 80, 'group'), node('c', 400, -300, 60, 100), node('d', 700, 400, 100, 80)],
    edges: [
      { id: 'inside', source: 'a', target: 'b', sourceHandle: 'bottom', targetHandle: 'top', label: 'Continue', style: { color: 'violet' }, waypoints: [{ x: 0, y: 0 }, { x: 25, y: 40 }] },
      { id: 'outside', source: 'b', target: 'c', sourceHandle: 'right', targetHandle: 'left', label: 'External', style: { color: 'neutral' }, waypoints: [{ x: 250, y: 90 }] },
    ],
    drawings: [{ id: 'drawing', color: 'rose', width: 3, points: [{ x: 20, y: 30, pressure: 0.5 }] }],
  };
}
const positions = (doc: Diagram) => doc.nodes.map(node => node.position);

describe('selection clipboard', () => {
  it('expands whole groups in document order, drops unknown IDs, and copies only internal edges', () => {
    const doc = fixture(); doc.nodes[0].locked = true;
    expect(expandSelection(doc, ['b', 'unknown', 'b'])).toEqual(['a', 'b']);
    const copy = copySelection(doc, ['b'])!;
    expect(copy.documentId).not.toBe(doc.documentId);
    expect(copy.nodes).toEqual(doc.nodes.slice(0, 2));
    expect(copy.edges).toEqual([doc.edges[0]]);
    expect(copy.drawings).toEqual([]);
    expect(copy.settings).toEqual(doc.settings);
    expect(parseDiagram(serializeDiagram(copy))).toEqual(copy);
    copy.nodes[0].notes = 'Local clipboard change';
    copy.edges[0].waypoints![0].x = 999;
    expect(doc.nodes[0].notes).toBe('Notes for a');
    expect(doc.edges[0].waypoints![0].x).toBe(0);
    expect(copySelection(doc, ['unknown'])).toBeNull();
  });

  it('pastes centered shapes with fresh node, edge, and group IDs and translated waypoints', () => {
    const source = fixture(); source.nodes[0].locked = true;
    const fragment = copySelection(source, ['a'])!;
    fragment.drawings = source.drawings;
    const doc = fixture();
    const before = structuredClone({ doc, fragment });
    const result = pasteSelection(doc, fragment, { x: 100, y: 200 });
    const pasted = result.diagram.nodes.slice(doc.nodes.length);
    expect(result.nodeIds).toEqual(pasted.map(node => node.id));
    expect(new Set(result.diagram.nodes.map(node => node.id)).size).toBe(6);
    expect(pasted[0].position).toEqual({ x: -40, y: 105 });
    expect(pasted[1].position).toEqual({ x: 120, y: 215 });
    expect(pasted[0]).toEqual({ ...fragment.nodes[0], id: pasted[0].id, groupId: pasted[0].groupId, position: pasted[0].position });
    expect(pasted[0].groupId).toBe(pasted[1].groupId);
    expect(pasted[0].groupId).not.toBe('group');
    expect(pasted[0].locked).toBe(true);
    const pastedEdge = result.diagram.edges.at(-1)!;
    expect(pastedEdge.id).not.toBe('inside');
    expect(pastedEdge.source).toBe(pasted[0].id);
    expect(pastedEdge.target).toBe(pasted[1].id);
    expect(pastedEdge.waypoints).toEqual([{ x: 80, y: 145 }, { x: 105, y: 185 }]);
    expect(pastedEdge.label).toBe('Continue');
    expect(pastedEdge.style).toEqual({ color: 'violet' });
    expect(result.diagram.drawings).toEqual(doc.drawings);
    expect({ doc, fragment }).toEqual(before);
  });

  it('does not merge distinct pasted groups or group IDs already present at the destination', () => {
    const source = fixture(); source.nodes[2].groupId = 'other'; source.nodes[3].groupId = 'other';
    const first = pasteSelection(source, source, { x: -500, y: -500 });
    const second = pasteSelection(first.diagram, source, { x: -468, y: -468 });
    const groups = second.diagram.nodes.map(node => node.groupId).filter(Boolean);
    expect(new Set(groups).size).toBe(6);
    expect(second.nodeIds.every(id => !first.nodeIds.includes(id))).toBe(true);
  });

  it('returns the original document for an empty fragment and rejects invalid placement atomically', () => {
    const doc = fixture(), before = structuredClone(doc);
    expect(pasteSelection(doc, newDiagram(), { x: 0, y: 0 })).toEqual({ diagram: doc, nodeIds: [] });
    expect(pasteSelection(doc, newDiagram(), { x: 0, y: 0 }).diagram).toBe(doc);
    expect(() => pasteSelection(doc, copySelection(doc, ['a'])!, { x: Infinity, y: 0 })).toThrow(/finite/);
    expect(doc).toEqual(before);
  });
});

describe('groups and locks', () => {
  it('merges full editable groups with selected nodes and ungroups every member together', () => {
    const doc = fixture();
    const grouped = groupSelection(doc, ['b', 'c']);
    const group = grouped.nodes[0].groupId;
    expect(group).toBeTruthy();
    expect(group).not.toBe('group');
    expect(grouped.nodes.slice(0, 3).every(node => node.groupId === group)).toBe(true);
    expect(grouped.nodes[3].groupId).toBeUndefined();
    expect(positions(grouped)).toEqual(positions(doc));
    expect(grouped.edges).toEqual(doc.edges);
    const ungrouped = ungroupSelection(grouped, ['b']);
    expect(ungrouped.nodes.every(node => node.groupId === undefined)).toBe(true);
    expect(doc.nodes[0].groupId).toBe('group');
  });

  it('locks and unlocks an entire selected group while preserving unrelated nodes', () => {
    const doc = fixture();
    const locked = lockSelection(doc, ['b'], true);
    expect(locked.nodes.slice(0, 2).every(node => node.locked === true)).toBe(true);
    expect(locked.nodes.slice(2).every(node => !node.locked)).toBe(true);
    expect(lockSelection(locked, ['a'], true)).toBe(locked);
    const unlocked = lockSelection(locked, ['a'], false);
    expect(unlocked.nodes.every(node => node.locked === undefined)).toBe(true);
    expect(lockSelection(unlocked, ['b'], false)).toBe(unlocked);
  });

  it('protects a group containing any locked member from movement, grouping, and ungrouping', () => {
    const doc = fixture(); doc.nodes[1].locked = true;
    expect(moveNodes(doc, new Map([['a', { x: 0, y: 0 }]]))).toBe(doc);
    expect(groupSelection(doc, ['a', 'c'])).toBe(doc);
    expect(ungroupSelection(doc, ['a'])).toBe(doc);
    expect(arrangeSelection(doc, ['a', 'c'], 'left')).toBe(doc);
    const unlocked = lockSelection(doc, ['a'], false);
    expect(unlocked.nodes[1].locked).toBeUndefined();
    expect(moveNodes(unlocked, new Map([['a', { x: 0, y: 0 }]]))).not.toBe(unlocked);
  });

  it('avoids redundant group/ungroup actions for insufficient or already grouped selections', () => {
    const doc = fixture();
    expect(groupSelection(doc, ['a'])).toBe(doc);
    expect(groupSelection(doc, ['c'])).toBe(doc);
    expect(groupSelection(doc, [])).toBe(doc);
    expect(ungroupSelection(doc, ['c', 'unknown'])).toBe(doc);
    expect(lockSelection(doc, ['unknown'], true)).toBe(doc);
  });
});

describe('moving and arranging', () => {
  it('propagates the first explicit member movement to the rest of its group and route points', () => {
    const doc = fixture(), before = structuredClone(doc);
    const moved = moveNodes(doc, new Map([['b', { x: 70, y: 80 }]]));
    expect(moved.nodes[0].position).toEqual({ x: -90, y: -30 });
    expect(moved.nodes[1].position).toEqual({ x: 70, y: 80 });
    expect(moved.edges[0].waypoints).toEqual([{ x: 30, y: 10 }, { x: 55, y: 50 }]);
    expect(moved.edges[1].waypoints).toEqual(doc.edges[1].waypoints);
    expect(doc).toEqual(before);
  });

  it('respects explicit positions and leaves manual routes unchanged when endpoints move differently', () => {
    const doc = fixture();
    const moved = moveNodes(doc, new Map([['a', { x: -110, y: -20 }], ['b', { x: 70, y: 80 }]]));
    expect(moved.nodes[0].position).toEqual({ x: -110, y: -20 });
    expect(moved.nodes[1].position).toEqual({ x: 70, y: 80 });
    expect(moved.edges[0].waypoints).toEqual(doc.edges[0].waypoints);
  });

  it('translates routes for equally moved independent nodes and ignores locked standalone nodes', () => {
    const doc = fixture(); delete doc.nodes[0].groupId; delete doc.nodes[1].groupId;
    doc.nodes[2].locked = true;
    const moved = moveNodes(doc, new Map([['a', { x: -110, y: -20 }], ['b', { x: 50, y: 90 }], ['c', { x: 0, y: 0 }]]));
    expect(moved.edges[0].waypoints).toEqual([{ x: 10, y: 20 }, { x: 35, y: 60 }]);
    expect(moved.nodes[2].position).toEqual(doc.nodes[2].position);
  });

  it.each(['left', 'center', 'right', 'top', 'middle', 'bottom'] as const)('aligns %s using the group bounding box while preserving member offsets', mode => {
    const doc = fixture();
    const arranged = arrangeSelection(doc, ['b', 'c', 'd'], mode);
    const a = arranged.nodes[0], b = arranged.nodes[1], c = arranged.nodes[2], d = arranged.nodes[3];
    expect({ x: b.position.x - a.position.x, y: b.position.y - a.position.y }).toEqual({ x: 160, y: 110 });
    const group = { left: a.position.x, right: b.position.x + b.width, top: a.position.y, bottom: b.position.y + b.height };
    if (mode === 'left') expect([group.left, c.position.x, d.position.x]).toEqual([-120, -120, -120]);
    if (mode === 'center') expect([(group.left + group.right) / 2, c.position.x + c.width / 2, d.position.x + d.width / 2]).toEqual([340, 340, 340]);
    if (mode === 'right') expect([group.right, c.position.x + c.width, d.position.x + d.width]).toEqual([800, 800, 800]);
    if (mode === 'top') expect([group.top, c.position.y, d.position.y]).toEqual([-300, -300, -300]);
    if (mode === 'middle') expect([(group.top + group.bottom) / 2, c.position.y + c.height / 2, d.position.y + d.height / 2]).toEqual([90, 90, 90]);
    if (mode === 'bottom') expect([group.bottom, c.position.y + c.height, d.position.y + d.height]).toEqual([480, 480, 480]);
  });

  it('distributes unequal widths with equal gaps and fixes the outer positions, including negative coordinates', () => {
    const doc = { ...newDiagram(), nodes: [node('a', -200, -20, 40), node('b', -10, 30, 100), node('c', 200, -50, 60)] };
    const arranged = arrangeSelection(doc, ['c', 'a', 'b'], 'horizontal');
    expect(positions(arranged)).toEqual([{ x: -200, y: -20 }, { x: -30, y: 30 }, { x: 200, y: -50 }]);
    expect(arranged.nodes[1].position.x - arranged.nodes[0].position.x - arranged.nodes[0].width).toBe(130);
    expect(arranged.nodes[2].position.x - arranged.nodes[1].position.x - arranged.nodes[1].width).toBe(130);
  });

  it('distributes unequal heights vertically and treats a multi-node group as one outer unit', () => {
    const doc = { ...newDiagram(), nodes: [node('a', 0, -200, 80, 30), node('b', 10, -10, 80, 80), node('c', 20, 200, 80, 50)] };
    expect(positions(arrangeSelection(doc, ['a', 'b', 'c'], 'vertical'))).toEqual([{ x: 0, y: -200 }, { x: 10, y: -25 }, { x: 20, y: 200 }]);
    const grouped = { ...newDiagram(), nodes: [node('a', -200, 0, 40, 60, 'g'), node('a2', -130, 20, 20, 60, 'g'), node('b', -10, 0, 100), node('c', 200, 0, 60)] };
    const result = arrangeSelection(grouped, ['a2', 'b', 'c'], 'horizontal');
    expect(result.nodes[2].position.x).toBe(-5);
    expect(positions(result).slice(0, 2)).toEqual(positions(grouped).slice(0, 2));
    expect(result.nodes[3].position).toEqual(grouped.nodes[3].position);
  });

  it('excludes locked units from arrangement bounds and preserves no-op identity', () => {
    const doc = fixture(); doc.nodes[0].locked = true;
    const aligned = arrangeSelection(doc, ['a', 'c', 'd'], 'left');
    expect(aligned.nodes[3].position.x).toBe(400);
    expect(positions(aligned).slice(0, 2)).toEqual(positions(doc).slice(0, 2));
    expect(arrangeSelection(doc, ['a', 'c', 'd'], 'horizontal')).toBe(doc);
    expect(arrangeSelection(doc, ['c'], 'top')).toBe(doc);
    expect(arrangeSelection(doc, [], 'left')).toBe(doc);
    expect(moveNodes(doc, new Map())).toBe(doc);
    expect(moveNodes(doc, new Map([['unknown', { x: 0, y: 0 }]]))).toBe(doc);
    expect(moveNodes(doc, new Map([['c', { ...doc.nodes[2].position }]]))).toBe(doc);
    expect(arrangeSelection(aligned, ['c', 'd'], 'left')).toBe(aligned);
  });

  it('rejects out-of-bounds moves without altering any input', () => {
    const doc = fixture(), before = structuredClone(doc);
    expect(() => moveNodes(doc, new Map([['c', { x: 100001, y: 0 }]]))).toThrow(/100000/);
    expect(doc).toEqual(before);
  });
});
