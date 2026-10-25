// frontend/src/features/lead-intel/components/Scorer.jsx — check a new lead: chance score 0-100, group, and the reasons in plain words
import { useState } from 'react';
import { AlertTriangle, ArrowDown, ArrowUp, Database, Info, RotateCcw, Target } from 'lucide-react';
import { canWrite } from '../../../lib/api-client.js';
import { api } from '../api.js';
import { SEGMENT, activity, factorLabel, origin, source } from '../lang.js';
import './lead-extras.css';
import { Card, ErrorBox, PageHeader, Seg, useToast } from '../../../components/ui.jsx';

const OPTIONS = {
  source: ['Google', 'Direct Traffic', 'Olark Chat', 'Organic Search', 'Reference', 'Welingak Website', 'Referral Sites', 'Facebook'],
  lead_origin: ['Landing Page Submission', 'API', 'Lead Add Form', 'Lead Import', 'Quick Add Form'],
  last_activity: ['Email Opened', 'SMS Sent', 'Olark Chat Conversation', 'Page Visited on Website', 'Converted to Lead',
    'Email Bounced', 'Email Link Clicked', 'Form Submitted on Website', 'Unreachable'],
  occupation: ['Unemployed', 'Working Professional', 'Student', 'Other', 'Housewife', 'Businessman'],
  specialization: ['Finance Management', 'Human Resource Management', 'Marketing Management', 'Operations Management',
    'Business Administration', 'IT Projects Management', 'Supply Chain Management', 'Banking, Investment And Insurance', 'Media and Advertising'],
};
const LABELS = { source: 'How did they find us?', lead_origin: 'How was the lead added?', last_activity: 'What did they do last?',
  occupation: 'Their job', specialization: 'What are they interested in?' };
const SHOW = { source, lead_origin: origin, last_activity: activity, occupation: (v) => v, specialization: (v) => v };
const NUMS = ['total_visits', 'time_on_site_sec', 'pages_per_visit'];
// the choices for one field: "Not known" + the usual values + the lead's own value if the CRM has a rarer one
const choices = (k, current) => ['', ...OPTIONS[k], ...(current && !OPTIONS[k].includes(current) ? [current] : [])];
// a CRM record -> form values ('' = not known)
const toForm = (p) => Object.fromEntries([['lead_id', p.lead_id],
  ...Object.keys(OPTIONS).map((k) => [k, p[k] ?? '']), ...NUMS.map((k) => [k, p[k] ?? ''])]);
// Same rules as the API (services/lead-intel/src/models/schemas.py) so mistakes are shown before sending
export function checkLead(l) {
  const e = {};
  const n = (k) => (l[k] === '' || l[k] == null ? null : Number(l[k]));
  if (l.lead_id && !/^[A-Za-z0-9_.:-]{1,64}$/.test(l.lead_id.trim())) e.lead_id = 'Use letters, numbers, - _ . : only (max 64).';
  const visits = n('total_visits'), secs = n('time_on_site_sec'), pages = n('pages_per_visit');
  if (visits != null && (visits < 0 || visits > 1000 || !Number.isFinite(visits))) e.total_visits = 'Enter a number from 0 to 1000.';
  if (secs != null && (secs < 0 || secs > 86400 || !Number.isFinite(secs))) e.time_on_site_sec = 'Enter seconds from 0 to 86400.';
  if (pages != null && (pages < 0 || pages > 200 || !Number.isFinite(pages))) e.pages_per_visit = 'Enter a number from 0 to 200.';
  if (visits === 0 && ((secs || 0) > 0 || (pages || 0) > 0)) e.total_visits = 'With 0 visits, time and pages must also be 0.';
  if ((visits || 0) > 0 && pages === 0) e.pages_per_visit = 'With visits, pages per visit must be more than 0.';
  return e;
}

const EMPTY = { lead_id: '', source: 'Google', lead_origin: 'Landing Page Submission', last_activity: 'Email Opened',
  occupation: 'Working Professional', specialization: 'Business Administration', total_visits: 4, time_on_site_sec: 600, pages_per_visit: 3 };

function GaugeChart({ score }) {
  const len = Math.PI * 85;
  return (
    <div className="gauge">
      <svg width="210" height="120" viewBox="0 0 210 120" aria-hidden="true">
        <path className="track" d="M20 110 A85 85 0 0 1 190 110" fill="none" strokeWidth="16" strokeLinecap="round" />
        <path className="arc" d="M20 110 A85 85 0 0 1 190 110" fill="none" stroke="var(--accent)" strokeWidth="16" strokeLinecap="round"
              strokeDasharray={len} strokeDashoffset={len * (1 - score / 100)} />
      </svg>
      <div className="gauge-num"><b>{score}</b><span className="muted">out of 100</span></div>
    </div>
  );
}

export default function Scorer({ session, onAuthError }) {
  const [lead, setLead] = useState(EMPTY);
  const [res, setRes] = useState(null);
  const [shown, setShown] = useState(0);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState([]);
  const [crmNote, setCrmNote] = useState(null);      // { kind: 'ok' | 'none', text }
  const [loading, setLoading] = useState(false);
  const toast = useToast();
  const writer = canWrite(session);

  const set = (k) => (e) => {
    setLead({ ...lead, [k]: e.target.value });
    if (k === 'lead_id') setCrmNote(null);
  };

  // fill the form with this lead's real CRM details, so the score matches the lead list
  const loadFromCrm = async (id = lead.lead_id.trim()) => {
    if (!id || errors.lead_id) return;
    setLoading(true); setErr(null); setRes(null);
    try {
      const p = await api.profile(session, id);
      setLead(toForm(p));
      setCrmNote({ kind: 'ok', text: `Filled in from your CRM. In the lead list this lead has ${p.score} (${SEGMENT[p.segment]?.label}). Press Check this lead to see the reasons.` });
    } catch (e2) {
      if (e2.status === 401) return onAuthError();
      if (e2.status === 404) setCrmNote({ kind: 'none', text: 'This ID is not in your CRM, so it is checked as a new lead with the details you type.' });
      else setErr(e2);
    } finally {
      setLoading(false);
    }
  };
  const errors = checkLead(lead);
  const bad = Object.keys(errors).length > 0;

  const submit = async (e) => {
    e.preventDefault();
    if (bad) return;
    setBusy(true); setErr(null);
    const body = { ...lead, lead_id: lead.lead_id.trim() || `L-new-${Date.now().toString(36)}` };
    for (const k of Object.keys(OPTIONS)) body[k] = lead[k] === '' ? null : lead[k];
    for (const k of NUMS) body[k] = lead[k] === '' ? null : Number(lead[k]);
    if (body.time_on_site_sec == null) body.time_on_site_sec = 0;
    try {
      const r = await api.score(session, body);
      setRes(r);
      setShown(0);
      requestAnimationFrame(() => setTimeout(() => setShown(r.score), 30));   // lets the gauge animate from 0
      setHistory((h) => [{ id: r.lead_id, score: r.score, segment: r.segment, whatIf: r.what_if }, ...h].slice(0, 6));
      if (r.alert) toast(r.alert.message, 'err');
    } catch (e2) {
      if (e2.status === 401) return onAuthError();
      setErr(e2);
    } finally {
      setBusy(false);
    }
  };

  const maxImpact = Math.max(0.01, ...(res?.top_factors || []).map((f) => Math.abs(f.impact)));

  return (
    <div className="page">
      <PageHeader eyebrow="Check a new lead" title="How likely is this lead to" accent="buy?"
                  subtitle="Fill in what you know about the person. You get a chance score from 0 to 100 and the main reasons for it." />
      <div className="grid g-wide">
        <Card title="About the lead">
          {!writer && <div className="error-box" style={{ marginBottom: 14 }}>You are signed in as a viewer. Only marketers and admins can check leads.</div>}
          <form onSubmit={submit} className="grid g2">
            <div className="field">
              <label htmlFor="lead_id">Lead ID (optional)</label>
              <div className="id-row">
                <input id="lead_id" className={`input ${errors.lead_id ? 'bad' : ''}`} placeholder="we create one for you" value={lead.lead_id}
                       onChange={set('lead_id')} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); loadFromCrm(); } }} />
                <button type="button" className="btn ghost" disabled={loading || !lead.lead_id.trim() || !!errors.lead_id}
                        onClick={() => loadFromCrm()} title="Fill the form with this lead's CRM details">
                  <Database size={15} /> {loading ? 'Loading…' : 'Load from CRM'}
                </button>
              </div>
              {errors.lead_id && <span className="field-error">{errors.lead_id}</span>}
              {crmNote && <span className={`crm-note ${crmNote.kind}`}>{crmNote.text}</span>}
            </div>
            {Object.keys(OPTIONS).map((k) => (
              <div key={k} className="field">
                <label htmlFor={k}>{LABELS[k]}</label>
                <select id={k} className="select" value={lead[k]} onChange={set(k)}>
                  {choices(k, lead[k]).map((o) => <option key={o || 'none'} value={o}>{o ? SHOW[k](o) : 'Not known'}</option>)}
                </select>
              </div>
            ))}
            <div className="field">
              <label htmlFor="total_visits">How many times did they visit our website?</label>
              <input id="total_visits" className={`input ${errors.total_visits ? 'bad' : ''}`} type="number" min="0" value={lead.total_visits} onChange={set('total_visits')} />
              {errors.total_visits && <span className="field-error">{errors.total_visits}</span>}
            </div>
            <div className="field">
              <label htmlFor="time_on_site_sec">Total time on our website (seconds)</label>
              <input id="time_on_site_sec" className={`input ${errors.time_on_site_sec ? 'bad' : ''}`} type="number" min="0" value={lead.time_on_site_sec} onChange={set('time_on_site_sec')} />
              {errors.time_on_site_sec && <span className="field-error">{errors.time_on_site_sec}</span>}
            </div>
            <div className="field">
              <label htmlFor="pages_per_visit">Pages looked at per visit</label>
              <input id="pages_per_visit" className={`input ${errors.pages_per_visit ? 'bad' : ''}`} type="number" min="0" step="0.1" value={lead.pages_per_visit} onChange={set('pages_per_visit')} />
              {errors.pages_per_visit && <span className="field-error">{errors.pages_per_visit}</span>}
            </div>
            <div className="row" style={{ gridColumn: '1 / -1' }}>
              <button className="btn" disabled={busy || !writer || bad}><Target size={16} /> {busy ? 'Checking…' : 'Check this lead'}</button>
              <button type="button" className="btn ghost" onClick={() => { setLead(EMPTY); setRes(null); setErr(null); setCrmNote(null); }}><RotateCcw size={15} /> Start again</button>
            </div>
          </form>
          {err && <div className="section-gap"><ErrorBox error={err} /></div>}
        </Card>

        <Card title="Result" delay={80}>
          {!res && <div className="empty">Fill in the form and press <b>Check this lead</b>.</div>}
          {res && (
            <div className="rise">
              {res.what_if && (
                <div className="what-if">
                  <Info size={18} />
                  <div>
                    <b>What-if score.</b> {res.lead_id} is in your CRM with a score of <b>{res.crm.score}</b> ({SEGMENT[res.crm.segment]?.label}).
                    {' '}You changed: {res.crm.changed.map((c) => c.label).join(', ')}. So {res.score} is the score <i>for the changed details</i>,
                    {' '}not for the real lead. It was not saved to the lead's history.
                    <button type="button" className="link-btn" onClick={() => loadFromCrm(res.lead_id)}>Use the CRM details</button>
                  </div>
                </div>
              )}
              {res.crm && !res.what_if && (
                <div className="crm-match"><Database size={15} /> Same details as your CRM, so this matches the lead list.</div>
              )}
              <GaugeChart score={shown} />
              <div className="row" style={{ justifyContent: 'center', marginBottom: 10 }}>
                <Seg value={res.segment} plain />
              </div>
              <p className="muted" style={{ textAlign: 'center', marginTop: 0 }}>
                {SEGMENT[res.segment]?.tip} In the past, {Math.round((res.confidence?.segment_conversion_rate || 0) * 100)} out of 100
                {' '}{SEGMENT[res.segment]?.label.toLowerCase()} leads became customers.
                {res.confidence?.level === 'low' && ' This score is close to the border of another group, so treat it with care.'}
              </p>
              <div className="muted" style={{ marginBottom: 6 }}>The main reasons for this score</div>
              {res.top_factors.map((f, i) => (
                <div key={f.feature} className="factor rise" style={{ animationDelay: `${i * 100}ms` }}>
                  <span>{factorLabel(f)}</span>
                  <div className="bar">
                    <i className="grow" style={{ width: `${(Math.abs(f.impact) / maxImpact) * 100}%`, left: 0,
                                background: f.impact >= 0 ? 'var(--accent)' : 'var(--danger)' }} />
                  </div>
                  <b style={{ color: f.impact >= 0 ? 'var(--accent)' : 'var(--danger)', display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                    {f.impact >= 0 ? <ArrowUp size={13} /> : <ArrowDown size={13} />}{f.impact >= 0 ? 'raises' : 'lowers'}
                  </b>
                </div>
              ))}
              {res.alert && (
                <div className="alert"><AlertTriangle size={18} /><div>{res.alert.message}</div></div>
              )}
            </div>
          )}
        </Card>
      </div>

      {history.length > 0 && (
        <Card title="Leads you checked today" className="section-gap">
          <div className="row">
            {history.map((h, i) => (
              <span key={i} className="pill muted pop">{h.id} · <b style={{ color: 'var(--accent)' }}>{h.score}</b> · {SEGMENT[h.segment]?.label}{h.whatIf ? ' · what-if' : ''}</span>
            ))}
          </div>
          <div className="card-note">If you check the same lead ID again and it drops to a lower group, you get a warning so you can follow up quickly.</div>
        </Card>
      )}
    </div>
  );
}
