'use client';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import './modal.css';

type Props = { title: string; description?: string; icon?: ReactNode; className?: string; restoreFocusTo?: string; onClose: () => void; children: ReactNode };

export default function Modal({ title, description, icon, className = '', restoreFocusTo, onClose, children }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId(), descriptionId = useId();
  useEffect(() => {
    const dialog = ref.current!;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.showModal();
    return () => {
      dialog.close();
      queueMicrotask(() => {
        if (document.querySelector('dialog[open]')) return;
        const target = opener?.isConnected && opener !== document.body ? opener
          : restoreFocusTo ? document.querySelector<HTMLElement>(restoreFocusTo) : null;
        if (target?.getClientRects().length) target.focus();
      });
    };
  }, [restoreFocusTo]);
  return <dialog ref={ref} className={`dialog ${className}`} aria-labelledby={titleId} aria-describedby={description ? descriptionId : undefined} onCancel={onClose} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="dialog-heading">
      {icon && <span className="dialog-icon" aria-hidden="true">{icon}</span>}
      <div className="dialog-heading-copy"><h2 id={titleId}>{title}</h2>{description && <p id={descriptionId}>{description}</p>}</div>
      <button type="button" className="icon-button dialog-close" aria-label="Close dialog" onClick={onClose}><X size={18} /></button>
    </div>
    <div className="dialog-body">{children}</div>
  </dialog>;
}
