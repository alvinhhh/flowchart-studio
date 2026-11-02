'use client';

import { useViewport } from '@xyflow/react';
import type { AlignmentGuide } from '@/lib/alignment';
import type { DiagramNode } from '@/lib/diagram';
import { colorValues, nodePath } from '@/lib/geometry';

export default function AlignmentOverlay({ guides, preview }: { guides: AlignmentGuide[]; preview: DiagramNode | null }) {
  const viewport = useViewport();
  const screenX = (x: number) => viewport.x + x * viewport.zoom;
  const screenY = (y: number) => viewport.y + y * viewport.zoom;
  const colors = preview ? colorValues(preview.style.color) : null;
  return <div className="alignment-overlay" aria-hidden="true">
    <svg className="alignment-lines" width="100%" height="100%">
      {guides.map(guide => guide.axis === 'x'
        ? <line className="alignment-guide" key="x" x1={screenX(guide.position)} x2={screenX(guide.position)} y1={screenY(guide.start) - 12} y2={screenY(guide.end) + 12} />
        : <line className="alignment-guide" key="y" y1={screenY(guide.position)} y2={screenY(guide.position)} x1={screenX(guide.start) - 12} x2={screenX(guide.end) + 12} />)}
    </svg>
    {preview && colors && <div className="palette-shape-preview" style={{ width: preview.width, height: preview.height, transform: `translate(${screenX(preview.position.x)}px, ${screenY(preview.position.y)}px) scale(${viewport.zoom})` }}>
      <svg width={preview.width} height={preview.height} viewBox={`0 0 ${preview.width} ${preview.height}`} overflow="visible"><path d={nodePath(preview.type, preview.width, preview.height)} fill={colors.fill} stroke={colors.stroke} strokeWidth={1.5} /></svg>
    </div>}
  </div>;
}
