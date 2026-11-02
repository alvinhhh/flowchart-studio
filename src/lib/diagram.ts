export const NODE_TYPES = ['terminal', 'process', 'decision', 'io', 'function', 'note'] as const;
export const COLORS = ['neutral', 'blue', 'amber', 'rose', 'violet'] as const;
export const HANDLES = ['top', 'right', 'bottom', 'left'] as const;
export type NodeKind = (typeof NODE_TYPES)[number];
export type ColorName = (typeof COLORS)[number];
export type HandleId = (typeof HANDLES)[number];
export const NODE_TYPE_LABELS: Record<NodeKind, string> = {
  terminal: 'Start / End', process: 'Process', decision: 'Decision', io: 'Input / Output', function: 'Function', note: 'Note',
};
export const COLOR_LABELS: Record<ColorName, string> = {
  neutral: 'Neutral', blue: 'Blue', amber: 'Amber', rose: 'Rose', violet: 'Violet',
};

export interface DiagramNode {
  id: string;
  type: NodeKind;
  position: { x: number; y: number };
  width: number;
  height: number;
  label: string;
  notes: string;
  style: { color: ColorName };
}
export interface DiagramEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle: HandleId;
  targetHandle: HandleId;
  label: string;
  style: { color: ColorName };
}
export interface Diagram {
  schemaVersion: 1;
  documentId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  viewport: { x: number; y: number; zoom: number };
  settings: { snapToGrid: boolean; gridVisible: boolean };
}

export const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
export class DiagramValidationError extends Error {
  readonly issues: string[];
  constructor(message: string) {
    super(message);
    this.name = 'DiagramValidationError';
    this.issues = [message];
  }
}

const fail = (message: string): never => { throw new DiagramValidationError(message); };
function object(value: unknown, keys: string[], path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${path} must be an object.`);
  const record = value as Record<string, unknown>;
  const extra = Object.keys(record).find((key) => !keys.includes(key));
  if (extra !== undefined) fail(`${path}.${extra} is not supported. Remove editor-only or unknown fields.`);
  for (const key of keys) if (!Object.prototype.hasOwnProperty.call(record, key)) fail(`${path}.${key} is required.`);
  return record;
}
function string(value: unknown, max: number, path: string, required = false): string {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) {
    fail(`${path} must be ${required ? 'a nonempty string' : 'a string'} of at most ${max} characters.`);
  }
  return value as string;
}
function number(value: unknown, min: number, max: number, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    fail(`${path} must be a finite number between ${min} and ${max}.`);
  }
  return value as number;
}
function choice<T extends string>(value: unknown, choices: readonly T[], path: string): T {
  if (typeof value !== 'string' || !choices.includes(value as T)) fail(`${path} must be one of: ${choices.join(', ')}.`);
  return value as T;
}
function date(value: unknown, path: string): string {
  const result = string(value, 40, path, true);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(result) || !Number.isFinite(Date.parse(result)) || new Date(result).toISOString().slice(0, 19) !== result.slice(0, 19)) fail(`${path} must be a UTC ISO date.`);
  return result;
}
function color(value: unknown, path: string): { color: ColorName } {
  const style = object(value, ['color'], path);
  return { color: choice(style.color, COLORS, `${path}.color`) };
}

/** Validates unknown portable data and returns a fresh, editor-independent document. */
export function validateDiagram(value: unknown): Diagram {
  if (value && typeof value === 'object' && 'schemaVersion' in value && (value as {schemaVersion: unknown}).schemaVersion !== 1) {
    fail('This diagram version is not supported. Open it with a version that supports its schema.');
  }
  const doc = object(value, ['schemaVersion', 'documentId', 'title', 'createdAt', 'updatedAt', 'revision', 'nodes', 'edges', 'viewport', 'settings'], 'diagram');
  if (doc.schemaVersion !== 1) fail('diagram.schemaVersion must be 1.');
  const documentId = string(doc.documentId, 200, 'diagram.documentId', true);
  const revision = number(doc.revision, 0, Number.MAX_SAFE_INTEGER, 'diagram.revision');
  if (!Number.isSafeInteger(revision)) fail('diagram.revision must be a nonnegative safe integer.');
  if (!Array.isArray(doc.nodes) || doc.nodes.length > 5000) fail('diagram.nodes must be an array with at most 5,000 nodes.');
  if (!Array.isArray(doc.edges) || doc.edges.length > 10000) fail('diagram.edges must be an array with at most 10,000 connections.');
  const ids = new Set<string>([documentId]);
  function id(value: unknown, path: string) {
    const result = string(value, 200, path, true);
    if (ids.has(result)) fail(`${path}: duplicate ID "${result}". Node and connection IDs must be unique.`);
    ids.add(result);
    return result;
  }
  const nodes: DiagramNode[] = (doc.nodes as unknown[]).map((value, index) => {
    const path = `nodes[${index}]`;
    const node = object(value, ['id', 'type', 'position', 'width', 'height', 'label', 'notes', 'style'], path);
    const position = object(node.position, ['x', 'y'], `${path}.position`);
    return {
      id: id(node.id, `${path}.id`), type: choice(node.type, NODE_TYPES, `${path}.type`),
      position: { x: number(position.x, -100000, 100000, `${path}.position.x`), y: number(position.y, -100000, 100000, `${path}.position.y`) },
      width: number(node.width, 1, 2000, `${path}.width`), height: number(node.height, 1, 2000, `${path}.height`),
      label: string(node.label, 4000, `${path}.label`), notes: string(node.notes, 20000, `${path}.notes`), style: color(node.style, `${path}.style`),
    };
  });
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges: DiagramEdge[] = (doc.edges as unknown[]).map((value, index) => {
    const path = `edges[${index}]`;
    const edge = object(value, ['id', 'source', 'target', 'sourceHandle', 'targetHandle', 'label', 'style'], path);
    const source = string(edge.source, 200, `${path}.source`, true);
    const target = string(edge.target, 200, `${path}.target`, true);
    if (!nodeIds.has(source) || !nodeIds.has(target)) fail(`${path} references a missing node.`);
    if (source === target) fail(`${path}: connections back to the same node are not supported in this version. Connect through another node.`);
    return { id: id(edge.id, `${path}.id`), source, target, sourceHandle: choice(edge.sourceHandle, HANDLES, `${path}.sourceHandle`), targetHandle: choice(edge.targetHandle, HANDLES, `${path}.targetHandle`), label: string(edge.label, 4000, `${path}.label`), style: color(edge.style, `${path}.style`) };
  });
  const viewport = object(doc.viewport, ['x', 'y', 'zoom'], 'diagram.viewport');
  const settings = object(doc.settings, ['snapToGrid', 'gridVisible'], 'diagram.settings');
  if (typeof settings.snapToGrid !== 'boolean' || typeof settings.gridVisible !== 'boolean') fail('diagram.settings values must be true or false.');
  return {
    schemaVersion: 1, documentId, title: string(doc.title, 200, 'diagram.title'),
    createdAt: date(doc.createdAt, 'diagram.createdAt'), updatedAt: date(doc.updatedAt, 'diagram.updatedAt'), revision, nodes, edges,
    viewport: { x: number(viewport.x, -100000, 100000, 'diagram.viewport.x'), y: number(viewport.y, -100000, 100000, 'diagram.viewport.y'), zoom: number(viewport.zoom, 0.1, 4, 'diagram.viewport.zoom') },
    settings: { snapToGrid: settings.snapToGrid as boolean, gridVisible: settings.gridVisible as boolean },
  };
}

export function parseDiagram(text: string): Diagram {
  if (text.length > MAX_IMPORT_BYTES || new TextEncoder().encode(text).byteLength > MAX_IMPORT_BYTES) fail('This file exceeds the 10 MiB import limit.');
  let value: unknown;
  try { value = JSON.parse(text); } catch { fail('This file is not valid JSON. Select a diagram JSON file.'); }
  return validateDiagram(value);
}
export function serializeDiagram(doc: Diagram): string {
  return JSON.stringify(validateDiagram(doc), null, 2);
}
export const freshId = (): string => crypto.randomUUID();
export function newDiagram(title = 'Untitled diagram'): Diagram {
  const now = new Date().toISOString();
  return { schemaVersion: 1, documentId: freshId(), title, createdAt: now, updatedAt: now, revision: 0, nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 }, settings: { snapToGrid: true, gridVisible: true } };
}
export function createNode(type: NodeKind, position: { x: number; y: number }): DiagramNode {
  const decision = type === 'decision';
  return { id: freshId(), type, position: { ...position }, width: decision ? 180 : 176, height: decision ? 120 : type === 'note' ? 100 : 80, label: NODE_TYPE_LABELS[type], notes: '', style: { color: 'neutral' } };
}
export function copyDiagram(doc: Diagram, title = doc.title): Diagram {
  const copy = validateDiagram(doc);
  const ids = new Map(copy.nodes.map((node) => [node.id, freshId()]));
  return validateDiagram({ ...copy, documentId: freshId(), title, nodes: copy.nodes.map((node) => ({ ...node, id: ids.get(node.id)! })), edges: copy.edges.map((edge) => ({ ...edge, id: freshId(), source: ids.get(edge.source)!, target: ids.get(edge.target)! })) });
}
export function duplicateSelection(doc: Diagram, nodeIds: string[], edgeIds?: string[]): Diagram {
  const copy = validateDiagram(doc);
  const selected = new Set(nodeIds);
  const selectedEdges = edgeIds === undefined ? undefined : new Set(edgeIds);
  const ids = new Map(copy.nodes.filter((node) => selected.has(node.id)).map((node) => [node.id, freshId()]));
  const nodes = copy.nodes.filter((node) => ids.has(node.id)).map((node) => ({ ...node, id: ids.get(node.id)!, position: { x: node.position.x + 32, y: node.position.y + 32 } }));
  const edges = copy.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target) && (selectedEdges === undefined || selectedEdges.has(edge.id))).map((edge) => ({ ...edge, id: freshId(), source: ids.get(edge.source)!, target: ids.get(edge.target)! }));
  return validateDiagram({ ...copy, nodes: [...copy.nodes, ...nodes], edges: [...copy.edges, ...edges] });
}
export function exampleDiagram(): Diagram {
  const doc = newDiagram('Order review');
  const start = createNode('terminal', { x: 320, y: 40 }); start.label = 'Order received';
  const review = createNode('process', { x: 320, y: 200 }); review.label = 'Review order'; review.style.color = 'blue';
  const decision = createNode('decision', { x: 318, y: 370 }); decision.label = 'Approved?'; decision.style.color = 'amber';
  const ship = createNode('process', { x: 640, y: 390 }); ship.label = 'Ship order'; ship.style.color = 'blue';
  const revise = createNode('io', { x: 30, y: 390 }); revise.label = 'Request changes'; revise.style.color = 'rose';
  const done = createNode('terminal', { x: 640, y: 570 }); done.label = 'Complete';
  const connect = (source: DiagramNode, target: DiagramNode, sourceHandle: HandleId = 'bottom', targetHandle: HandleId = 'top', label = ''): DiagramEdge => ({ id: freshId(), source: source.id, target: target.id, sourceHandle, targetHandle, label, style: { color: 'neutral' } });
  return { ...doc, nodes: [start, review, decision, ship, revise, done], edges: [connect(start, review), connect(review, decision), connect(decision, ship, 'right', 'left', 'Yes'), connect(decision, revise, 'left', 'right', 'No'), connect(revise, review, 'top', 'left'), connect(ship, done)] };
}
