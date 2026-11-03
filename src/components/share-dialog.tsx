'use client';

import { useRef, useState } from 'react';
import { AlertCircle, Check, Clock3, Copy, ExternalLink, FileText, Link2, LoaderCircle, LockKeyhole, Share2 } from 'lucide-react';
import type { Diagram } from '@/lib/diagram';
import { createShare } from '@/lib/sharing';
import Modal from './modal';
import './share-dialog.css';

export default function ShareDialog({ diagram, onClose }: { diagram: Diagram; onClose: () => void }) {
  const [snapshot] = useState(() => structuredClone(diagram));
  const [result, setResult] = useState<{ url: string; expiresAt: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copyStatus, setCopyStatus] = useState('');
  const link = useRef<HTMLInputElement>(null);

  async function share() {
    if (busy) return;
    setBusy(true); setError('');
    try { setResult(await createShare(snapshot)); }
    catch (error) { setError(error instanceof Error ? error.message : 'Could not create a link. Try again.'); }
    finally { setBusy(false); }
  }

  async function copy() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.url);
      setCopyStatus('Link copied.');
    } catch {
      link.current?.focus(); link.current?.select();
      setCopyStatus('Select and copy the link.');
    }
  }

  const copied = copyStatus === 'Link copied.';
  const counts = `${snapshot.nodes.length} ${snapshot.nodes.length === 1 ? 'shape' : 'shapes'} · ${snapshot.edges.length} ${snapshot.edges.length === 1 ? 'connection' : 'connections'}${snapshot.drawings.length ? ` · ${snapshot.drawings.length} ${snapshot.drawings.length === 1 ? 'drawing' : 'drawings'}` : ''}`;

  return <Modal title="Share diagram" icon={<Share2 size={21} />} description="Read-only snapshot" className="share-dialog" restoreFocusTo=".mobile-actions-toggle" onClose={onClose}>
    <div className="share-content">
      <div className="share-document">
        <span className="share-document-icon"><FileText size={21} aria-hidden="true" /></span>
        <div className="share-document-info"><strong title={snapshot.title || 'Untitled diagram'}>{snapshot.title || 'Untitled diagram'}</strong><span>{counts}</span></div>
        <span className="share-expiry-chip"><Clock3 size={13} aria-hidden="true" />24 hours</span>
      </div>
      {!result ? <>
        <ul className="share-facts" aria-label="Sharing details">
          <li><span className="share-fact-icon"><LockKeyhole size={17} aria-hidden="true" /></span><div><strong>Encrypted before upload</strong><p>Includes the diagram’s labels, notes, and drawings.</p></div></li>
          <li><span className="share-fact-icon"><Link2 size={17} aria-hidden="true" /></span><div><strong>Anyone with the link can open it</strong><p>Recipients can save a copy. Later edits won’t update the snapshot.</p></div></li>
        </ul>
        {error && <div role="alert" className="share-error"><AlertCircle size={17} aria-hidden="true" /><p>{error}</p></div>}
        <div className="share-actions"><button className="button" type="button" onClick={onClose}>{busy ? 'Close' : 'Cancel'}</button><button className="button button-dark" type="button" disabled={busy} aria-busy={busy} onClick={() => void share()}>{busy ? <LoaderCircle size={16} className="share-spinner" aria-hidden="true" /> : <Link2 size={16} aria-hidden="true" />}{busy ? 'Creating link…' : 'Create link'}</button></div>
      </> : <>
        <div className="share-link-card">
          <div className="share-link-heading"><label htmlFor="share-link">Share link</label></div>
          <div className="share-link-field"><input id="share-link" ref={link} aria-label="Share link" spellCheck={false} readOnly value={result.url} onFocus={event => event.currentTarget.select()} /><button type="button" className={`share-copy-button${copied ? ' is-copied' : ''}`} aria-label="Copy link" onClick={() => void copy()}>{copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}<span>Copy link</span></button></div>
          <p role="status" className="share-copy-status">{copyStatus}</p>
        </div>
        <div className="share-expiry"><Clock3 size={15} aria-hidden="true" /><p>Expires <time dateTime={result.expiresAt}>{new Date(result.expiresAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</time></p></div>
        <p className="share-access-note"><Link2 size={15} aria-hidden="true" /><span>Anyone with the complete link can view this snapshot or save a copy.</span></p>
        <div className="share-actions"><button className="button" type="button" onClick={onClose}>Done</button><a className="button" href={result.url} target="_blank" rel="noopener noreferrer">Open link<ExternalLink size={15} aria-hidden="true" /></a></div>
      </>}
    </div>
  </Modal>;
}
