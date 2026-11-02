import { type Diagram, type DiagramNode, freshId, newDiagram, validateDiagram } from './diagram';
import type { Point } from './geometry';

export type ArrangeMode = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom' | 'horizontal' | 'vertical';

export function expandSelection(doc: Diagram, ids: readonly string[]): string[] {
  const selected = new Set(ids);
  const groups = new Set(doc.nodes.filter(node => selected.has(node.id) && node.groupId).map(node => node.groupId!));
  return doc.nodes.filter(node => selected.has(node.id) || (node.groupId !== undefined && groups.has(node.groupId))).map(node => node.id);
}

export function copySelection(doc: Diagram, ids: readonly string[]): Diagram | null {
  const selected = new Set(expandSelection(doc, ids));
  if (!selected.size) return null;
  return validateDiagram({
    ...newDiagram(doc.title), settings: { ...doc.settings },
    nodes: doc.nodes.filter(node => selected.has(node.id)),
    edges: doc.edges.filter(edge => selected.has(edge.source) && selected.has(edge.target)),
  });
}

function bounds(nodes: readonly DiagramNode[]) {
  const left = Math.min(...nodes.map(node => node.position.x));
  const top = Math.min(...nodes.map(node => node.position.y));
  const right = Math.max(...nodes.map(node => node.position.x + node.width));
  const bottom = Math.max(...nodes.map(node => node.position.y + node.height));
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

export function pasteSelection(doc: Diagram, fragment: Diagram, center: Point): { diagram: Diagram; nodeIds: string[] } {
  const source = validateDiagram({ ...fragment, drawings: [] });
  if (!source.nodes.length) return { diagram: doc, nodeIds: [] };
  const box = bounds(source.nodes);
  const delta = { x: center.x - (box.left + box.right) / 2, y: center.y - (box.top + box.bottom) / 2 };
  const ids = new Map(source.nodes.map(node => [node.id, freshId()]));
  const groupIds = new Set(source.nodes.flatMap(node => node.groupId === undefined ? [] : [node.groupId]));
  const groups = new Map([...groupIds].map(id => [id, freshId()]));
  const nodes = source.nodes.map(node => ({
    ...node, id: ids.get(node.id)!, position: { x: node.position.x + delta.x, y: node.position.y + delta.y },
    ...(node.groupId === undefined ? {} : { groupId: groups.get(node.groupId)! }),
  }));
  const edges = source.edges.map(edge => ({
    ...edge, id: freshId(), source: ids.get(edge.source)!, target: ids.get(edge.target)!,
    ...(edge.waypoints === undefined ? {} : { waypoints: edge.waypoints.map(point => ({ x: point.x + delta.x, y: point.y + delta.y })) }),
  }));
  return { diagram: validateDiagram({ ...doc, nodes: [...doc.nodes, ...nodes], edges: [...doc.edges, ...edges] }), nodeIds: nodes.map(node => node.id) };
}

interface Unit {
  nodes: DiagramNode[];
  groupId?: string;
  locked: boolean;
  box: ReturnType<typeof bounds>;
  order: number;
}

function selectionUnits(doc: Diagram, ids: readonly string[]): Unit[] {
  const selected = new Set(expandSelection(doc, ids));
  const groups = new Map<string, DiagramNode[]>();
  for (const node of doc.nodes) {
    if (node.groupId !== undefined) {
      const members = groups.get(node.groupId) ?? [];
      members.push(node); groups.set(node.groupId, members);
    }
  }
  const visited = new Set<string>();
  return doc.nodes.flatMap((node, order) => {
    if (!selected.has(node.id) || visited.has(node.id)) return [];
    const nodes = node.groupId === undefined ? [node] : groups.get(node.groupId)!;
    nodes.forEach(member => visited.add(member.id));
    return [{ nodes, groupId: node.groupId, locked: nodes.some(member => member.locked === true), box: bounds(nodes), order }];
  });
}

export function groupSelection(doc: Diagram, ids: readonly string[]): Diagram {
  const units = selectionUnits(doc, ids).filter(unit => !unit.locked);
  const nodes = units.flatMap(unit => unit.nodes);
  if (nodes.length < 2 || (units.length === 1 && units[0].groupId !== undefined)) return doc;
  const selected = new Set(nodes.map(node => node.id));
  const groupId = freshId();
  return validateDiagram({ ...doc, nodes: doc.nodes.map(node => selected.has(node.id) ? { ...node, groupId } : node) });
}

export function ungroupSelection(doc: Diagram, ids: readonly string[]): Diagram {
  const selected = new Set(selectionUnits(doc, ids).filter(unit => !unit.locked && unit.groupId !== undefined).flatMap(unit => unit.nodes.map(node => node.id)));
  if (!selected.size) return doc;
  return validateDiagram({ ...doc, nodes: doc.nodes.map(node => {
    if (!selected.has(node.id)) return node;
    const copy = { ...node }; delete copy.groupId; return copy;
  }) });
}

export function lockSelection(doc: Diagram, ids: readonly string[], locked: boolean): Diagram {
  const selected = new Set(expandSelection(doc, ids));
  let changed = false;
  const nodes = doc.nodes.map(node => {
    if (!selected.has(node.id) || Boolean(node.locked) === locked) return node;
    changed = true;
    const copy = { ...node };
    if (locked) copy.locked = true;
    else delete copy.locked;
    return copy;
  });
  return changed ? validateDiagram({ ...doc, nodes }) : doc;
}

export function moveNodes(doc: Diagram, positions: ReadonlyMap<string, Point>): Diagram {
  if (!positions.size) return doc;
  const byId = new Map(doc.nodes.map(node => [node.id, node]));
  const lockedGroups = new Set(doc.nodes.filter(node => node.locked && node.groupId !== undefined).map(node => node.groupId!));
  const groupDeltas = new Map<string, Point>();
  for (const [id, point] of positions) {
    const node = byId.get(id);
    if (node?.groupId !== undefined && !node.locked && !lockedGroups.has(node.groupId) && !groupDeltas.has(node.groupId)) {
      groupDeltas.set(node.groupId, { x: point.x - node.position.x, y: point.y - node.position.y });
    }
  }
  const moved = new Map<string, Point>();
  const nodes = doc.nodes.map(node => {
    if (node.locked || (node.groupId !== undefined && lockedGroups.has(node.groupId))) return node;
    const groupDelta = node.groupId === undefined ? undefined : groupDeltas.get(node.groupId);
    const point = positions.get(node.id) ?? (groupDelta ? { x: node.position.x + groupDelta.x, y: node.position.y + groupDelta.y } : undefined);
    if (!point || (point.x === node.position.x && point.y === node.position.y)) return node;
    moved.set(node.id, { x: point.x - node.position.x, y: point.y - node.position.y });
    return { ...node, position: { x: point.x, y: point.y } };
  });
  if (!moved.size) return doc;
  const edges = doc.edges.map(edge => {
    const source = moved.get(edge.source), target = moved.get(edge.target);
    if (!edge.waypoints?.length || !source || !target || Math.abs(source.x - target.x) > 1e-9 || Math.abs(source.y - target.y) > 1e-9) return edge;
    return { ...edge, waypoints: edge.waypoints.map(point => ({ x: point.x + source.x, y: point.y + source.y })) };
  });
  return validateDiagram({ ...doc, nodes, edges });
}

export function arrangeSelection(doc: Diagram, ids: readonly string[], mode: ArrangeMode): Diagram {
  const units = selectionUnits(doc, ids).filter(unit => !unit.locked);
  const distribute = mode === 'horizontal' || mode === 'vertical';
  if (units.length < (distribute ? 3 : 2)) return doc;
  const positions = new Map<string, Point>();
  const translate = (unit: Unit, x: number, y: number) => {
    for (const node of unit.nodes) positions.set(node.id, { x: node.position.x + x, y: node.position.y + y });
  };
  if (distribute) {
    const horizontal = mode === 'horizontal';
    const start = horizontal ? 'left' : 'top';
    const end = horizontal ? 'right' : 'bottom';
    const length = horizontal ? 'width' : 'height';
    const ordered = [...units].sort((a, b) => a.box[start] - b.box[start] || a.order - b.order);
    const first = ordered[0], last = ordered[ordered.length - 1];
    const gap = (last.box[end] - first.box[start] - ordered.reduce((total, unit) => total + unit.box[length], 0)) / (ordered.length - 1);
    let cursor = first.box[end] + gap;
    for (const unit of ordered.slice(1, -1)) {
      const delta = cursor - unit.box[start];
      translate(unit, horizontal ? delta : 0, horizontal ? 0 : delta);
      cursor += unit.box[length] + gap;
    }
  } else {
    const box = bounds(units.flatMap(unit => unit.nodes));
    for (const unit of units) {
      const x = mode === 'left' ? box.left - unit.box.left : mode === 'center' ? (box.left + box.right - unit.box.left - unit.box.right) / 2 : mode === 'right' ? box.right - unit.box.right : 0;
      const y = mode === 'top' ? box.top - unit.box.top : mode === 'middle' ? (box.top + box.bottom - unit.box.top - unit.box.bottom) / 2 : mode === 'bottom' ? box.bottom - unit.box.bottom : 0;
      translate(unit, x, y);
    }
  }
  return moveNodes(doc, positions);
}
