'use client';
import { memo } from 'react';
import { BaseEdge, EdgeLabelRenderer, Handle, Position, type EdgeProps, type Node, type NodeProps } from '@xyflow/react';
import type { DiagramEdge, DiagramNode, HandleId } from '@/lib/diagram';
import { colorValues, edgeRoute, nodePath, wrapLabel, labelWidth } from '@/lib/geometry';

export type FlowNode = Node<{ model: DiagramNode }, 'shape'>;
const positions: Record<HandleId, Position> = { top: Position.Top, right: Position.Right, bottom: Position.Bottom, left: Position.Left };
export const ShapeNode = memo(function ShapeNode({ data, selected }: NodeProps<FlowNode>) {
  const n = data.model;
  const colors = colorValues(n.style.color);
  const lines = wrapLabel(n.label, n.type === 'decision' ? n.width * .55 : n.width - 32);
  return <div className={`shape-node${selected ? ' is-selected' : ''}`} style={{ width: n.width, height: n.height }}>
    <svg width={n.width} height={n.height} viewBox={`0 0 ${n.width} ${n.height}`} aria-hidden="true" overflow="visible">
      <path d={nodePath(n.type, n.width, n.height)} fill={colors.fill} stroke={colors.stroke} strokeWidth={1.5} />
      <text x={n.width / 2} fill={colors.text} textAnchor="middle" fontSize={14} fontWeight={500}>
        {lines.map((line, i) => <tspan key={i} x={n.width / 2} y={n.height / 2 - (lines.length - 1) * 10 + 5 + i * 20}>{line || '\u00a0'}</tspan>)}
      </text>
    </svg>
    {(Object.entries(positions) as [HandleId, Position][]).map(([id, position]) => <Handle key={id} id={id} type="source" position={position} aria-hidden="true" />)}
  </div>;
});
export function RoutedEdge(props: EdgeProps) {
  const data = props.data as { model: DiagramEdge } | undefined;
  const model = data?.model;
  const route = edgeRoute({ x: props.sourceX, y: props.sourceY }, { x: props.targetX, y: props.targetY }, model?.sourceHandle ?? 'bottom', model?.targetHandle ?? 'top');
  const colors = colorValues(model?.style.color ?? 'neutral');
  const label = model?.label ?? '';
  const lines = wrapLabel(label, 220);
  const width = Math.max(20, ...lines.map(line => labelWidth(line))) + 20;
  return <>
    <BaseEdge id={props.id} path={route.path} markerEnd={props.markerEnd} interactionWidth={24} style={{ stroke: props.selected ? '#171717' : colors.stroke, strokeWidth: props.selected ? 2.5 : 1.5 }} />
    {label && <EdgeLabelRenderer><div className="edge-label nodrag nopan" style={{ transform: `translate(-50%, -50%) translate(${route.labelX}px, ${route.labelY}px)`, width }} aria-hidden="true">{lines.map((line, i) => <div key={i}>{line || '\u00a0'}</div>)}</div></EdgeLabelRenderer>}
  </>;
}
