import type { ColorName, DiagramNode, HandleId, NodeKind } from './diagram';

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

export function nodePath(type: NodeKind, width: number, height: number): string {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  const r = type === 'terminal' ? Math.min(w, h) / 2 : Math.min(12, w / 2, h / 2);
  const rectangle = `M ${r} 0 H ${w - r} Q ${w} 0 ${w} ${r} V ${h - r} Q ${w} ${h} ${w - r} ${h} H ${r} Q 0 ${h} 0 ${h - r} V ${r} Q 0 0 ${r} 0 Z`;
  if (type === 'decision') return `M ${w / 2} 0 L ${w} ${h / 2} L ${w / 2} ${h} L 0 ${h / 2} Z`;
  if (type === 'io') {
    const inset = Math.min(26, w * 0.15);
    return `M ${inset} 0 H ${w} L ${w - inset} ${h} H 0 Z`;
  }
  if (type === 'function') {
    const inset = Math.min(14, w / 5);
    return `${rectangle} M ${inset} 0 V ${h} M ${w - inset} 0 V ${h}`;
  }
  if (type === 'note') {
    const fold = Math.min(18, w / 4, h / 4);
    return `M 0 0 H ${w - fold} L ${w} ${fold} V ${h} H 0 Z M ${w - fold} 0 V ${fold} H ${w}`;
  }
  return rectangle;
}

export function handlePoint(node: Pick<DiagramNode, 'position' | 'width' | 'height'>, handle: HandleId): Point {
  const { x, y } = node.position;
  if (handle === 'top') return { x: x + node.width / 2, y };
  if (handle === 'right') return { x: x + node.width, y: y + node.height / 2 };
  if (handle === 'bottom') return { x: x + node.width / 2, y: y + node.height };
  return { x, y: y + node.height / 2 };
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
