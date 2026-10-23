// src/pages/Leads.jsx — all segments, search / filter / sort / pages, and a lead drawer in plain English
import { useEffect, useMemo, useRef, useState } from 'react';
import { BarChart3, BookOpen, Check, ChevronLeft, ChevronRight, Copy, Mail, MessageCircle, Search, Sparkles,
  ThumbsDown, ThumbsUp, UserCheck, UserX, X } from 'lucide-react';
import { canWrite } from '../../../lib/api-client.js';
import { api } from '../api.js';
import './lead-extras.css';
import { SEGMENT, activity, explainSource, leadName, minutes, origin, simpleAction, source, strength } from '../lang.js';
import { Avatar, Card, ErrorBox, LeadName, PageHeader, ScoreBar, Seg, SEG_COLOURS, Skeleton, useLoad, useToast } from '../../../components/ui.jsx';

const PAGE = 10;
const SORTS = {
  'score-desc': { label: 'Highest chance first', fn: (a, b) => b.score - a.score },
  'score-asc': { label: 'Lowest chance first', fn: (a, b) => a.score - b.score },
  'name': { label: 'Name A–Z', fn: (a, b) => leadName(a.lead_id).localeCompare(leadName(b.lead_id)) },
};

export default function Leads({ session, onAuthError }) {
  const { data, error, loading, reload } = useLoad(() => api.dashboard(session), [session.token]);
  const [q, setQ] = useState('');
  const [seg, setSeg] = useState('all');
  const [src, setSrc] = useState('all');
  const [sort, setSort] = useState('score-desc');
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState(null);
  const [lookup, setLookup] = useState('');

  useEffect(() => { if (error?.status === 401) onAuthError(); }, [error, onAuthError]);
  const all = useMemo(() => data?.leads || data?.top_10_hottest || [], [data]);

  useEffect(() => {                         // opened from the Overview page
    const id = sessionStorage.getItem('c3_open_lead');
    if (id && data) {
      sessionStorage.removeItem('c3_open_lead');
      setOpen(all.find((l) => l.lead_id === id) || { lead_id: id });
    }
  }, [data, all]);
  useEffect(() => setPage(0), [q, seg, src, sort]);
  useEffect(() => {                         // search typed in the top bar
    const pick = () => { const t = sessionStorage.getItem('c3_search'); if (t) { sessionStorage.removeItem('c3_search'); setSeg('all'); setQ(t); } };
    pick();
    window.addEventListener('c3-search', pick);
    return () => window.removeEventListener('c3-search', pick);
  }, []);

  const counts = useMemo(() => {
    const c = { all: all.length, hot: 0, warm: 0, cold: 0 };
    all.forEach((l) => { c[l.segment] += 1; });
    return c;
  }, [all]);
  const sources = useMemo(() => [...new Set(all.map((l) => l.source).filter(Boolean))].sort(), [all]);
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return all
      .filter((l) => seg === 'all' || l.segment === seg)
      .filter((l) => src === 'all' || l.source === src)
      .filter((l) => !needle || [leadName(l.lead_id), l.lead_id, l.source, source(l.source), l.city, l.occupation]
        .join(' ').toLowerCase().includes(needle))
      .sort(SORTS[sort].fn);
  }, [all, seg, src, q, sort]);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const shown = rows.slice(page * PAGE, page * PAGE + PAGE);

  return (
    <div className="page">
      <PageHeader eyebrow="Leads" title="Who should we contact" accent="first?"
                  subtitle="Every lead has a chance score from 0 to 100. Higher means more likely to become a customer. Click a lead to see what to do next." />

      <Card title="Your leads" note="Names are made up for this demo because the CRM data is anonymised. The real lead ID is shown under each name.">
        <div className="toolbar">
          <div className="tabs" role="tablist">
            {['all', 'hot', 'warm', 'cold'].map((s) => (
              <button key={s} role="tab" aria-selected={seg === s} className={`tab ${seg === s ? 'on' : ''}`} onClick={() => setSeg(s)}>
                {s !== 'all' && <span className="dot-seg" style={{ background: SEG_COLOURS[s] }} />}
                {s === 'all' ? 'All' : `${SEGMENT[s].label} · ${SEGMENT[s].plain}`}
                <span className="count">{counts[s]}</span>
              </button>
            ))}
          </div>
          <span className="spacer" />
          <div className="search" style={{ width: 230 }}>
            <Search size={16} />
            <input className="input" placeholder="Search name, ID, city…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search leads" />
          </div>
          <select className="select" style={{ width: 190 }} value={src} onChange={(e) => setSrc(e.target.value)} aria-label="Filter by source">
            <option value="all">All sources</option>
            {sources.map((s) => <option key={s} value={s}>{source(s)}</option>)}
          </select>
          <select className="select" style={{ width: 190 }} value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort">
            {Object.entries(SORTS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </div>

        {loading && <Skeleton h={420} />}
        {error && <ErrorBox error={error} onRetry={reload} />}
        {data && (
          <>
            <div className="table-wrap">
              <table className="tbl">
                <thead><tr><th>Lead</th><th>Chance score</th><th>Group</th><th>How they found us</th><th>Last action</th><th>City</th></tr></thead>
                <tbody>
                  {shown.map((l, i) => (
                    <tr key={l.lead_id} onClick={() => setOpen(l)} style={{ animationDelay: `${i * 30}ms` }} tabIndex={0}
                        onKeyDown={(e) => e.key === 'Enter' && setOpen(l)}>
                      <td><LeadName id={l.lead_id} small /></td>
                      <td><ScoreBar score={l.score} /></td>
                      <td><Seg value={l.segment} /></td>
                      <td>{source(l.source)}</td>
                      <td className="muted">{activity(l.last_activity)}</td>
                      <td className="muted">{l.city || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length === 0 && <div className="empty">No leads match. Try another group, source or search word.</div>}
            </div>
            {rows.length > 0 && (
              <div className="pager">
                <span>{page * PAGE + 1}–{Math.min(rows.length, page * PAGE + PAGE)} of {rows.length}</span>
                <button className="icon-btn" disabled={page === 0} onClick={() => setPage(page - 1)} aria-label="Previous page"><ChevronLeft size={16} /></button>
                <span>Page {page + 1} / {pages}</span>
                <button className="icon-btn" disabled={page >= pages - 1} onClick={() => setPage(page + 1)} aria-label="Next page"><ChevronRight size={16} /></button>
              </div>
            )}
          </>
        )}
      </Card>

      <Card title="Find a lead by ID" className="section-gap" delay={80}
            note="Type a lead ID from your CRM. You can only open leads of your own company.">
        <form className="row" onSubmit={(e) => { e.preventDefault(); if (lookup.trim()) setOpen(all.find((l) => l.lead_id === lookup.trim()) || { lead_id: lookup.trim() }); }}>
          <input className="input" style={{ maxWidth: 320 }} placeholder="for example L-13d564f8b5" value={lookup} onChange={(e) => setLookup(e.target.value)} />
          <button className="btn">Open lead</button>
        </form>
      </Card>

      {open && <LeadDrawer key={open.lead_id} lead={open} session={session} onClose={() => setOpen(null)} onAuthError={onAuthError} />}
    </div>
  );
}

const STEPS = ['Checking the lead', 'Finding similar past leads and your rules', 'Writing the advice', 'Checking every reason is real'];
const WHY_ICON = { rule: BookOpen, won: UserCheck, lost: UserX, pattern: BarChart3 };

function LeadDrawer({ lead, session, onClose, onAuthError }) {
  const [rec, setRec] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [secs, setSecs] = useState(0);
  const [copied, setCopied] = useState(false);
  const [outcome, setOutcome] = useState(null);
  const toast = useToast();
  const timer = useRef(null);
  const writer = canWrite(session);
  const name = leadName(lead.lead_id);
  const score = lead.score ?? rec?.score;
  const segment = lead.segment ?? rec?.segment;

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); clearInterval(timer.current); };
  }, [onClose]);

  const ask = async () => {
    setBusy(true); setErr(null); setRec(null); setSecs(0);
    const t0 = Date.now();
    timer.current = setInterval(() => setSecs(Math.round((Date.now() - t0) / 1000)), 1000);
    try {
      setRec(await api.recommendation(session, lead.lead_id));
    } catch (e) {
      if (e.status === 401) return onAuthError();
      setErr(e.status === 404 ? new Error('We could not find this lead in your company.') : e);
    } finally {
      clearInterval(timer.current); setBusy(false);
    }
  };

  const record = async (value) => {
    try {
      const r = await api.outcome(session, lead.lead_id, value);
      setOutcome(r.outcome);
      toast(r.outcome === 'won' ? `Saved: ${name} became a customer 🎉` : `Saved: ${name} did not buy.`);
    } catch (e) {
      if (e.status === 401) return onAuthError();
      toast(e.message, 'err');
    }
  };

  const copy = async () => {
    try { await navigator.clipboard.writeText(rec.message_draft); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { toast('Your browser did not allow copying', 'err'); }
  };

  const step = Math.min(STEPS.length - 1, Math.floor(secs / 20));
  const why = (rec?.sources || []).map(explainSource);
  const st = strength(rec?.confidence);

  return (
    <>
      <div className="overlay" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={`Lead ${name}`}>
        <div className="row">
          <div className="eyebrow">Lead</div>
          <span className="spacer" />
          <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="drawer-head">
          <Avatar id={lead.lead_id} size={52} />
          <div>
            <h2>{name}</h2>
            <span className="lead-id">ID {lead.lead_id}</span>
          </div>
        </div>
        <div className="demo-note">Demo name. The real ID is the one from your CRM.</div>

        {score != null && (
          <div className="chance">
            <div className="ring" style={{ '--p': score }}><div><b>{score}</b><small>/ 100</small></div></div>
            <div>
              <Seg value={segment} plain />
              <p className="muted" style={{ margin: '8px 0 0' }}>{SEGMENT[segment]?.tip}</p>
            </div>
          </div>
        )}

        {lead.source !== undefined && (
          <div className="kv">
            <div><span className="k">Job</span>{lead.occupation || 'Not given'}</div>
            <div><span className="k">Interested in</span>{lead.specialization || 'Not given'}</div>
            <div><span className="k">How they found us</span>{source(lead.source)}</div>
            <div><span className="k">Added through</span>{origin(lead.lead_origin)}</div>
            <div><span className="k">Time on our website</span>{lead.total_visits == null ? 'Visits not known' : `${lead.total_visits} visits`} · {minutes(lead.time_on_site_sec)}</div>
            <div><span className="k">Last action</span>{activity(lead.last_activity)}</div>
          </div>
        )}

        <Card title="What should we do next?" className="section-gap">
          {!rec && !busy && (
            <>
              <p className="muted" style={{ marginTop: 0 }}>
                The assistant looks at your company's rules and at similar past leads, then suggests the next step and writes a message for you.
                It only answers when it can show where the advice comes from.
              </p>
              {writer
                ? <button className="btn pulse" onClick={ask}><Sparkles size={16} /> Get advice</button>
                : <span className="pill muted">Viewers can see leads but cannot ask for advice</span>}
            </>
          )}
          {busy && (
            <>
              <div className="row"><b>Working on it… {secs}s</b><span className="spacer" /><span className="muted">This takes about 1–2 minutes</span></div>
              <div className="progress"><div /></div>
              <div className="steps">
                {STEPS.map((s, i) => (
                  <div key={s} className={`step ${i < step ? 'done' : i === step ? 'now' : ''}`}>
                    {i < step ? <span className="chk pop"><Check size={12} /></span> : i === step ? <span className="spin" /> : <span className="wait" />}
                    {s}
                  </div>
                ))}
              </div>
            </>
          )}
          {err && <ErrorBox error={err} onRetry={ask} />}
          {rec && !rec.grounded && (
            <div className="error-box">We could not find a reliable reason for advice, so nothing is shown. Please try again.
              <div style={{ marginTop: 10 }}><button className="btn small ghost" onClick={ask}>Try again</button></div></div>
          )}
          {rec?.grounded && (
            <div className="rise">
              <div className="todo">
                <div className="todo-icon"><Sparkles size={20} /></div>
                <div>
                  <h4>Do this</h4>
                  <p>{simpleAction(rec)}</p>
                  <span className="todo-note">This step is your company rule for {SEGMENT[segment]?.label.toLowerCase()} leads, so it is the same for every {SEGMENT[segment]?.label.toLowerCase()} lead.</span>
                </div>
              </div>
              {rec.talking_points?.length > 0 && (
                <div className="personal">
                  <div className="muted" style={{ marginBottom: 8 }}>Make it personal: about {name.split(' ')[0]} only</div>
                  <ul>{rec.talking_points.map((p) => <li key={p}><UserCheck size={14} /><span>{p}</span></li>)}</ul>
                </div>
              )}
              <div className="row" style={{ marginBottom: 12 }}>
                <span className={`pill ${rec.policy_check === 'consistent' ? '' : 'warn'}`}>
                  {rec.policy_check === 'consistent' ? <><Check size={13} /> Matches your company rule</> : 'Please check with your rule'}
                </span>
                <span className={`pill ${st.cls}`} title="How closely the reasons match this lead">{st.label}</span>
                {rec.cached && <span className="pill muted">Saved answer</span>}
              </div>

              <div className="muted" style={{ marginBottom: 8 }}>Why we suggest this</div>
              <div className="why">
                {why.map((w, i) => {
                  const Icon = WHY_ICON[w.kind] || BookOpen;
                  return (
                    <div key={i} className="why-item rise" style={{ animationDelay: `${i * 90}ms` }}>
                      <span className={`ic ${w.kind}`}><Icon size={16} /></span>
                      <div><b>{w.title}</b><span>{w.body}</span></div>
                    </div>
                  );
                })}
              </div>

              {rec.message_draft && (
                <>
                  <div className="row" style={{ margin: '18px 0 8px' }}>
                    <span className="muted">Message you can send</span><span className="spacer" />
                  </div>
                  <div className="rec-msg">{rec.message_draft}</div>
                  <div className="share">
                    <button className="btn small ghost" onClick={copy}>{copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copied' : 'Copy'}</button>
                    <a className="btn small ghost" href={`mailto:?subject=${encodeURIComponent('Your enquiry')}&body=${encodeURIComponent(rec.message_draft)}`}><Mail size={14} /> Email</a>
                    <a className="btn small ghost" target="_blank" rel="noreferrer" href={`https://wa.me/?text=${encodeURIComponent(rec.message_draft)}`}><MessageCircle size={14} /> WhatsApp</a>
                  </div>
                </>
              )}

              <details className="tech">
                <summary>Technical details</summary>
                <p className="muted" style={{ fontSize: 12.5 }}>Model answer: {rec.next_best_action}</p>
                <p className="muted" style={{ fontSize: 12.5 }}>Model {rec.llm_model} · search {rec.retrieval_method} · match {Math.round((rec.confidence || 0) * 100)}% ·
                  sources {rec.sources.map((s) => s.label).join(', ')}</p>
              </details>
            </div>
          )}
        </Card>

        {writer && (
          <Card title="Did this lead become a customer?" className="section-gap" delay={60}
                note="Tell us when you know. We compare the real result with the score to keep the scores accurate.">
            <div className="row">
              <button className="btn success" onClick={() => record('won')} disabled={outcome === 'won'}><ThumbsUp size={15} /> Yes, they bought</button>
              <button className="btn danger" onClick={() => record('lost')} disabled={outcome === 'lost'}><ThumbsDown size={15} /> No</button>
              {outcome && <span className="pill pop">Saved</span>}
            </div>
          </Card>
        )}
      </aside>
    </>
  );
}
