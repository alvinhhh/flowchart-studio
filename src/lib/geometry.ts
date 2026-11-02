import type { ColorName, DiagramNode, HandleId } from './diagram';
import type { NodeKind } from './shapes';

export type Point = { x: number; y: number };

const colors: Record<ColorName, { fill: string; stroke: string; text: string }> = {
  neutral: { fill: '#ffffff', stroke: '#64748b', text: '#172033' },
  blue: { fill: '#eff6ff', stroke: '#3b82f6', text: '#1e3a5f' },
  amber: { fill: '#fffbeb', stroke: '#d49a20', text: '#704b0c' },
  rose: { fill: '#fff1f2', stroke: '#e06780', text: '#843347' },
  violet: { fill: '#f5f3ff', stroke: '#8b70d5', text: '#503887' },
};

export function colorValues(color: ColorName) {
  return colors[color] ?? colors.neutral;
}

type Pair = [number, number];
type Part = Pair | [number, number, number, number, number, number];
interface Trace { start: Pair; parts: Part[]; closed: boolean }
interface ShapeGeometry { outline: Trace; details?: Trace[] }
const trace = (start: Pair, parts: Part[], closed = false): Trace => ({ start, parts, closed });
const polygon = (...points: Pair[]): Trace => trace(points[0], points.slice(1), true);
const rectangle = (): Trace => polygon([0, 0], [1, 0], [1, 1], [0, 1]);
const K = 0.5522847498307936;
const size = (value: number) => Number.isFinite(value) && value > 0 ? value : 1;

function rounded(rx: number, ry: number): Trace {
  return trace([rx, 0], [
    [1 - rx, 0], [1 - rx + rx * K, 0, 1, ry - ry * K, 1, ry],
    [1, 1 - ry], [1, 1 - ry + ry * K, 1 - rx + rx * K, 1, 1 - rx, 1],
    [rx, 1], [rx - rx * K, 1, 0, 1 - ry + ry * K, 0, 1 - ry],
    [0, ry], [0, ry - ry * K, rx - rx * K, 0, rx, 0],
  ], true);
}

function shapeGeometry(type: NodeKind, w: number, h: number): ShapeGeometry {
  const r = Math.min(12, w / 2, h / 2);
  const ellipse = rounded(0.5, 0.5);
  const regular = rounded(r / w, r / h);
  switch (type) {
    case 'terminal': { const radius = Math.min(w, h) / 2; return { outline: rounded(radius / w, radius / h) }; }
    case 'process': return { outline: regular };
    case 'alternate_process': { const radius = Math.min(w, h) / 4; return { outline: rounded(radius / w, radius / h) }; }
    case 'decision': return { outline: polygon([0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]) };
    case 'io': { const inset = Math.min(26 / w, 0.15); return { outline: polygon([inset, 0], [1, 0], [1 - inset, 1], [0, 1]) }; }
    case 'function': {
      const inset = Math.min(14 / w, 0.2);
      return { outline: regular, details: [trace([inset, 0], [[inset, 1]]), trace([1 - inset, 0], [[1 - inset, 1]])] };
    }
    case 'note': {
      const fold = Math.min(18, w / 4, h / 4);
      const fx = fold / w, fy = fold / h;
      return { outline: polygon([0, 0], [1 - fx, 0], [1, fy], [1, 1], [0, 1]), details: [trace([1 - fx, 0], [[1 - fx, fy], [1, fy]])] };
    }
    case 'internal_storage': return { outline: rectangle(), details: [trace([0.14, 0], [[0.14, 1]]), trace([0, 0.2], [[1, 0.2]])] };
    case 'document': return { outline: trace([0, 0], [[1, 0], [1, 0.84], [0.75, 0.66, 0.75, 1, 0.5, 0.88], [0.25, 0.76, 0.25, 1, 0, 0.88]], true) };
    case 'multi_document': return {
      outline: trace([0, 0.18], [[0.18, 0.18], [0.18, 0], [1, 0], [1, 0.82], [0.91, 0.82], [0.91, 0.9], [0.82, 0.9], [0.61, 0.76, 0.61, 1, 0.41, 0.91], [0.2, 0.82, 0.2, 1, 0, 0.91]], true),
      details: [trace([0.09, 0.18], [[0.09, 0.09], [0.91, 0.09], [0.91, 0.82]]), trace([0, 0.18], [[0.82, 0.18], [0.82, 0.9]])],
    };
    case 'preparation': return { outline: polygon([0.15, 0], [0.85, 0], [1, 0.5], [0.85, 1], [0.15, 1], [0, 0.5]) };
    case 'manual_input': return { outline: polygon([0, 0.22], [1, 0], [1, 1], [0, 1]) };
    case 'manual_operation': return { outline: polygon([0, 0], [1, 0], [0.8, 1], [0.2, 1]) };
    case 'connector': return { outline: ellipse };
    case 'off_page': return { outline: polygon([0, 0], [1, 0], [1, 0.65], [0.5, 1], [0, 0.65]) };
    case 'card': return { outline: polygon([0.2, 0], [1, 0], [1, 1], [0, 1], [0, 0.25]) };
    case 'paper_tape': return { outline: trace([0, 0.12], [[0.25, 0, 0.25, 0, 0.5, 0.12], [0.75, 0.24, 0.75, 0.24, 1, 0.12], [1, 0.88], [0.75, 1, 0.75, 1, 0.5, 0.88], [0.25, 0.76, 0.25, 0.76, 0, 0.88]], true) };
    case 'summing_junction': return { outline: ellipse, details: [trace([0.2, 0.2], [[0.8, 0.8]]), trace([0.8, 0.2], [[0.2, 0.8]])] };
    case 'or': return { outline: ellipse, details: [trace([0.18, 0.5], [[0.82, 0.5]]), trace([0.5, 0.18], [[0.5, 0.82]])] };
    case 'collate': return { outline: polygon([0, 0], [1, 0], [0.5, 0.5], [1, 1], [0, 1], [0.5, 0.5]) };
    case 'sort': return { outline: polygon([0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]), details: [trace([0, 0.5], [[1, 0.5]])] };
    case 'extract': return { outline: polygon([0.5, 0], [1, 1], [0, 1]) };
    case 'merge': return { outline: polygon([0, 0], [1, 0], [0.5, 1]) };
    case 'stored_data': return { outline: trace([0.18, 0], [[1, 0], [0.78, 0.18, 0.78, 0.82, 1, 1], [0.18, 1], [0, 0.82, 0, 0.18, 0.18, 0]], true) };
    case 'delay': return { outline: trace([0, 0], [[0.6, 0], [0.6 + 0.4 * K, 0, 1, 0.5 - 0.5 * K, 1, 0.5], [1, 0.5 + 0.5 * K, 0.6 + 0.4 * K, 1, 0.6, 1], [0, 1]], true) };
    case 'sequential_data': return {
      outline: trace([0.42, 0], [[0.42 + 0.42 * K, 0, 0.84, 0.5 - 0.5 * K, 0.84, 0.5], [0.84, 0.68, 0.74, 0.83, 0.6, 0.9], [1, 0.9], [1, 1], [0.42, 1], [0.42 - 0.42 * K, 1, 0, 0.5 + 0.5 * K, 0, 0.5], [0, 0.5 - 0.5 * K, 0.42 - 0.42 * K, 0, 0.42, 0]], true),
    };
    case 'database': return {
      outline: trace([0, 0.15], [[0, 0.15 - 0.15 * K, 0.5 - 0.5 * K, 0, 0.5, 0], [0.5 + 0.5 * K, 0, 1, 0.15 - 0.15 * K, 1, 0.15], [1, 0.85], [1, 0.85 + 0.15 * K, 0.5 + 0.5 * K, 1, 0.5, 1], [0.5 - 0.5 * K, 1, 0, 0.85 + 0.15 * K, 0, 0.85]], true),
      details: [trace([0, 0.15], [[0, 0.15 + 0.15 * K, 0.5 - 0.5 * K, 0.3, 0.5, 0.3], [0.5 + 0.5 * K, 0.3, 1, 0.15 + 0.15 * K, 1, 0.15]])],
    };
    case 'direct_data': return {
      outline: trace([0.12, 0], [[0.88, 0], [0.88 + 0.12 * K, 0, 1, 0.5 - 0.5 * K, 1, 0.5], [1, 0.5 + 0.5 * K, 0.88 + 0.12 * K, 1, 0.88, 1], [0.12, 1], [0.12 - 0.12 * K, 1, 0, 0.5 + 0.5 * K, 0, 0.5], [0, 0.5 - 0.5 * K, 0.12 - 0.12 * K, 0, 0.12, 0]], true),
      details: [trace([0.12, 0], [[0.12 + 0.12 * K, 0, 0.24, 0.5 - 0.5 * K, 0.24, 0.5], [0.24, 0.5 + 0.5 * K, 0.12 + 0.12 * K, 1, 0.12, 1]])],
    };
    case 'display': return { outline: trace([0, 0.5], [[0.18, 0], [0.82, 0], [1, 0.15, 1, 0.85, 0.82, 1], [0.18, 1]], true) };
    case 'annotation': return { outline: polygon([0, 0], [0.16, 0], [0.16, 0.08], [1, 0.08], [1, 0.92], [0.16, 0.92], [0.16, 1], [0, 1]) };
    case 'loop_limit': return { outline: polygon([0, 0.25], [0.2, 0], [0.8, 0], [1, 0.25], [1, 1], [0, 1]) };
    case 'parallel': return { outline: rectangle(), details: [trace([0, 0.28], [[1, 0.28]]), trace([0, 0.72], [[1, 0.72]])] };
  }
}

function tracePath(value: Trace, w: number, h: number): string {
  const commands = value.parts.map(part => `${part.length === 2 ? 'L' : 'C'} ${part.map((value, index) => value * (index % 2 === 0 ? w : h)).join(' ')}`);
  return `M ${value.start[0] * w} ${value.start[1] * h} ${commands.join(' ')}${value.closed ? ' Z' : ''}`;
}

export function nodePath(type: NodeKind, width: number, height: number): string {
  const w = size(width), h = size(height);
  const geometry = shapeGeometry(type, w, h);
  return [geometry.outline, ...(geometry.details ?? [])].map(value => tracePath(value, w, h)).join(' ');
}

export function nodeTextBox(type: NodeKind, width: number, height: number): { x: number; y: number; width: number; height: number } {
  const w = size(width), h = size(height);
  let region = [0.5, 0.5, 0.8, 0.68];
  switch (type) {
    case 'terminal': case 'alternate_process': region = [0.5, 0.5, 0.72, 0.6]; break;
    case 'decision': region = [0.5, 0.5, 0.5, 0.42]; break;
    case 'io': region = [0.5, 0.5, 0.6, 0.65]; break;
    case 'function': region = [0.5, 0.5, 0.68, 0.65]; break;
    case 'note': region = [0.46, 0.52, 0.78, 0.7]; break;
    case 'internal_storage': region = [0.57, 0.6, 0.7, 0.58]; break;
    case 'document': region = [0.5, 0.38, 0.78, 0.5]; break;
    case 'multi_document': region = [0.41, 0.46, 0.62, 0.42]; break;
    case 'preparation': region = [0.5, 0.5, 0.65, 0.65]; break;
    case 'manual_input': region = [0.5, 0.6, 0.75, 0.5]; break;
    case 'manual_operation': region = [0.5, 0.4, 0.6, 0.6]; break;
    case 'connector': region = [0.5, 0.5, 0.64, 0.64]; break;
    case 'off_page': region = [0.5, 0.35, 0.76, 0.5]; break;
    case 'card': region = [0.55, 0.55, 0.75, 0.65]; break;
    case 'paper_tape': region = [0.5, 0.5, 0.75, 0.45]; break;
    case 'summing_junction': region = [0.5, 0.22, 0.24, 0.16]; break;
    case 'or': region = [0.3, 0.3, 0.18, 0.18]; break;
    case 'collate': region = [0.5, 0.18, 0.38, 0.16]; break;
    case 'sort': region = [0.5, 0.3, 0.32, 0.16]; break;
    case 'extract': region = [0.5, 0.73, 0.5, 0.22]; break;
    case 'merge': region = [0.5, 0.27, 0.5, 0.22]; break;
    case 'stored_data': region = [0.52, 0.5, 0.56, 0.64]; break;
    case 'delay': region = [0.4, 0.5, 0.62, 0.62]; break;
    case 'sequential_data': region = [0.42, 0.5, 0.5, 0.56]; break;
    case 'database': region = [0.5, 0.57, 0.78, 0.42]; break;
    case 'direct_data': region = [0.56, 0.5, 0.62, 0.62]; break;
    case 'display': region = [0.52, 0.5, 0.6, 0.62]; break;
    case 'annotation': region = [0.57, 0.5, 0.7, 0.65]; break;
    case 'loop_limit': region = [0.5, 0.57, 0.75, 0.6]; break;
    case 'parallel': region = [0.5, 0.5, 0.78, 0.34]; break;
  }
  return { x: region[0] * w, y: region[1] * h, width: region[2] * w, height: region[3] * h };
}

function cubic(start: Pair, part: Part, t: number): Pair {
  if (part.length === 2) return [start[0] + (part[0] - start[0]) * t, start[1] + (part[1] - start[1]) * t];
  const s = 1 - t;
  return [0, 1].map(axis => s * s * s * start[axis] + 3 * s * s * t * part[axis] + 3 * s * t * t * part[axis + 2] + t * t * t * part[axis + 4]) as Pair;
}

function contourPoint(outline: Trace, handle: HandleId): Pair {
  const fixedAxis = handle === 'top' || handle === 'bottom' ? 0 : 1;
  const otherAxis = 1 - fixedAxis;
  const intersections: Pair[] = [];
  let from = outline.start;
  const parts: Part[] = [...outline.parts, ...(outline.closed ? [outline.start] : [])];
  for (const part of parts) {
    if (part.length === 2) {
      const difference = part[fixedAxis] - from[fixedAxis];
      if (Math.abs(difference) < 1e-12) {
        if (Math.abs(from[fixedAxis] - 0.5) < 1e-12) intersections.push(from, part);
      } else {
        const t = (0.5 - from[fixedAxis]) / difference;
        if (t >= 0 && t <= 1) intersections.push(cubic(from, part, t));
      }
    } else {
      let previous = cubic(from, part, 0);
      for (let step = 1; step <= 16; step++) {
        const t = step / 16;
        const current = cubic(from, part, t);
        if (Math.abs(previous[fixedAxis] - 0.5) < 1e-12) intersections.push(previous);
        if (Math.abs(current[fixedAxis] - 0.5) < 1e-12) intersections.push(current);
        if ((previous[fixedAxis] - 0.5) * (current[fixedAxis] - 0.5) < 0) {
          let low = (step - 1) / 16, high = t;
          const sign = previous[fixedAxis] - 0.5;
          for (let iteration = 0; iteration < 36; iteration++) {
            const middle = (low + high) / 2;
            if ((cubic(from, part, middle)[fixedAxis] - 0.5) * sign > 0) low = middle;
            else high = middle;
          }
          intersections.push(cubic(from, part, (low + high) / 2));
        }
        previous = current;
      }
    }
    from = part.length === 2 ? part : [part[4], part[5]];
  }
  const descending = handle === 'right' || handle === 'bottom';
  intersections.sort((a, b) => descending ? b[otherAxis] - a[otherAxis] : a[otherAxis] - b[otherAxis]);
  return intersections[0] ?? (handle === 'top' ? [0.5, 0] : handle === 'right' ? [1, 0.5] : handle === 'bottom' ? [0.5, 1] : [0, 0.5]);
}

export function handlePoint(node: Pick<DiagramNode, 'position' | 'width' | 'height'> & { type?: NodeKind }, handle: HandleId): Point {
  const w = size(node.width), h = size(node.height);
  const point = contourPoint(shapeGeometry(node.type ?? 'process', w, h).outline, handle);
  return { x: node.position.x + point[0] * w, y: node.position.y + point[1] * h };
}

const directions: Record<HandleId, Point> = {
  top: { x: 0, y: -1 }, right: { x: 1, y: 0 },
  bottom: { x: 0, y: 1 }, left: { x: -1, y: 0 },
};

function cleanPoints(points: Point[]): Point[] {
  return points.filter((point, index) => index === 0 || point.x !== points[index - 1].x || point.y !== points[index - 1].y);
}

/** Orthogonal routes preserve the direction of both endpoint handles. */
export function edgeRoute(source: Point, target: Point, sourceHandle: HandleId, targetHandle: HandleId): {
  path: string; labelX: number; labelY: number; points: Point[];
} {
  const sd = directions[sourceHandle] ?? directions.right;
  const td = directions[targetHandle] ?? directions.left;
  const gap = 28;
  const a = { x: source.x + sd.x * gap, y: source.y + sd.y * gap };
  const b = { x: target.x + td.x * gap, y: target.y + td.y * gap };
  let middle: Point[];
  if (sd.x && td.x) {
    if (sd.x === -td.x && (b.x - a.x) * sd.x >= 0) {
      const x = (a.x + b.x) / 2;
      middle = [{ x, y: a.y }, { x, y: b.y }];
    } else if (sd.x === td.x) {
      const x = sd.x > 0 ? Math.max(a.x, b.x) + gap : Math.min(a.x, b.x) - gap;
      middle = [{ x, y: a.y }, { x, y: b.y }];
    } else {
      const y = Math.min(a.y, b.y) - gap * 2;
      middle = [{ x: a.x, y }, { x: b.x, y }];
    }
  } else if (sd.y && td.y) {
    if (sd.y === -td.y && (b.y - a.y) * sd.y >= 0) {
      const y = (a.y + b.y) / 2;
      middle = [{ x: a.x, y }, { x: b.x, y }];
    } else if (sd.y === td.y) {
      const y = sd.y > 0 ? Math.max(a.y, b.y) + gap : Math.min(a.y, b.y) - gap;
      middle = [{ x: a.x, y }, { x: b.x, y }];
    } else {
      const x = Math.max(a.x, b.x) + gap * 2;
      middle = [{ x, y: a.y }, { x, y: b.y }];
    }
  } else if (sd.x) {
    const corner = { x: b.x, y: a.y };
    if ((corner.x - a.x) * sd.x >= 0 && (corner.y - b.y) * td.y >= 0) {
      middle = [corner];
    } else {
      const x = sd.x > 0 ? Math.max(a.x, b.x) + gap : Math.min(a.x, b.x) - gap;
      const y = td.y > 0 ? Math.max(a.y, b.y) + gap : Math.min(a.y, b.y) - gap;
      middle = [{ x, y: a.y }, { x, y }, { x: b.x, y }];
    }
  } else {
    const corner = { x: a.x, y: b.y };
    if ((corner.y - a.y) * sd.y >= 0 && (corner.x - b.x) * td.x >= 0) {
      middle = [corner];
    } else {
      const y = sd.y > 0 ? Math.max(a.y, b.y) + gap : Math.min(a.y, b.y) - gap;
      const x = td.x > 0 ? Math.max(a.x, b.x) + gap : Math.min(a.x, b.x) - gap;
      middle = [{ x: a.x, y }, { x, y }, { x, y: b.y }];
    }
  }
  const points = cleanPoints([source, a, ...middle, b, target]);
  let remaining = points.slice(1).reduce((sum, point, i) => sum + Math.abs(point.x - points[i].x) + Math.abs(point.y - points[i].y), 0) / 2;
  let label = source;
  for (let i = 1; i < points.length; i++) {
    const from = points[i - 1];
    const to = points[i];
    const length = Math.abs(to.x - from.x) + Math.abs(to.y - from.y);
    if (remaining <= length) {
      const t = length ? remaining / length : 0;
      label = { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
      break;
    }
    remaining -= length;
  }
  return { path: points.map((point, i) => `${i ? 'L' : 'M'} ${point.x} ${point.y}`).join(' '), labelX: label.x, labelY: label.y, points };
}

/** Conservative text metrics keep wrapping deterministic across browser engines. */
export function labelWidth(text: string, fontSize = 14): number {
  return Array.from(text).reduce((width, character) => {
    if (/\s/u.test(character)) return width + fontSize * 0.32;
    if (/[ilI.,'`:;!|]/u.test(character)) return width + fontSize * 0.3;
    if (/[MW@#%&]/u.test(character)) return width + fontSize * 0.9;
    if (/[A-Z]/u.test(character)) return width + fontSize * 0.69;
    if (/[a-z0-9]/u.test(character)) return width + fontSize * 0.58;
    if (/\p{Mark}/u.test(character) || character === '\u200d' || character === '\ufe0f') return width;
    return width + fontSize;
  }, 0);
}

export function wrapLabel(label: string, maxWidth: number, fontSize = 14): string[] {
  const limit = Math.max(fontSize, maxWidth);
  const lines: string[] = [];
  for (const paragraph of label.replace(/\r\n?/g, '\n').split('\n')) {
    let line = '';
    const words = paragraph.trim().split(/\s+/u).filter(Boolean);
    for (const word of words) {
      if (line && labelWidth(`${line} ${word}`, fontSize) <= limit) {
        line += ` ${word}`;
        continue;
      }
      if (line) lines.push(line);
      line = '';
      const characters = typeof Intl.Segmenter === 'function'
        ? Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(word), item => item.segment)
        : Array.from(word);
      for (const character of characters) {
        if (line && labelWidth(line + character, fontSize) > limit) {
          lines.push(line);
          line = '';
        }
        line += character;
      }
    }
    lines.push(line);
  }
  return lines.length ? lines : [''];
}
