import { AlertCircle, Loader2, Sparkles, CheckCircle2 } from 'lucide-react';
export function ErrorMessage({ children }) { return children ? <div role="alert" className="notice error"><AlertCircle size={18} /><span>{children}</span></div> : null; }
export function SuccessMessage({ children }) { return children ? <div role="status" className="notice success"><CheckCircle2 size={18} /><span>{children}</span></div> : null; }
export function Loading({ children = 'Loading your workspace…' }) { return <div className="loading" role="status"><Loader2 className="animate-spin" size={22} /><span>{children}</span></div>; }
export function Empty({ title, children, action }) { return <div className="empty"><div className="empty-icon"><Sparkles size={25}/></div><h3>{title}</h3><p>{children}</p>{action}</div>; }
export function PageHeading({ eyebrow = 'YOUR WORKSPACE', title, children, action }) { return <div className="page-heading"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p className="subtitle">{children}</p></div>{action}</div>; }
export const typeLabels = { meta_ad: 'Meta Ad', funnel_page: 'Funnel Page', vsl: 'VSL Script', social_post: 'Social Post', email: 'Email' };
export function Badge({ type }) { return <span className={`badge type-${type}`}>{typeLabels[type] || type?.replaceAll('_', ' ') || 'Content'}</span>; }
export const parseObject = value => { if (typeof value !== 'string') return value || {}; try { return JSON.parse(value); } catch { return { text: value }; } };
export const formatDate = value => { const date = new Date(value); return Number.isNaN(date.getTime()) ? 'Date unavailable' : date.toLocaleDateString(undefined, { month:'short', day:'numeric', year:'numeric' }); };
