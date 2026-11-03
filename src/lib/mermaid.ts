import { validateDiagram, NODE_TYPE_LABELS, type Diagram, type NodeKind } from './diagram';
import { resolveEdgeStyle, type EdgeStyle } from './connectors';
import { colorValues } from './geometry';

const classicShapes: Partial<Record<NodeKind, [string, string]>> = {
  process: ['[', ']'], terminal: ['([', '])'], decision: ['{', '}'], io: ['[/', '/]'],
  function: ['[[', ']]'], connector: ['((', '))'], alternate_process: ['(', ')'],
  database: ['[(', ')]'], preparation: ['{{', '}}'], manual_operation: ['[\\', '/]'],
};
// Mermaid 11.3+ shape names, shared with the standard flowchart vocabulary.
const extendedShapes: Partial<Record<NodeKind, string>> = {
  note: 'doc', internal_storage: 'win-pane', document: 'doc', multi_document: 'docs',
  manual_input: 'sl-rect', card: 'notch-rect', paper_tape: 'flag', summing_junction: 'cross-circ',
  collate: 'hourglass', extract: 'tri', merge: 'flip-tri', stored_data: 'bow-rect', delay: 'delay',
  direct_data: 'h-cyl', display: 'curv-trap', annotation: 'brace', loop_limit: 'notch-pent', cloud: 'cloud',
};
/** Escape Mermaid syntax while keeping ordinary labels readable in source. */
export function encodeMermaidLabel(label: string): string {
  const start = Array.from(label.match(/^ */)?.[0] ?? '').length;
  const end = Array.from(label).length - Array.from(label.match(/ *$/)?.[0] ?? '').length;
  return Array.from(label, (char, index) => /["#%<>|[\]{}\\;&`\u0000-\u001f\u007f]/u.test(char) || (char === ' ' && (index < start || index >= end)) ? `#${char.codePointAt(0)};` : char).join('');
}
function edgeSyntax(style: EdgeStyle): string {
  const value = resolveEdgeStyle(style);
  const both = value.startMarker === value.endMarker && value.startMarker !== 'none';
  const end = value.endMarker === 'none' ? '' : value.endMarker === 'circle' || value.endMarker === 'circle-filled' ? 'o' : '>';
  const start = both ? (end === '>' ? '<' : end) : '';
  const line = value.lineStyle === 'solid' ? value.width >= 3 ? '===' : '---' : '-.-';
  return `${start}${end && value.lineStyle === 'solid' ? line.slice(0, -1) : line}${end}`;
}
export interface MermaidSerialization { code: string; warnings: string[] }
/** Generates detached Mermaid text. Export never changes the editable document. */
export function serializeMermaid(diagram: Diagram): MermaidSerialization {
  const doc = validateDiagram(diagram);
  const warnings: string[] = [];
  const projected = [...new Set(doc.nodes.filter(node => !classicShapes[node.type] && !extendedShapes[node.type]).map(node => NODE_TYPE_LABELS[node.type]))];
  if (projected.length) warnings.push(`Mermaid uses rectangles for: ${projected.join(', ')}.`);
  if (doc.nodes.some(node => node.notes || node.groupId || node.locked) || doc.drawings.length) warnings.push('Mermaid files omit notes, drawings, groups and locks. Use JSON backup to keep all editor data.');
  if (doc.nodes.length) warnings.push('Mermaid determines layout; canvas positions, sizes and connection bends are not included.');
  if (doc.edges.some(edge => { const s = resolveEdgeStyle(edge.style); return !['none', 'arrow', 'circle'].includes(s.startMarker) || !['none', 'arrow', 'circle'].includes(s.endMarker) || (s.startMarker !== 'none' && s.startMarker !== s.endMarker); })) warnings.push('Custom connector markers use the nearest Mermaid arrow or circle.');
  const ids = new Map(doc.nodes.map((node, index) => [node.id, `N${index + 1}`]));
  const lines = ['flowchart TD', ...doc.nodes.map(node => {
    const id = ids.get(node.id)!, label = node.label ? encodeMermaidLabel(node.label) : ' ';
    const shape = extendedShapes[node.type];
    if (shape) return `  ${id}@{ shape: ${shape}, label: "${label}" }`;
    const [open, close] = classicShapes[node.type] ?? classicShapes.process!;
    return `  ${id}${open}"${label}"${close}`;
  }), ...doc.edges.map(edge => `  ${ids.get(edge.source)} ${edgeSyntax(edge.style)}${edge.label ? `|${encodeMermaidLabel(edge.label)}|` : ''} ${ids.get(edge.target)}`)];
  for (const node of doc.nodes) {
    if (node.style.color === 'neutral') continue;
    const color = colorValues(node.style.color);
    lines.push(`  style ${ids.get(node.id)} fill:${color.fill},stroke:${color.stroke},color:${color.text}`);
  }
  doc.edges.forEach((edge, index) => {
    const style = resolveEdgeStyle(edge.style), parts: string[] = [];
    if (style.color !== 'neutral') parts.push(`stroke:${colorValues(style.color).stroke}`);
    if (style.width !== 1.5) parts.push(`stroke-width:${style.width}px`);
    if (style.lineStyle === 'dotted') parts.push(`stroke-dasharray:1 ${style.width * 3}`);
    if (parts.length) lines.push(`  linkStyle ${index} ${parts.join(',')}`);
  });
  return { code: lines.join('\n') + '\n', warnings };
}
