'use client';

import { useId, useState } from 'react';
import { Check } from 'lucide-react';
import { COLORS, COLOR_LABELS } from '@/lib/diagram';
import { colorValues } from '@/lib/geometry';
import { CONNECTOR_CATEGORIES, CONNECTOR_PRESETS, EDGE_MARKERS, EDGE_MARKER_LABELS, edgeDashArray, edgeMarkerId, edgeMarkersMarkup, resolveEdgeStyle, type ConnectorCategory, type EdgeMarker, type EdgeStyle } from '@/lib/connectors';
import './connector-style-picker.css';

export function ConnectorPreview({ style }: { style: EdgeStyle }) {
  const prefix = `preview-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}-`;
  const resolved = resolveEdgeStyle(style);
  return <svg width="96" height="24" viewBox="0 0 96 24" aria-hidden="true">
    <defs dangerouslySetInnerHTML={{ __html: edgeMarkersMarkup(style, prefix) }} />
    <path d="M 14 12 L 82 12" fill="none" stroke={colorValues(style.color).stroke} strokeWidth={resolved.width} strokeDasharray={edgeDashArray(style)} strokeLinecap="round"
      markerStart={resolved.startMarker === 'none' ? undefined : `url(#${edgeMarkerId(resolved.startMarker, resolved.color, resolved.width, prefix)})`}
      markerEnd={resolved.endMarker === 'none' ? undefined : `url(#${edgeMarkerId(resolved.endMarker, resolved.color, resolved.width, prefix)})`} />
  </svg>;
}

export default function ConnectorStylePicker({ value, onChange, disabled = false }: { value: EdgeStyle; onChange: (style: EdgeStyle) => void; disabled?: boolean }) {
  const resolved = resolveEdgeStyle(value);
  const matching = CONNECTOR_PRESETS.find(preset => Object.entries(preset.style).every(([key, setting]) => resolved[key as keyof typeof preset.style] === setting));
  const [category, setCategory] = useState<ConnectorCategory>(matching?.category ?? 'Flow');
  const id = useId();
  const change = (patch: Partial<EdgeStyle>) => onChange({ ...value, ...patch });
  return <fieldset className="connector-style-picker" disabled={disabled}>
    <legend>Connector style</legend>
    <div className="connector-categories" role="tablist" aria-label="Connector categories">
      {CONNECTOR_CATEGORIES.map((name, index) => <button key={name} id={`${id}-tab-${index}`} type="button" role="tab" aria-selected={category === name} aria-controls={`${id}-panel`} tabIndex={category === name ? 0 : -1}
        onClick={() => setCategory(name)} onKeyDown={event => {
          const next = event.key === 'ArrowRight' ? (index + 1) % 3 : event.key === 'ArrowLeft' ? (index + 2) % 3 : event.key === 'Home' ? 0 : event.key === 'End' ? 2 : null;
          if (next === null) return;
          event.preventDefault(); setCategory(CONNECTOR_CATEGORIES[next]); document.getElementById(`${id}-tab-${next}`)?.focus();
        }}>{name}</button>)}
    </div>
    <div className="connector-presets" role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-tab-${CONNECTOR_CATEGORIES.indexOf(category)}`}>
      {CONNECTOR_PRESETS.filter(preset => preset.category === category).map(preset => <button key={preset.id} className="connector-preset" type="button" aria-label={`${preset.label} connector`} aria-pressed={Object.entries(preset.style).every(([key, setting]) => resolved[key as keyof typeof preset.style] === setting)} onClick={() => change(preset.style)}>
        <ConnectorPreview style={{ color: value.color, ...preset.style }} /><span>{preset.label}</span>
      </button>)}
    </div>
    <details className="connector-custom"><summary>Customize</summary><div className="connector-controls">
      <label>Line pattern<select aria-label="Connection line pattern" value={resolved.lineStyle} onChange={event => change({ lineStyle: event.target.value as EdgeStyle['lineStyle'] })}><option value="solid">Solid</option><option value="dashed">Dashed</option><option value="dotted">Dotted</option></select></label>
      <label>Line width<select aria-label="Connection line width" value={resolved.width} onChange={event => change({ width: Number(event.target.value) })}>{[...new Set([1, 1.5, 2, 3, 4, 6, 8, resolved.width])].sort((a,b) => a-b).map(width => <option key={width} value={width}>{width} px</option>)}</select></label>
      {(['startMarker', 'endMarker'] as const).map((side) => <label key={side}>{side === 'startMarker' ? 'Start marker' : 'End marker'}<select aria-label={side === 'startMarker' ? 'Connection start marker' : 'Connection end marker'} value={resolved[side]} onChange={event => change({ [side]: event.target.value as EdgeMarker })}>{EDGE_MARKERS.map(marker => <option key={marker} value={marker}>{EDGE_MARKER_LABELS[marker]}</option>)}</select></label>)}
    </div>
    <fieldset className="color-options" disabled={disabled}><legend>Color</legend>{COLORS.map(color => <button key={color} type="button" className="color-choice" aria-label={`Connection color ${COLOR_LABELS[color]}`} aria-pressed={value.color === color} style={{ background: colorValues(color).fill, borderColor: colorValues(color).stroke }} onClick={() => change({ color })}>{value.color === color && <Check size={14} />}</button>)}</fieldset></details>
  </fieldset>;
}
