'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { House, CalendarDays, Dices, ArrowLeftRight, Users, Trophy, Settings, Bell, Plus, Check, Clock, Leaf, CookingPot, Bath, Sofa, Trash2, Pencil, X, ArrowRight, LogOut, Mail, ShieldCheck, Download, Pause, Play, ChevronRight, ChevronLeft, Sparkles, Info, Copy, Phone, TriangleAlert, LoaderCircle, Search, Bubbles, Broom, WashingMachine, UtensilsCrossed, Sprout, BedDouble, Wrench, Calculator, Menu } from 'lucide-react';

const icons = { home: House, calendar: CalendarDays, dice: Dices, swap: ArrowLeftRight, users: Users, trophy: Trophy, settings: Settings, bell: Bell, plus: Plus, check: Check, clock: Clock, leaf: Leaf, kitchen: CookingPot, bath: Bath, sofa: Sofa, trash: Trash2, edit: Pencil, close: X, arrow: ArrowRight, logout: LogOut, mail: Mail, shield: ShieldCheck, download: Download, pause: Pause, play: Play, chevron: ChevronRight, left: ChevronLeft, right: ChevronRight, sparkles: Sparkles, info: Info, copy: Copy, phone: Phone, alert: TriangleAlert, 'alert-triangle': TriangleAlert, loading: LoaderCircle, search: Search, cleaning: Bubbles, broom: Broom, laundry: WashingMachine, dishes: UtensilsCrossed, garden: Sprout, bed: BedDouble, tools: Wrench, calculator: Calculator, menu: Menu };
export function Icon({ name, size = 20, ...props }) {
  const Component = icons[name] || Sparkles;
  return <Component size={size} strokeWidth={1.7} aria-hidden="true" focusable="false" {...props} />;
}
export function Brand() {
  return <div className="brand"><span className="brand-mark"><Icon name="home" size={26} /></span><div><div className="brand-name">casa em dia<span>.</span></div><div className="brand-tag">DIVIDIR. CUIDAR. CONVIVER.</div></div></div>;
}
export function Avatar({ user, index = 0 }) {
  const [failedPhoto, setFailedPhoto] = useState(null);
  const name = String(user?.name || 'Morador').trim();
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toLocaleUpperCase('pt-BR');
  return <span className={'avatar alt' + ((Math.max(0, index)) % 4)} title={name} aria-label={name}>{user?.photo_url && failedPhoto !== user.photo_url ? <img src={user.photo_url} alt="" onError={() => setFailedPhoto(user.photo_url)} loading="lazy" /> : initials || 'M'}</span>;
}
export function Empty({ title, description, children }) {
  return <div className="empty"><Icon name="leaf" size={28} /><h3>{title}</h3>{description && <p>{description}</p>}{children && <p>{children}</p>}</div>;
}
export function Modal({ title, description, children, onClose }) {
  const dialogRef = useRef(null), closeRef = useRef(onClose);
  const headingId = useId(), descriptionId = useId();
  closeRef.current = onClose;
  useEffect(() => {
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusable = () => [...dialog.querySelectorAll('button:not([disabled]), a[href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')].filter(node => node.getClientRects().length && !node.closest('[hidden], [inert]'));
    const initial = dialog.querySelector('[autofocus]') || focusable()[0] || dialog;
    initial.focus();
    const handleKey = event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeRef.current?.(); }
      if (event.key !== 'Tab') return;
      const elements = focusable();
      if (!elements.length) { event.preventDefault(); dialog.focus(); return; }
      const first = elements[0], last = elements[elements.length - 1];
      if (event.shiftKey && (document.activeElement === first || !elements.includes(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !elements.includes(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    const containFocus = event => { if (!dialog.contains(event.target)) (focusable()[0] || dialog).focus(); };
    document.addEventListener('keydown', handleKey, true);
    document.addEventListener('focusin', containFocus);
    return () => {
      document.removeEventListener('keydown', handleKey, true);
      document.removeEventListener('focusin', containFocus);
      document.body.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, []);
  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose?.(); }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby={headingId} aria-describedby={description ? descriptionId : undefined} tabIndex={-1} ref={dialogRef}><header className="modal-header"><div><h2 id={headingId}>{title}</h2>{description && <p id={descriptionId}>{description}</p>}</div><button type="button" className="icon-btn" aria-label="Fechar janela" onClick={onClose}><Icon name="close" size={22} /></button></header>{children}</section></div>;
}
export function Field({ label, name, type = 'text', defaultValue, children, as, ...props }) {
  const generatedId = useId();
  const id = props.id || generatedId;
  const Control = as || (children ? 'select' : 'input');
  return <label className="field" htmlFor={id}>{label}<Control {...props} id={id} name={name} {...(Control === 'input' ? { type } : {})} defaultValue={defaultValue}>{Control === 'input' ? undefined : children}</Control></label>;
}
export function Submit({ children, busy = false, disabled, className = '', ...props }) {
  return <button type="submit" className={'btn ' + className} disabled={busy || disabled} aria-busy={busy || undefined} {...props}>{busy ? <><Icon name="clock" size={16} />Aguarde…</> : children}</button>;
}