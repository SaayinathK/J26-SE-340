// frontend/src/components/ui.jsx — shared pieces: cards, KPI tiles, avatars, badges, toasts, loading, count-up animation
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { SEGMENT, avatarColour, initials, leadName } from '../features/lead-intel/lang.js';

export const pct = (x, d = 0) => (x == null || Number.isNaN(x) ? '–' : `${(x * 100).toFixed(d)}%`);
export const num = (x) => (x == null ? '–' : Number(x).toLocaleString());
export const SEG_COLOURS = { hot: '#10B5A4', warm: '#E2B545', cold: '#7D8E9E' };

// ---------- light / dark theme ----------
export const ThemeCtx = createContext('light');
export const useTheme = () => useContext(ThemeCtx);
// colours for the charts (recharts cannot read CSS variables)
export function useChart() {
  const dark = useTheme() === 'dark';
  return {
    accent: dark ? '#19C9B6' : '#10B5A4',
    grid: dark ? '#1c2221' : '#EDF1F0',
    axis: { stroke: dark ? '#2a3130' : '#E1E6E5', tick: { fill: dark ? '#8f9a98' : '#7A8583', fontSize: 11.5 }, tickLine: false },
    muted: dark ? '#33403f' : '#CBD5D3',
    cursor: dark ? '#141918' : '#F1F5F4',
  };
}

// numbers count up from 0 when they first appear
export function useCountUp(target, ms = 900) {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (target == null || Number.isNaN(target)) return undefined;
    let raf;
    const t0 = performance.now();
    const tick = (t) => {
      const k = Math.min(1, (t - t0) / ms);
      setV(target * (1 - Math.pow(1 - k, 3)));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

export function Card({ title, right, children, note, className = '', delay = 0 }) {
  return (
    <section className={`card rise ${className}`} style={{ animationDelay: `${delay}ms` }}>
      {(title || right) && (
        <div className="card-head">
          {title && <h3 className="card-title">{title}</h3>}
          {right}
        </div>
      )}
      {children}
      {note && <div className="card-note">{note}</div>}
    </section>
  );
}

export function Kpi({ icon: Icon, label, value, format = num, sub, delay = 0 }) {
  const v = useCountUp(value);
  return (
    <section className="card kpi rise lift" style={{ animationDelay: `${delay}ms` }}>
      <div className="kpi-top">
        <span className="kpi-label">{label}</span>
        <span className="kpi-icon"><Icon size={15} /></span>
      </div>
      <div className="kpi-value">{value == null ? '–' : format(v)}</div>
      {sub && <div className="kpi-sub">{sub}</div>}
    </section>
  );
}

export function Seg({ value, plain = false }) {
  const s = SEGMENT[value] || { label: value, plain: value, tip: '' };
  return <span className={`seg ${value}`} title={s.tip}>{s.label}{plain && <em> · {s.plain}</em>}</span>;
}

export function Avatar({ id, size = 36 }) {
  const name = leadName(id);
  return (
    <span className="avatar-lead" style={{ width: size, height: size, background: avatarColour(id), fontSize: size * 0.38 }}
          aria-hidden="true">{initials(name)}</span>
  );
}

export function LeadName({ id, small = false }) {
  return (
    <span className="lead-name">
      <Avatar id={id} size={small ? 30 : 36} />
      <span>
        <b>{leadName(id)}</b>
        <span className="lead-id">{id}</span>
      </span>
    </span>
  );
}

export function ScoreBar({ score }) {
  return (
    <div className="score-bar" title={`${score} out of 100`}>
      <b>{score}</b>
      <div className="track"><div className="fill grow" style={{ width: `${score}%` }} /></div>
    </div>
  );
}

export function Skeleton({ h = 120 }) {
  return <div className="skeleton" style={{ height: h }} />;
}

export function ErrorBox({ error, onRetry }) {
  return (
    <div className="error-box row">
      <span>{error?.message || String(error)}</span>
      <span className="spacer" />
      {onRetry && <button className="btn small ghost" onClick={onRetry}>Try again</button>}
    </div>
  );
}

export function PageHeader({ eyebrow, title, accent, subtitle, right }) {
  return (
    <div className="topbar rise">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1 className="title">{title} <b>{accent}</b></h1>
        {subtitle && <p className="subtitle">{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}

export function ChartTip({ active, payload, label, fmt = (v) => v }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tip">
      {label != null && <div className="muted">{label}</div>}
      {payload.map((p) => (
        <div key={p.dataKey}><b style={{ color: p.color || p.payload?.fill || '#00D4C0' }}>{fmt(p.value, p.dataKey)}</b> {p.name}</div>
      ))}
    </div>
  );
}

// ---------- toasts ----------
const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const push = useCallback((text, kind = 'ok') => {
    const id = Math.random();
    setItems((xs) => [...xs, { id, text, kind }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), 4500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => <div key={t.id} className={`toast ${t.kind}`}>{t.text}</div>)}
      </div>
    </ToastCtx.Provider>
  );
}
