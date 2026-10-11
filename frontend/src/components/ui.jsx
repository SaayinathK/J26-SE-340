import { Children, cloneElement, isValidElement, useEffect, useId, useRef } from 'react';
import { LayoutDashboard, Sparkles, Send, BookOpen, Plug, Users, Activity, Settings, ChevronDown, ChevronRight, ChevronLeft, ArrowUpRight, ArrowRight, ArrowUp, ArrowDown, Plus, Search, Bell, Sun, Moon, X, Menu, Check, Mail, MoreHorizontal, Download, CalendarDays, ShieldCheck, CircleHelp, LogOut, FileText, Upload, Trash2, Copy, LoaderCircle, ExternalLink, Globe, LockKeyhole, Pause, Play, Clock3, Zap, CheckCircle2, AlertCircle, SlidersHorizontal, RefreshCw, Eye, Terminal, Building2, Monitor, CheckCheck } from 'lucide-react';

const icons = { overview: LayoutDashboard, sparkles: Sparkles, send: Send, book: BookOpen, plug: Plug, users: Users, activity: Activity, settings: Settings, down: ChevronDown, right: ChevronRight, left: ChevronLeft, trend: ArrowUpRight, arrow: ArrowRight, up: ArrowUp, decrease: ArrowDown, plus: Plus, search: Search, bell: Bell, sun: Sun, moon: Moon, close: X, menu: Menu, check: Check, mail: Mail, more: MoreHorizontal, download: Download, calendar: CalendarDays, shield: ShieldCheck, help: CircleHelp, logout: LogOut, file: FileText, upload: Upload, trash: Trash2, copy: Copy, loader: LoaderCircle, external: ExternalLink, globe: Globe, lock: LockKeyhole, pause: Pause, play: Play, clock: Clock3, zap: Zap, success: CheckCircle2, alert: AlertCircle, filter: SlidersHorizontal, refresh: RefreshCw, eye: Eye, terminal: Terminal, building: Building2, monitor: Monitor, checks: CheckCheck };
export function Icon({ name, size = 18, ...props }) { const Component = icons[name] || Sparkles; return <Component size={size} strokeWidth={1.7} {...props} />; }
export function Logo({ compact = false }) { return <div className="brand"><svg viewBox="0 0 58 38" aria-hidden="true"><path d="M29 7a15 15 0 1 0 0 24" className="logo-white" fill="none" strokeWidth="4" strokeLinecap="round"/><path d="M26 20a12 12 0 1 1 24 0v14" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round"/></svg>{!compact && <span>ciftron<span className="brand-dot">.</span></span>}</div>; }
export function Button({ children, icon, variant = 'secondary', className = '', ...props }) { return <button className={`button ${variant} ${className}`} {...props}>{icon && <Icon name={icon} size={16} />}{children}</button>; }
export function Badge({ children, variant = 'neutral', dot = false }) { return <span className={`badge ${variant}`}>{dot && <i />}{children}</span>; }
export function PageHeading({ eyebrow, title, description, children }) { return <div className="page-heading"><div>{eyebrow && <div className="eyebrow">{eyebrow}</div>}<h1>{title}</h1><p>{description}</p></div>{children && <div className="heading-actions">{children}</div>}</div>; }
export function EmptyState({ icon = 'mail', title, description, children }) { return <div className="empty-state"><span className="empty-icon"><Icon name={icon} size={28} /></span><h3>{title}</h3><p>{description}</p>{children}</div>; }
export function Field({ label, hint, children }) {
  const generatedId = useId();
  const hintId = `${generatedId}-hint`;
  let controlId = null;
  function connect(child) {
    if (!isValidElement(child)) return child;
    if (!controlId && ['input', 'select', 'textarea'].includes(child.type)) {
      controlId = child.props.id || generatedId;
      return cloneElement(child, { id: controlId, ...(hint ? { 'aria-describedby': [child.props['aria-describedby'], hintId].filter(Boolean).join(' ') } : {}) });
    }
    if (child.props.children) return cloneElement(child, {}, Children.map(child.props.children, connect));
    return child;
  }
  const controls = Children.map(children, connect);
  return <div className="field">{controlId ? <label htmlFor={controlId}>{label}</label> : <span>{label}</span>}{controls}{hint && <small id={hintId}>{hint}</small>}</div>;
}
export function Modal({ title, description, children, onClose, wide = false }) {
  const ref = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    const dialog = ref.current;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialog.focus();
    const handler = event => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'Tab') {
        const focusable = [...dialog.querySelectorAll('button, [href], input, select, textarea, [tabindex="0"]')].filter(el => !el.disabled);
        const first = focusable[0]; const last = focusable.at(-1);
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog)) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', handler);
    return () => { document.body.style.overflow = originalOverflow; document.removeEventListener('keydown', handler); previous?.focus(); };
  }, [onClose]);
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><section ref={ref} className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby="modal-title" tabIndex={-1}><div className="modal-heading"><div><h2 id="modal-title">{title}</h2>{description && <p>{description}</p>}</div><button className="icon-button" onClick={onClose} aria-label="Close dialog"><Icon name="close" /></button></div>{children}</section></div>;
}
