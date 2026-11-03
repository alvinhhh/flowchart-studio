import type { ColorName } from './diagram';
import { colorValues } from './geometry';

export const EDGE_LINE_STYLES = ['solid', 'dashed', 'dotted'] as const;
export const EDGE_MARKERS = ['none', 'arrow', 'open-arrow', 'triangle', 'circle', 'circle-filled', 'diamond', 'diamond-filled', 'bar', 'crowfoot'] as const;
export type EdgeLineStyle = (typeof EDGE_LINE_STYLES)[number];
export type EdgeMarker = (typeof EDGE_MARKERS)[number];
export interface EdgeStyle {
  color: ColorName;
  lineStyle?: EdgeLineStyle;
  width?: number;
  startMarker?: EdgeMarker;
  endMarker?: EdgeMarker;
}
export const EDGE_MARKER_LABELS: Record<EdgeMarker, string> = {
  none: 'None', arrow: 'Filled arrow', 'open-arrow': 'Open arrow', triangle: 'Open triangle',
  circle: 'Hollow circle', 'circle-filled': 'Filled circle', diamond: 'Hollow diamond',
  'diamond-filled': 'Filled diamond', bar: 'Bar', crowfoot: 'Crow’s foot',
};
export function resolveEdgeStyle(style?: EdgeStyle): Required<EdgeStyle> {
  return { color: style?.color ?? 'neutral', lineStyle: style?.lineStyle ?? 'solid', width: style?.width ?? 1.5,
    startMarker: style?.startMarker ?? 'none', endMarker: style?.endMarker ?? 'arrow' };
}
export function edgeDashArray(style?: EdgeStyle): string | undefined {
  const { lineStyle, width } = resolveEdgeStyle(style);
  return lineStyle === 'dashed' ? `${width * 5} ${width * 3}` : lineStyle === 'dotted' ? `0 ${width * 3}` : undefined;
}

export type ConnectorCategory = 'Flow' | 'UML' | 'Relationships';
export const CONNECTOR_CATEGORIES: ConnectorCategory[] = ['Flow', 'UML', 'Relationships'];
export const CONNECTOR_PRESETS: { id: string; label: string; category: ConnectorCategory; style: Omit<Required<EdgeStyle>, 'color'> }[] = [
  { id: 'arrow', label: 'Arrow', category: 'Flow', style: { lineStyle: 'solid', width: 1.5, startMarker: 'none', endMarker: 'arrow' } },
  { id: 'line', label: 'Line', category: 'Flow', style: { lineStyle: 'solid', width: 1.5, startMarker: 'none', endMarker: 'none' } },
  { id: 'dashed-arrow', label: 'Dashed arrow', category: 'Flow', style: { lineStyle: 'dashed', width: 1.5, startMarker: 'none', endMarker: 'arrow' } },
  { id: 'dotted-arrow', label: 'Dotted arrow', category: 'Flow', style: { lineStyle: 'dotted', width: 1.5, startMarker: 'none', endMarker: 'arrow' } },
  { id: 'two-way', label: 'Two-way arrow', category: 'Flow', style: { lineStyle: 'solid', width: 1.5, startMarker: 'arrow', endMarker: 'arrow' } },
  { id: 'association', label: 'Association', category: 'UML', style: { lineStyle: 'solid', width: 1.5, startMarker: 'none', endMarker: 'none' } },
  { id: 'directed', label: 'Directed association', category: 'UML', style: { lineStyle: 'solid', width: 1.5, startMarker: 'none', endMarker: 'open-arrow' } },
  { id: 'dependency', label: 'Dependency', category: 'UML', style: { lineStyle: 'dashed', width: 1.5, startMarker: 'none', endMarker: 'open-arrow' } },
  { id: 'inheritance', label: 'Inheritance', category: 'UML', style: { lineStyle: 'solid', width: 1.5, startMarker: 'none', endMarker: 'triangle' } },
  { id: 'realization', label: 'Realization', category: 'UML', style: { lineStyle: 'dashed', width: 1.5, startMarker: 'none', endMarker: 'triangle' } },
  { id: 'aggregation', label: 'Aggregation', category: 'UML', style: { lineStyle: 'solid', width: 1.5, startMarker: 'diamond', endMarker: 'none' } },
  { id: 'composition', label: 'Composition', category: 'UML', style: { lineStyle: 'solid', width: 1.5, startMarker: 'diamond-filled', endMarker: 'none' } },
  { id: 'one-many', label: 'One to many', category: 'Relationships', style: { lineStyle: 'solid', width: 1.5, startMarker: 'bar', endMarker: 'crowfoot' } },
  { id: 'many-many', label: 'Many to many', category: 'Relationships', style: { lineStyle: 'solid', width: 1.5, startMarker: 'crowfoot', endMarker: 'crowfoot' } },
];

/** The same marker geometry is used by the canvas, previews, and every export format. */
export function markerPath(marker: Exclude<EdgeMarker, 'none'>): string {
  switch (marker) {
    case 'arrow': case 'triangle': return 'M 1 1 L 11 6 L 1 11 Z';
    case 'open-arrow': return 'M 1 1 L 11 6 L 1 11';
    case 'circle': case 'circle-filled': return 'M 11 6 A 5 5 0 1 0 1 6 A 5 5 0 1 0 11 6 Z';
    case 'diamond': case 'diamond-filled': return 'M 1 6 L 6 1 L 11 6 L 6 11 Z';
    case 'bar': return 'M 11 1 L 11 11';
    case 'crowfoot': return 'M 11 1 L 1 6 L 11 11 M 1 6 L 11 6';
  }
}
export function edgeMarkerId(marker: EdgeMarker, color: ColorName, width: number, prefix = ''): string {
  return `${prefix}${marker === 'arrow' && width === 1.5 ? `arrow-${color}` : `connector-${marker}-${color}-${String(width).replace('.', '-')}`}`;
}
export function markerMarkup(marker: EdgeMarker, color: ColorName, width: number, prefix = ''): string {
  if (marker === 'none') return '';
  const stroke = colorValues(color).stroke;
  const filled = marker === 'arrow' || marker.endsWith('-filled');
  const closed = filled || marker === 'triangle' || marker === 'circle' || marker === 'diamond';
  const size = 12 + Math.max(0, width - 1.5);
  return `<marker id="${edgeMarkerId(marker, color, width, prefix)}" markerWidth="${size}" markerHeight="${size}" refX="11" refY="6" orient="auto-start-reverse" markerUnits="userSpaceOnUse" viewBox="0 0 12 12" overflow="visible"><path d="${markerPath(marker)}" fill="${filled ? stroke : closed ? '#ffffff' : 'none'}" stroke="${stroke}" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></marker>`;
}
export function edgeMarkersMarkup(style?: EdgeStyle, prefix = ''): string {
  const resolved = resolveEdgeStyle(style);
  return [...new Set([resolved.startMarker, resolved.endMarker])].map(marker => markerMarkup(marker, resolved.color, resolved.width, prefix)).join('');
}
