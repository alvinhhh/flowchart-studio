import type { Diagram, DiagramNode } from './diagram';
import { edgeDashArray, edgeMarkerId, markerMarkup, resolveEdgeStyle } from './connectors';
import { drawingBounds, drawingPath } from './drawing';
import { routeDiagramEdge } from './routing';
import { colorValues, labelWidth, nodePath, nodeTextBox, wrapLabel } from './geometry';

const FONT_SIZE = 14;
const LINE_HEIGHT = 20;
const PADDING = 48;

export type ExportBounds = { x: number; y: number; width: number; height: number };

function xml(value: string): string {
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function nodeLines(node: DiagramNode): string[] {
  return wrapLabel(node.label, nodeTextBox(node.type, node.width, node.height).width, FONT_SIZE);
}

function scene(diagram: Diagram) {
  const nodes = diagram.nodes;
  for (const node of nodes) {
    if (![node.position.x, node.position.y, node.width, node.height].every(Number.isFinite) || node.width <= 0 || node.height <= 0) {
      throw new Error('A shape has invalid dimensions. Save JSON, then correct the shape before exporting.');
    }
  }
  const byId = new Map(nodes.map(node => [node.id, node]));
  const edges = diagram.edges.flatMap(edge => {
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    if (!source || !target) return [];
    const route = routeDiagramEdge(edge, source, target, nodes);
    return [{ edge, route, lines: edge.label ? wrapLabel(edge.label, 220, FONT_SIZE) : [] }];
  });
  const drawings = (diagram.drawings ?? []).filter(stroke => stroke.points.length > 0);
  for (const stroke of drawings) {
    if (!Number.isFinite(stroke.width) || stroke.width <= 0 || stroke.points.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y))) {
      throw new Error('A drawing has invalid coordinates. Correct the drawing before exporting.');
    }
  }
  return { nodes, edges, drawings };
}

function boundsForScene(content: ReturnType<typeof scene>): ExportBounds {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  function include(x: number, y: number, width = 0, height = 0) {
    left = Math.min(left, x);
    top = Math.min(top, y);
    right = Math.max(right, x + width);
    bottom = Math.max(bottom, y + height);
  }
  for (const stroke of content.drawings) {
    const bounds = drawingBounds(stroke);
    include(bounds.x, bounds.y, bounds.width, bounds.height);
  }
  for (const node of content.nodes) {
    include(node.position.x - 2, node.position.y - 2, node.width + 4, node.height + 4);
    const lines = nodeLines(node);
    const textBox = nodeTextBox(node.type, node.width, node.height);
    const textWidth = Math.max(...lines.map(line => labelWidth(line, FONT_SIZE)), 0);
    include(node.position.x + textBox.x - textWidth / 2 - 4,
      node.position.y + textBox.y - lines.length * LINE_HEIGHT / 2,
      textWidth + 8, lines.length * LINE_HEIGHT);
  }
  for (const { route, lines } of content.edges) {
    for (const point of route.points) include(point.x - 10, point.y - 10, 20, 20);
    if (lines.length) {
      const textWidth = Math.max(...lines.map(line => labelWidth(line, FONT_SIZE)), 0);
      include(route.labelX - textWidth / 2 - 10, route.labelY - lines.length * LINE_HEIGHT / 2 - 5,
        textWidth + 20, lines.length * LINE_HEIGHT + 10);
    }
  }
  if (!Number.isFinite(left)) return { x: 0, y: 0, width: 960, height: 640 };
  return { x: left - PADDING, y: top - PADDING, width: right - left + PADDING * 2, height: bottom - top + PADDING * 2 };
}

/** Includes every shape, drawing, route, arrowhead, and label, regardless of viewport. */
export function exportBounds(diagram: Diagram): ExportBounds {
  return boundsForScene(scene(diagram));
}

function textMarkup(lines: string[], x: number, y: number, color: string): string {
  const firstY = y - (lines.length - 1) * LINE_HEIGHT / 2 + 5;
  return `<text text-anchor="middle" fill="${color}" font-size="${FONT_SIZE}" font-weight="500">${lines.map((line, index) => `<tspan x="${x}" y="${firstY + index * LINE_HEIGHT}">${xml(line)}</tspan>`).join('')}</text>`;
}

function renderSvg(diagram: Diagram): string {
  const content = scene(diagram);
  const bounds = boundsForScene(content);
  const definitions = new Map<string, string>();
  for (const { edge } of content.edges) {
    const style = resolveEdgeStyle(edge.style);
    for (const marker of [style.startMarker, style.endMarker]) if (marker !== 'none') {
      definitions.set(edgeMarkerId(marker, style.color, style.width), markerMarkup(marker, style.color, style.width));
    }
  }
  const markers = [...definitions.values()].join('');
  const drawings = content.drawings.map(stroke => `<path data-drawing-id="${xml(stroke.id)}" d="${drawingPath(stroke)}" fill="${stroke.color === 'neutral' ? '#242424' : colorValues(stroke.color).stroke}"/>`).join('');
  const background = diagram.settings.background ?? (diagram.settings.gridVisible ? 'dots' : 'blank');
  const backgroundPatterns = background === 'dots'
    ? '<pattern id="background-dots" width="16" height="16" patternUnits="userSpaceOnUse"><circle cx="8" cy="8" r="1" fill="#c4c6ce"/></pattern>'
    : background === 'graph' ? '<pattern id="background-minor" width="16" height="16" patternUnits="userSpaceOnUse"><path d="M 16 0 H 0 V 16" fill="none" stroke="#e2e4eb" stroke-width="0.6"/></pattern><pattern id="background-graph" width="80" height="80" patternUnits="userSpaceOnUse"><rect width="80" height="80" fill="url(#background-minor)"/><path d="M 80 0 H 0 V 80" fill="none" stroke="#c3c7d3" stroke-width="1"/></pattern>' : '';
  const backgroundRect = background === 'blank' ? '' : `<rect x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}" fill="url(#background-${background})"/>`;
  const edges = content.edges.map(({ edge, route }) => {
    const color = colorValues(edge.style.color);
    const style = resolveEdgeStyle(edge.style);
    const dash = edgeDashArray(edge.style);
    const marker = (end: 'start' | 'end') => {
      const value = end === 'start' ? style.startMarker : style.endMarker;
      return value === 'none' ? '' : ` marker-${end}="url(#${edgeMarkerId(value, style.color, style.width)})"`;
    };
    return `<path data-edge-id="${xml(edge.id)}" d="${route.path}" fill="none" stroke="${color.stroke}" stroke-width="${style.width}" stroke-linejoin="round" stroke-linecap="round"${dash === undefined ? '' : ` stroke-dasharray="${dash}"`}${marker('start')}${marker('end')}/>`;
  }).join('');
  const nodes = content.nodes.map(node => {
    const color = colorValues(node.style.color);
    const textBox = nodeTextBox(node.type, node.width, node.height);
    return `<g transform="translate(${node.position.x} ${node.position.y})"><path d="${nodePath(node.type, node.width, node.height)}" fill="${color.fill}" stroke="${color.stroke}" stroke-width="1.75" stroke-linejoin="round"/>${textMarkup(nodeLines(node), textBox.x, textBox.y, color.text)}</g>`;
  }).join('');
  const labels = content.edges.map(({ route, lines }) => {
    if (!lines.length) return '';
    const width = Math.max(...lines.map(line => labelWidth(line, FONT_SIZE)), 0) + 20;
    const height = lines.length * LINE_HEIGHT + 10;
    return `<g><rect x="${route.labelX - width / 2}" y="${route.labelY - height / 2}" width="${width}" height="${height}" rx="6" fill="#ffffff"/>${textMarkup(lines, route.labelX, route.labelY, '#334155')}</g>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${bounds.width}" height="${bounds.height}" viewBox="${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}" font-family="system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"><defs>${markers}${backgroundPatterns}</defs><rect x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}" fill="#ffffff"/>${backgroundRect}${drawings}${edges}${nodes}${labels}</svg>`;
}

/** Self-contained vector SVG for downloads and raster rendering; contains no HTML. */
export function diagramToSvg(diagram: Diagram): string {
  return renderSvg(diagram);
}

function filename(title: string, extension: string): string {
  const base = title.trim().replace(/[\u0000-\u001f<>:"/\\|?*]/g, '-').replace(/[. ]+$/g, '').slice(0, 120) || 'diagram';
  return `${base}.${extension}`;
}

function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.style.display = 'none';
  document.body.append(link);
  try {
    link.click();
  } finally {
    link.remove();
    // Safari may begin reading the download after the click handler returns.
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}

export function downloadJson(diagram: Diagram): void {
  download(new Blob([JSON.stringify(diagram, null, 2) + '\n'], { type: 'application/json' }), filename(diagram.title, 'json'));
}

export function downloadSvg(diagram: Diagram): void {
  download(new Blob([diagramToSvg(diagram)], { type: 'image/svg+xml;charset=utf-8' }), filename(diagram.title, 'svg'));
}

export async function downloadPng(diagram: Diagram): Promise<{ width: number; height: number; limited: boolean }> {
  const { pngLayout, encodePng } = await import('./png');
  const svg = diagramToSvg(diagram);
  if (svg.length > 16_000_000) throw new Error('This diagram is too large to render as PNG. Export SVG or PDF instead.');
  const root = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement;
  const [x, y, width, height] = root.getAttribute('viewBox')!.split(' ').map(Number);
  const layout = pngLayout(width, height);
  await document.fonts.ready;
  const bands = rasterBands(root, { x, y, width, height }, layout);
  const blob = await encodePng(layout.width, layout.height, bands, layout.scale * 96 / 0.0254);
  download(blob, filename(diagram.title, 'png'));
  return layout;
}

/** Vector geometry and embedded text on a page sized to the complete diagram. */
export async function downloadPdf(diagram: Diagram): Promise<void> {
  const { svgToPdf } = await import('./pdf');
  const bytes = await svgToPdf(diagramToSvg(diagram));
  download(new Blob([bytes], { type: 'application/pdf' }), filename(diagram.title, 'pdf'));
}

/** Rasterize overlapping tiles so even large exports use a small browser canvas. */
async function* rasterBands(root: Element, bounds: ExportBounds, layout: { width: number; height: number; scale: number }): AsyncGenerator<Uint8Array> {
  const TILE_WIDTH = 2048, BAND_HEIGHT = 128, BLEED = 2;
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('The browser could not create a PNG canvas. Try exporting SVG or PDF.');
  try {
    for (let top = 0; top < layout.height; top += BAND_HEIGHT) {
      const rows = Math.min(BAND_HEIGHT, layout.height - top);
      const band = new Uint8Array(layout.width * rows * 3);
      for (let left = 0; left < layout.width; left += TILE_WIDTH) {
        const columns = Math.min(TILE_WIDTH, layout.width - left);
        canvas.width = columns + BLEED * 2;
        canvas.height = rows + BLEED * 2;
        root.setAttribute('width', String(canvas.width));
        root.setAttribute('height', String(canvas.height));
        root.setAttribute('viewBox', [bounds.x + (left - BLEED) / layout.scale,
          bounds.y + (top - BLEED) / layout.scale, canvas.width / layout.scale,
          canvas.height / layout.scale].join(' '));
        const url = URL.createObjectURL(new Blob([root.outerHTML], { type: 'image/svg+xml;charset=utf-8' }));
        const image = new Image();
        try {
          await new Promise<void>((resolve, reject) => {
            const timeout = window.setTimeout(() => { image.onload = null; image.onerror = null; reject(new Error('PNG rendering timed out. Try exporting SVG or PDF.')); }, 20_000);
            image.onload = () => { window.clearTimeout(timeout); resolve(); };
            image.onerror = () => { window.clearTimeout(timeout); reject(new Error('The browser could not render this PNG. Try exporting SVG or PDF.')); };
            image.src = url;
          });
          context.fillStyle = '#ffffff';
          context.fillRect(0, 0, canvas.width, canvas.height);
          context.drawImage(image, 0, 0);
          const rgba = context.getImageData(BLEED, BLEED, columns, rows).data;
          for (let row = 0; row < rows; row++) {
            let output = (row * layout.width + left) * 3;
            for (let input = row * columns * 4, end = input + columns * 4; input < end; input += 4) {
              band[output++] = rgba[input]; band[output++] = rgba[input + 1]; band[output++] = rgba[input + 2];
            }
          }
        } finally {
          image.onload = null; image.onerror = null;
          image.removeAttribute('src');
          URL.revokeObjectURL(url);
        }
      }
      yield band;
    }
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}
