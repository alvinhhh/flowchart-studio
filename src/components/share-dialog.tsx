'use client';

import { useRef, useState } from 'react';
import type { Diagram } from '@/lib/diagram';
import { createShare } from '@/lib/sharing';
import Modal from './modal';

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

  return <Modal title="Share diagram" onClose={onClose}>
    <div className="share-content">
      {!result ? <>
        <p>Create an encrypted snapshot of this diagram, including labels, notes, and drawings. The uploaded snapshot expires after 24 hours.</p>
        <p>Anyone with the link can view it or save a copy. Later edits won’t change the snapshot.</p>
        {error && <p role="alert" className="share-error">{error}</p>}
        <div className="share-actions"><button className="button" onClick={onClose}>{busy ? 'Close' : 'Cancel'}</button><button className="button button-dark" disabled={busy} onClick={() => void share()}>{busy ? 'Creating link…' : 'Create link'}</button></div>
      </> : <>
        <label className="share-link-label">Share link<input ref={link} aria-label="Share link" readOnly value={result.url} onFocus={event => event.currentTarget.select()} /></label>
        <p>Expires <time dateTime={result.expiresAt}>{new Date(result.expiresAt).toLocaleString()}</time>.</p>
        <p>Anyone with this link can view the snapshot or save a copy before it expires.</p>
        <div className="share-actions"><a className="button" href={result.url} target="_blank" rel="noopener noreferrer">Open link</a><button className="button button-dark" onClick={() => void copy()}>Copy link</button></div>
        <p role="status" className="share-copy-status">{copyStatus}</p>
      </>}
    </div>
  </Modal>;
}
