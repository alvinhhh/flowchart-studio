'use client';
import { LockKeyhole } from 'lucide-react';
import { memo, useCallback, useLayoutEffect, useId } from 'react';
import { BaseEdge, EdgeLabelRenderer, Handle, NodeResizeControl, Position, useUpdateNodeInternals, type EdgeProps, type Node, type NodeProps, type ResizeParams } from '@xyflow/react';
import { edgeDashArray, edgeMarkerId, edgeMarkersMarkup, resolveEdgeStyle } from '@/lib/connectors';
import type { DiagramEdge, DiagramNode, HandleId } from '@/lib/diagram';
import { colorValues, edgeRoute, nodePath, nodeTextBox, handlePoint, wrapLabel, labelWidth } from '@/lib/geometry';

export type FlowNode = Node<{ model: DiagramNode; resizeEnabled?: boolean; onResizeStart?: (id: string) => void }, 'shape'>;
const corners = ['top-left', 'top-right', 'bottom-left', 'bottom-right'] as const;
const positions: Record<HandleId, Position> = { top: Position.Top, right: Position.Right, bottom: Position.Bottom, left: Position.Left };
export const ShapeNode = memo(function ShapeNode({ data, selected }: NodeProps<FlowNode>) {
  const n = data.model;
  const updateInternals = useUpdateNodeInternals();
  useLayoutEffect(() => { updateInternals(n.id); }, [n.id, n.width, n.height, updateInternals]);
  const colors = colorValues(n.style.color);
  const box = nodeTextBox(n.type, n.width, n.height);
  const lines = wrapLabel(n.label, box.width);
  const { onResizeStart } = data;
  const beginResize = useCallback(() => onResizeStart?.(n.id), [onResizeStart, n.id]);
  const canResize = useCallback((_: unknown, size: ResizeParams) => {
    const text = nodeTextBox(n.type, size.width, size.height);
    return size.x >= -100000 && size.x <= 100000 && size.y >= -100000 && size.y <= 100000
      && (!n.label || wrapLabel(n.label, text.width).length * 20 <= text.height);
  }, [n.type, n.label]);
  return <div className={`shape-node${selected ? ' is-selected' : ''}`} style={{ width: n.width, height: n.height }}>
    {selected && data.resizeEnabled && corners.map(position => <NodeResizeControl key={position} position={position} className="shape-resize-handle" minWidth={40} minHeight={40} maxWidth={2000} maxHeight={2000} shouldResize={canResize} onResizeStart={beginResize} color="#fff"><span className="resize-hit-area" title={`Resize ${position.replace('-', ' ')}`} /></NodeResizeControl>)}
    {n.locked && <span className="node-lock" aria-label="Locked"><LockKeyhole size={11} /></span>}
    <svg width={n.width} height={n.height} viewBox={`0 0 ${n.width} ${n.height}`} aria-hidden="true" overflow="visible">
      <path d={nodePath(n.type, n.width, n.height)} fill={colors.fill} stroke={colors.stroke} strokeWidth={1.5} />
      <text x={box.x} fill={colors.text} textAnchor="middle" fontSize={14} fontWeight={500}>
        {lines.map((line, i) => <tspan key={i} x={box.x} y={box.y - (lines.length - 1) * 10 + 5 + i * 20}>{line || '\u00a0'}</tspan>)}
      </text>
    </svg>
    {(Object.entries(positions) as [HandleId, Position][]).map(([id, position]) => {
      const anchor = handlePoint({ ...n, position: { x: 0, y: 0 } }, id);
      const offset = id === 'top' ? { top: anchor.y } : id === 'bottom' ? { bottom: n.height - anchor.y } : id === 'left' ? { left: anchor.x } : { right: n.width - anchor.x };
      return <Handle key={id} id={id} type="source" position={position} style={offset} aria-hidden="true" />;
    })}
  </div>;
});
export function RoutedEdge(props: EdgeProps) {
  const data = props.data as { model: DiagramEdge } | undefined;
  const model = data?.model;
  const markerPrefix = `edge-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}-`;
  const edgeStyle = resolveEdgeStyle(model?.style);
  const route = edgeRoute({ x: props.sourceX, y: props.sourceY }, { x: props.targetX, y: props.targetY }, model?.sourceHandle ?? 'bottom', model?.targetHandle ?? 'top');
  const colors = colorValues(model?.style.color ?? 'neutral');
  const label = model?.label ?? '';
  const lines = wrapLabel(label, 220);
  const width = Math.max(20, ...lines.map(line => labelWidth(line))) + 20;
  return <>
    <defs dangerouslySetInnerHTML={{ __html: edgeMarkersMarkup(model?.style, markerPrefix) }} />
    <BaseEdge id={props.id} path={route.path}
      markerStart={edgeStyle.startMarker === 'none' ? undefined : `url(#${edgeMarkerId(edgeStyle.startMarker, edgeStyle.color, edgeStyle.width, markerPrefix)})`}
      markerEnd={edgeStyle.endMarker === 'none' ? undefined : `url(#${edgeMarkerId(edgeStyle.endMarker, edgeStyle.color, edgeStyle.width, markerPrefix)})`}
      interactionWidth={24} style={{ stroke: colors.stroke, strokeWidth: edgeStyle.width, strokeDasharray: edgeDashArray(model?.style), strokeLinecap: 'round', strokeLinejoin: 'round' }} />
    {label && <EdgeLabelRenderer><div className="edge-label nodrag nopan" style={{ transform: `translate(-50%, -50%) translate(${route.labelX}px, ${route.labelY}px)`, width }} aria-hidden="true">{lines.map((line, i) => <div key={i}>{line || '\u00a0'}</div>)}</div></EdgeLabelRenderer>}
  </>;
}
