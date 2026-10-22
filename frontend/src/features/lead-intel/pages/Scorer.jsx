// src/pages/Scorer.jsx — check a new lead: chance score 0-100, group, and the reasons in plain words
import { useState } from 'react';
import { AlertTriangle, ArrowDown, ArrowUp, RotateCcw, Target } from 'lucide-react';
import { canWrite } from '../../../lib/api-client.js';
import { api } from '../api.js';
import { SEGMENT, activity, factorText, origin, source } from '../lang.js';
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
  const toast = useToast();
  const writer = canWrite(session);

  const set = (k) => (e) => setLead({ ...lead, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr(null);
    const body = { ...lead, lead_id: lead.lead_id.trim() || `L-new-${Date.now().toString(36)}` };
    for (const k of ['total_visits', 'time_on_site_sec', 'pages_per_visit']) body[k] = lead[k] === '' ? null : Number(lead[k]);
    if (body.time_on_site_sec == null) body.time_on_site_sec = 0;
    try {
      const r = await api.score(session, body);
      setRes(r);
      setShown(0);
      requestAnimationFrame(() => setTimeout(() => setShown(r.score), 30));   // lets the gauge animate from 0
      setHistory((h) => [{ id: r.lead_id, score: r.score, segment: r.segment }, ...h].slice(0, 6));
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
              <input id="lead_id" className="input" placeholder="we create one for you" value={lead.lead_id} onChange={set('lead_id')} />
            </div>
            {Object.keys(OPTIONS).map((k) => (
              <div key={k} className="field">
                <label htmlFor={k}>{LABELS[k]}</label>
                <select id={k} className="select" value={lead[k]} onChange={set(k)}>
                  {OPTIONS[k].map((o) => <option key={o} value={o}>{SHOW[k](o)}</option>)}
                </select>
              </div>
            ))}
            <div className="field">
              <label htmlFor="total_visits">How many times did they visit our website?</label>
              <input id="total_visits" className="input" type="number" min="0" value={lead.total_visits} onChange={set('total_visits')} />
            </div>
            <div className="field">
              <label htmlFor="time_on_site_sec">Total time on our website (seconds)</label>
              <input id="time_on_site_sec" className="input" type="number" min="0" value={lead.time_on_site_sec} onChange={set('time_on_site_sec')} />
            </div>
            <div className="field">
              <label htmlFor="pages_per_visit">Pages looked at per visit</label>
              <input id="pages_per_visit" className="input" type="number" min="0" step="0.1" value={lead.pages_per_visit} onChange={set('pages_per_visit')} />
            </div>
            <div className="row" style={{ gridColumn: '1 / -1' }}>
              <button className="btn" disabled={busy || !writer}><Target size={16} /> {busy ? 'Checking…' : 'Check this lead'}</button>
              <button type="button" className="btn ghost" onClick={() => { setLead(EMPTY); setRes(null); setErr(null); }}><RotateCcw size={15} /> Start again</button>
            </div>
          </form>
          {err && <div className="section-gap"><ErrorBox error={err} /></div>}
        </Card>

        <Card title="Result" delay={80}>
          {!res && <div className="empty">Fill in the form and press <b>Check this lead</b>.</div>}
          {res && (
            <div className="rise">
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
                  <span>{factorText(f.feature)}</span>
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
              <span key={i} className="pill muted pop">{h.id} · <b style={{ color: 'var(--accent)' }}>{h.score}</b> · {SEGMENT[h.segment]?.label}</span>
            ))}
          </div>
          <div className="card-note">If you check the same lead ID again and it drops to a lower group, you get a warning so you can follow up quickly.</div>
        </Card>
      )}
    </div>
  );
}
