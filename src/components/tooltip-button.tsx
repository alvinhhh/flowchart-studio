'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes } from 'react';
import { createPortal } from 'react-dom';

type Props = ButtonHTMLAttributes<HTMLButtonElement> & { tooltip: string; disabledReason?: string; wrapperClassName?: string };

export default function TooltipButton({ tooltip, disabledReason, disabled, children, wrapperClassName = '', ...props }: Props) {
  const id = useId();
  const anchor = useRef<HTMLSpanElement>(null);
  const bubble = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [host, setHost] = useState<Element | null>(null);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const description = disabled && disabledReason ? `${tooltip} · ${disabledReason}` : tooltip;
  const show = (target: HTMLElement) => { setHost(target.closest('dialog') ?? document.body); setOpen(true); };

  useLayoutEffect(() => {
    if (!open || !anchor.current || !bubble.current) return;
    const source = anchor.current.getBoundingClientRect();
    const target = bubble.current.getBoundingClientRect();
    setPosition({
      left: Math.max(8, Math.min(source.left + source.width / 2 - target.width / 2, window.innerWidth - target.width - 8)),
      top: source.bottom + target.height + 16 < window.innerHeight ? source.bottom + 8 : Math.max(8, source.top - target.height - 8),
    });
  }, [open, description]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => { window.removeEventListener('resize', close); window.removeEventListener('scroll', close, true); };
  }, [open]);

  return <span ref={anchor} className={`tooltip-trigger ${wrapperClassName}`} role={disabled ? 'group' : undefined} tabIndex={disabled ? 0 : undefined} aria-label={disabled ? props['aria-label'] ?? tooltip : undefined} aria-disabled={disabled || undefined} aria-describedby={disabled && open ? id : undefined}
    onMouseEnter={event => show(event.currentTarget)} onMouseLeave={event => { if (!event.currentTarget.contains(document.activeElement)) setOpen(false); }}
    onFocus={event => show(event.currentTarget)} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}
    onKeyDown={event => { if (event.key === 'Escape') setOpen(false); }} onClick={() => setOpen(false)}>
    <button {...props} disabled={disabled} aria-describedby={open ? id : props['aria-describedby']}>{children}</button>
    {open && host && createPortal(<span ref={bubble} id={id} role="tooltip" className="editor-tooltip" style={position}>{description}</span>, host)}
  </span>;
}
