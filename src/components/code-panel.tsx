'use client';

import { useRef, useState } from 'react';
import { Code2, Copy, Download, X } from 'lucide-react';
import type { Diagram } from '@/lib/diagram';
import { serializeMermaid } from '@/lib/mermaid';
import './code-panel.css';

export interface CodePanelProps { diagram: Diagram; onClose: () => void }
export default function CodePanel({ diagram, onClose }: CodePanelProps) {
  const { code, warnings } = serializeMermaid(diagram);
  const [status, setStatus] = useState('');
  const text = useRef<HTMLTextAreaElement>(null);
  const gutter = useRef<HTMLDivElement>(null);
  async function copy() {
    try { await navigator.clipboard.writeText(code); setStatus('Code copied.'); }
    catch { text.current?.focus(); text.current?.select(); setStatus('Select and copy the code.'); }
  }
  function download() {
    const url = URL.createObjectURL(new Blob([code], { type: 'text/plain;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${diagram.title.replace(/[<>:"/\\|?*\x00-\x1F]/g, '-').slice(0, 100) || 'diagram'}.mmd`; anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <section className="code-panel" aria-label="Code panel">
    <div className="code-panel-heading"><h2><Code2 size={17} aria-hidden="true" />Code</h2><button type="button" className="icon-button" aria-label="Close code panel" onClick={onClose}><X size={17} /></button></div>
    <div className="code-panel-tools"><button type="button" className="button" onClick={() => void copy()}><Copy size={14} aria-hidden="true" />Copy code</button><button type="button" className="button" onClick={download}><Download size={14} aria-hidden="true" />Download .mmd</button></div>
    <label className="code-panel-label" htmlFor="mermaid-code">Mermaid flowchart</label>
    <div className="code-panel-editor"><div className="code-panel-lines" ref={gutter} aria-hidden="true">{code.split('\n').map((_, index) => <div key={index}>{index + 1}</div>)}</div><textarea id="mermaid-code" ref={text} value={code} spellCheck={false} wrap="off" readOnly aria-label="Mermaid code" onScroll={event => { if (gutter.current) gutter.current.scrollTop = event.currentTarget.scrollTop; }} /></div>
    {warnings.length > 0 && <details className="code-panel-limits"><summary>Export details</summary>{warnings.map(warning => <p key={warning}>{warning}</p>)}</details>}
    <div className="code-panel-footer"><span role="status">{status}</span></div>
  </section>;
}
