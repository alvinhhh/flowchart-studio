import type { ELK, ElkNode } from 'elkjs/lib/elk.bundled.js';
import { type Diagram, type DiagramEdge, type DiagramNode, type HandleId, validateDiagram } from './diagram';
import { edgeRoute, handlePoint, labelWidth, type Point, wrapLabel } from './geometry';

let engine: Promise<ELK> | undefined;

function layoutEngine(): Promise<ELK> {
  if (!engine) {
    engine = import('elkjs/lib/elk.bundled.js')
      .then(({ default: ELK }) => new ELK({ algorithms: ['layered'] }))
      .catch(error => { engine = undefined; throw error; });
  }
  return engine;
}

type ConnectionSides = { sourceHandle: HandleId; targetHandle: HandleId };
const negativeBranch = /^(no|false|fail(?:ed|ure)?|reject(?:ed)?|cancel(?:led|ed)?|invalid|error)$/i;
const positiveBranch = /^(yes|true|success|pass(?:ed)?|accept(?:ed)?|approved?|valid|ok)$/i;
const branchPriority = (edge: DiagramEdge): number => positiveBranch.test(edge.label.trim()) ? 0 : negativeBranch.test(edge.label.trim()) ? 2 : 1;
const centerX = (node: DiagramNode): number => node.position.x + node.width / 2;
const centerY = (node: DiagramNode): number => node.position.y + node.height / 2;

/** Back edges are drawn as return paths, without bending the forward flow around them. */
function flowGraph(doc: Diagram) {
  const outgoing = new Map(doc.nodes.map(node => [node.id, [] as DiagramEdge[]]));
  const incoming = new Map(doc.nodes.map(node => [node.id, 0]));
  for (const edge of doc.edges) {
    outgoing.get(edge.source)!.push(edge);
    incoming.set(edge.target, incoming.get(edge.target)! + 1);
  }
  for (const edges of outgoing.values()) edges.sort((a, b) => branchPriority(a) - branchPriority(b));
  const state = new Map<string, number>();
  const feedback = new Set<string>();
  const roots = [...doc.nodes.filter(node => incoming.get(node.id) === 0), ...doc.nodes.filter(node => incoming.get(node.id) !== 0)];
  for (const root of roots) {
    if (state.has(root.id)) continue;
    state.set(root.id, 1);
    const stack = [{ id: root.id, next: 0 }];
    while (stack.length) {
      const current = stack[stack.length - 1];
      const edge = outgoing.get(current.id)![current.next++];
      if (!edge) {
        state.set(current.id, 2);
        stack.pop();
      } else if (state.get(edge.target) === 1) {
        feedback.add(edge.id);
      } else if (!state.has(edge.target)) {
        state.set(edge.target, 1);
        stack.push({ id: edge.target, next: 0 });
      }
    }
  }
  const forward = new Map(doc.nodes.map(node => [node.id, outgoing.get(node.id)!.filter(edge => !feedback.has(edge.id))]));
  const sides = new Map<string, HandleId>();
  for (const edges of forward.values()) {
    const used = new Set<HandleId>(['bottom']);
    edges.forEach((edge, index) => {
      let side: HandleId = 'bottom';
      if (index) {
        side = negativeBranch.test(edge.label.trim()) ? 'left' : 'right';
        if (used.has(side) && !used.has(side === 'left' ? 'right' : 'left')) side = side === 'left' ? 'right' : 'left';
      }
      sides.set(edge.id, side);
      used.add(side);
    });
  }
  return { feedback, forward, sides };
}

function labelSize(label: string) {
  const lines = label ? wrapLabel(label, 160, 14) : [];
  return { width: lines.length ? Math.max(...lines.map(line => labelWidth(line, 14))) + 16 : 0, height: lines.length * 20 + (lines.length ? 8 : 0) };
}

function boxesOverlap(a: DiagramNode, b: DiagramNode, padding = 0): boolean {
  return a.position.x < b.position.x + b.width + padding && a.position.x + a.width + padding > b.position.x
    && a.position.y < b.position.y + b.height + padding && a.position.y + a.height + padding > b.position.y;
}

function routeFor(source: DiagramNode, target: DiagramNode, sides: ConnectionSides): Point[] {
  return edgeRoute(handlePoint(source, sides.sourceHandle), handlePoint(target, sides.targetHandle), sides.sourceHandle, sides.targetHandle).points;
}

function routeHitsNode(points: Point[], node: DiagramNode): boolean {
  const left = node.position.x - 8, right = node.position.x + node.width + 8;
  const top = node.position.y - 8, bottom = node.position.y + node.height + 8;
  return points.slice(1).some((point, index) => {
    const from = points[index];
    return from.x === point.x
      ? from.x > left && from.x < right && Math.max(from.y, point.y) > top && Math.min(from.y, point.y) < bottom
      : from.y > top && from.y < bottom && Math.max(from.x, point.x) > left && Math.min(from.x, point.x) < right;
  });
}

function crossings(a: Point[], b: Point[]): number {
  let count = 0;
  for (let i = 1; i < a.length; i++) for (let j = 1; j < b.length; j++) {
    const p = a[i - 1], q = a[i], r = b[j - 1], s = b[j];
    const vertical = p.x === q.x;
    if (vertical === (r.x === s.x)) continue;
    const x = vertical ? p.x : r.x;
    const y = vertical ? r.y : p.y;
    if (x > Math.min(vertical ? r.x : p.x, vertical ? s.x : q.x)
      && x < Math.max(vertical ? r.x : p.x, vertical ? s.x : q.x)
      && y > Math.min(vertical ? p.y : r.y, vertical ? q.y : s.y)
      && y < Math.max(vertical ? p.y : r.y, vertical ? q.y : s.y)) count++;
  }
  return count;
}

/** Internal layout accepts group bounds larger than a portable individual shape. */
async function layoutGraph(snapshot: Diagram): Promise<Diagram> {
  if (!snapshot.nodes.length) return snapshot;
  if (snapshot.nodes.length === 1) {
    return { ...snapshot, nodes: snapshot.nodes.map(node => ({ ...node, position: { x: 48, y: 48 } })) };
  }
  const { feedback, forward, sides } = flowGraph(snapshot);
  const nodeIds = new Map(snapshot.nodes.map((node, index) => [node.id, `node-${index}`]));
  const forwardEdges = snapshot.edges.filter(edge => !feedback.has(edge.id));
  const labelSizes = new Map(forwardEdges.map(edge => [edge.id, labelSize(edge.label)]));
  const layerGap = Math.max(72, ...[...labelSizes.values()].map(size => size.height + 40));
  const branchGap = Math.max(96, ...forwardEdges.filter(edge => sides.get(edge.id) !== 'bottom').map(edge => labelSizes.get(edge.id)!.width + 48));
  const graph: ElkNode = {
    id: 'layout-root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'DOWN',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.randomSeed': '1',
      'elk.padding': '[top=48,left=48,bottom=48,right=48]',
      'elk.separateConnectedComponents': 'true',
      'elk.spacing.componentComponent': '112',
      'elk.spacing.nodeNode': String(branchGap),
      'elk.spacing.edgeNode': '28',
      'elk.spacing.edgeEdge': '20',
      'elk.layered.spacing.nodeNodeBetweenLayers': String(layerGap),
      'elk.layered.spacing.edgeNodeBetweenLayers': '28',
      'elk.layered.spacing.edgeEdgeBetweenLayers': '20',
      'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
      'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
      'elk.layered.nodePlacement.favorStraightEdges': 'true',
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
      'elk.layered.thoroughness': '12',
    },
    children: snapshot.nodes.map(node => {
      const id = nodeIds.get(node.id)!;
      return {
        id, width: node.width, height: node.height,
        // Use the same contour anchors as the canvas and exported connections.
        layoutOptions: { 'elk.portConstraints': 'FIXED_POS' },
        ports: (['top', 'bottom', 'left', 'right'] as const).map(side => {
          const point = handlePoint({ ...node, position: { x: 0, y: 0 } }, side);
          const direction = { top: 'NORTH', bottom: 'SOUTH', left: 'WEST', right: 'EAST' }[side];
          return { id: `${id}-${side}`, ...point, width: 0, height: 0, layoutOptions: { 'elk.port.side': direction } };
        }),
      };
    }),
    // Edge-label dummy nodes add whole layers; reserve the rendered label dimensions in the gaps instead.
    edges: forwardEdges.map((edge, index) => ({
      id: `edge-${index}`, sources: [`${nodeIds.get(edge.source)!}-${sides.get(edge.id)!}`], targets: [`${nodeIds.get(edge.target)!}-top`],
    })),
  };
  const result = await (await layoutEngine()).layout(graph);
  const positions = new Map(result.children?.map(node => [node.id, node]));
  const nodes = snapshot.nodes.map(node => {
    const placed = positions.get(nodeIds.get(node.id)!);
    if (!placed || !Number.isFinite(placed.x) || !Number.isFinite(placed.y)) throw new Error('Auto arrange could not place every shape. The diagram has not been changed.');
    return { ...node, position: { x: placed.x!, y: placed.y! } };
  });
  const byId = new Map(nodes.map(node => [node.id, node]));
  const forwardIncoming = new Map(nodes.map(node => [node.id, 0]));
  for (const edge of forwardEdges) forwardIncoming.set(edge.target, forwardIncoming.get(edge.target)! + 1);

  // A short alternative or retry step can sit beside its decision, leaving the main path straight.
  const compacted = new Set<string>();
  for (const edge of forwardEdges) {
    if (sides.get(edge.id) === 'bottom' || forward.get(edge.target)!.length || forwardIncoming.get(edge.target) !== 1) continue;
    const source = byId.get(edge.source)!, target = byId.get(edge.target)!;
    const side: HandleId = centerX(target) < centerX(source) ? 'left' : 'right';
    const gap = side === 'left' ? source.position.x - target.position.x - target.width : target.position.x - source.position.x - source.width;
    if (gap < Math.max(64, labelSizes.get(edge.id)!.width + 32)) continue;
    const candidate = { ...target, position: { x: target.position.x, y: centerY(source) - target.height / 2 } };
    if (candidate.position.y < 48 || nodes.some(node => node.id !== target.id && boxesOverlap(candidate, node, 24))) continue;
    const route = routeFor(source, candidate, { sourceHandle: side, targetHandle: side === 'left' ? 'right' : 'left' });
    if (nodes.some(node => node.id !== source.id && node.id !== target.id && routeHitsNode(route, node))) continue;
    target.position = candidate.position;
    compacted.add(edge.id);
  }

  const routes: Point[][] = [];
  const edgeSides = new Map<string, ConnectionSides>();
  for (const edge of forwardEdges) {
    const source = byId.get(edge.source)!, target = byId.get(edge.target)!;
    let sourceHandle = sides.get(edge.id)!;
    let targetHandle: HandleId = 'top';
    if (compacted.has(edge.id)) {
      sourceHandle = centerX(target) < centerX(source) ? 'left' : 'right';
      targetHandle = sourceHandle === 'left' ? 'right' : 'left';
    }
    const connection = { sourceHandle, targetHandle };
    edgeSides.set(edge.id, connection);
    routes.push(routeFor(source, target, connection));
  }
  for (const edge of snapshot.edges.filter(edge => feedback.has(edge.id))) {
    const source = byId.get(edge.source)!, target = byId.get(edge.target)!;
    const candidates = (['left', 'right'] as const).map(side => {
      const connection = { sourceHandle: side, targetHandle: side };
      const points = routeFor(source, target, connection);
      const collisions = nodes.filter(node => node.id !== source.id && node.id !== target.id && routeHitsNode(points, node)).length;
      const intersections = routes.reduce((sum, route) => sum + crossings(points, route), 0);
      const length = points.slice(1).reduce((sum, point, index) => sum + Math.abs(point.x - points[index].x) + Math.abs(point.y - points[index].y), 0);
      return { connection, points, score: collisions * 1e9 + intersections * 1e6 + length };
    });
    candidates.sort((a, b) => a.score - b.score);
    edgeSides.set(edge.id, candidates[0].connection);
    routes.push(candidates[0].points);
  }
  // Include the return-path gutter in the outer margin.
  const left = Math.min(...nodes.map(node => node.position.x), ...routes.flatMap(route => route.map(point => point.x)));
  const top = Math.min(...nodes.map(node => node.position.y), ...routes.flatMap(route => route.map(point => point.y)));
  const dx = Math.max(0, 48 - left), dy = Math.max(0, 48 - top);
  for (const node of nodes) node.position = { x: node.position.x + dx, y: node.position.y + dy };
  return { ...snapshot, nodes, edges: snapshot.edges.map(edge => ({ ...edge, ...edgeSides.get(edge.id)! })) };
}


type LayoutUnit = {
  box: DiagramNode;
  members: DiagramNode[];
  fixed: boolean;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};
const UNIT_GAP = 32;

function withoutBends(edge: DiagramEdge): DiagramEdge {
  const copy = { ...edge };
  delete copy.waypoints;
  return copy;
}

function layoutUnits(snapshot: Diagram): { units: LayoutUnit[]; byNode: Map<string, LayoutUnit> } {
  const groups = new Map<string, DiagramNode[]>();
  for (const node of snapshot.nodes) {
    const key = node.groupId === undefined ? `node:${node.id}` : `group:${node.groupId}`;
    const members = groups.get(key);
    if (members) members.push(node);
    else groups.set(key, [node]);
  }
  const byNode = new Map<string, LayoutUnit>();
  const units = [...groups.values()].map((members, index) => {
    const left = Math.min(...members.map(node => node.position.x));
    const top = Math.min(...members.map(node => node.position.y));
    const right = Math.max(...members.map(node => node.position.x + node.width));
    const bottom = Math.max(...members.map(node => node.position.y + node.height));
    const unit: LayoutUnit = {
      box: { ...members[0], id: `unit-${index}`, type: 'process', position: { x: left, y: top }, width: right - left, height: bottom - top },
      members, fixed: members.some(node => node.locked === true), minX: -100000, minY: -100000,
      maxX: 100000 - Math.max(...members.map(node => node.position.x - left)),
      maxY: 100000 - Math.max(...members.map(node => node.position.y - top)),
    };
    for (const member of members) byNode.set(member.id, unit);
    return unit;
  });
  for (const edge of snapshot.edges) {
    const unit = byNode.get(edge.source)!;
    if (unit !== byNode.get(edge.target) || !edge.waypoints?.length) continue;
    for (const point of edge.waypoints) {
      const x = point.x - unit.box.position.x, y = point.y - unit.box.position.y;
      unit.minX = Math.max(unit.minX, -100000 - x); unit.maxX = Math.min(unit.maxX, 100000 - x);
      unit.minY = Math.max(unit.minY, -100000 - y); unit.maxY = Math.min(unit.maxY, 100000 - y);
    }
  }
  return { units, byNode };
}

/** A bounded nearest-first search keeps units close to their layered positions. */
function placeAroundObstacles(unit: LayoutUnit, preferred: Point, occupied: DiagramNode[]): DiagramNode {
  const box = unit.box;
  const clamp = (point: Point): Point => ({ x: Math.max(unit.minX, Math.min(unit.maxX, point.x)), y: Math.max(unit.minY, Math.min(unit.maxY, point.y)) });
  const desired = clamp(preferred);
  const score = (point: Point) => (point.x - desired.x) ** 2 + (point.y - desired.y) ** 2;
  const candidates: Point[] = [desired];
  const visited = new Set<string>();
  const add = (point: Point) => {
    const clamped = clamp(point), key = `${clamped.x}:${clamped.y}`;
    if (!visited.has(key)) { visited.add(key); candidates.push(clamped); }
  };
  visited.add(`${desired.x}:${desired.y}`);
  for (let attempt = 0; candidates.length && attempt < 256; attempt++) {
    candidates.sort((a, b) => score(a) - score(b) || a.y - b.y || a.x - b.x);
    const position = candidates.shift()!;
    const candidate = { ...box, position };
    const obstacle = occupied.find(other => boxesOverlap(candidate, other, UNIT_GAP));
    if (!obstacle) return candidate;
    add({ x: obstacle.position.x - box.width - UNIT_GAP, y: position.y });
    add({ x: obstacle.position.x + obstacle.width + UNIT_GAP, y: position.y });
    add({ x: position.x, y: obstacle.position.y - box.height - UNIT_GAP });
    add({ x: position.x, y: obstacle.position.y + obstacle.height + UNIT_GAP });
  }
  // Dense or unusually large diagrams still get a predictable, collision-free fallback.
  const left = Math.min(...occupied.map(other => other.position.x));
  const right = Math.max(...occupied.map(other => other.position.x + other.width));
  const top = Math.min(...occupied.map(other => other.position.y));
  const bottom = Math.max(...occupied.map(other => other.position.y + other.height));
  const fallback = [
    { x: right + UNIT_GAP, y: desired.y }, { x: left - box.width - UNIT_GAP, y: desired.y },
    { x: desired.x, y: bottom + UNIT_GAP }, { x: desired.x, y: top - box.height - UNIT_GAP },
    { x: unit.minX, y: unit.minY }, { x: unit.maxX, y: unit.maxY },
  ].map(clamp).sort((a, b) => score(a) - score(b) || a.y - b.y || a.x - b.x);
  for (const position of fallback) {
    const candidate = { ...box, position };
    if (!occupied.some(other => boxesOverlap(candidate, other, UNIT_GAP))) return candidate;
  }
  throw new Error('Auto arrange could not fit the editable shapes around locked shapes. The diagram has not been changed.');
}

async function arrangeUnits(snapshot: Diagram): Promise<Diagram> {
  const { units, byNode } = layoutUnits(snapshot);
  if (units.every(unit => unit.fixed)) return snapshot;
  const external = snapshot.edges.filter(edge => byNode.get(edge.source) !== byNode.get(edge.target));
  const proxy = {
    ...snapshot, nodes: units.map(unit => unit.box),
    edges: external.map(edge => ({ ...withoutBends(edge), source: byNode.get(edge.source)!.box.id, target: byNode.get(edge.target)!.box.id })),
  };
  const arranged = await layoutGraph(proxy);
  const laidOut = new Map(arranged.nodes.map(node => [node.id, node]));
  const edgeSides = new Map(arranged.edges.map(edge => [edge.id, edge]));
  const anchor = units.find(unit => unit.fixed);
  const offset = anchor ? {
    x: anchor.box.position.x - laidOut.get(anchor.box.id)!.position.x,
    y: anchor.box.position.y - laidOut.get(anchor.box.id)!.position.y,
  } : { x: 0, y: 0 };
  const placed = new Map<string, DiagramNode>();
  const occupied = units.filter(unit => unit.fixed).map(unit => unit.box);
  for (const unit of units.filter(unit => unit.fixed)) placed.set(unit.box.id, unit.box);
  const movable = units.filter(unit => !unit.fixed).sort((a, b) => {
    const first = laidOut.get(a.box.id)!, second = laidOut.get(b.box.id)!;
    return first.position.y - second.position.y || first.position.x - second.position.x;
  });
  for (const unit of movable) {
    const preferred = laidOut.get(unit.box.id)!.position;
    const box = placeAroundObstacles(unit, { x: preferred.x + offset.x, y: preferred.y + offset.y }, occupied);
    placed.set(unit.box.id, box); occupied.push(box);
  }
  const delta = (unit: LayoutUnit): Point => ({ x: placed.get(unit.box.id)!.position.x - unit.box.position.x, y: placed.get(unit.box.id)!.position.y - unit.box.position.y });
  const nodes = snapshot.nodes.map(node => {
    const unit = byNode.get(node.id)!;
    if (unit.fixed) return node;
    const change = delta(unit);
    return { ...node, position: { x: node.position.x + change.x, y: node.position.y + change.y } };
  });
  const edges = snapshot.edges.map(edge => {
    const source = byNode.get(edge.source)!, target = byNode.get(edge.target)!;
    if (source === target) {
      if (source.fixed || !edge.waypoints) return edge;
      const change = delta(source);
      return { ...edge, waypoints: edge.waypoints.map(point => ({ x: point.x + change.x, y: point.y + change.y })) };
    }
    if (source.fixed && target.fixed) return edge;
    const sides = edgeSides.get(edge.id)!;
    return { ...withoutBends(edge), sourceHandle: source.fixed ? edge.sourceHandle : sides.sourceHandle, targetHandle: target.fixed ? edge.targetHandle : sides.targetHandle };
  });
  return { ...snapshot, nodes, edges };
}

/** Preserves group geometry and locked units while arranging the editable graph. */
export async function autoArrange(doc: Diagram): Promise<Diagram> {
  const snapshot = validateDiagram(doc);
  const constrained = snapshot.nodes.some(node => node.groupId !== undefined || node.locked === true);
  return validateDiagram(constrained
    ? await arrangeUnits(snapshot)
    : await layoutGraph({ ...snapshot, edges: snapshot.edges.map(withoutBends) }));
}
