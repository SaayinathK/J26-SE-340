// frontend/src/features/lead-intel/pages/History.jsx — FR10 everything the AI said about each lead, in one page
// Left: every lead that has history. Right: the chosen lead's score over time + a timeline of
// scores, advice and results (newest first). Uses only the shared UI pieces and theme colours.
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, BarChart3, BookOpen, Database, FileText, History as HistoryIcon, MessageSquareText, RefreshCw,
  Search, Sparkles, Target, ThumbsDown, ThumbsUp, Trophy, UserCheck, UserX, Users } from 'lucide-react';
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../api.js';
import { SEGMENT, explainSource, factorLabel, leadName, simpleAction } from '../lang.js';
import { Avatar, Card, ChartTip, ErrorBox, Kpi, LeadName, PageHeader, Seg, Skeleton, useChart, useLoad } from '../../../components/ui.jsx';
import './history.css';

const FILTERS = [
  { id: 'all', label: 'All', test: () => true },
  { id: 'advice', label: 'With advice', test: (l) => l.recommendations > 0 },
  { id: 'result', label: 'With a result', test: (l) => l.outcomes > 0 },
];
const WHY_ICON = { rule: BookOpen, won: UserCheck, lost: UserX, pattern: BarChart3 };
const FROM = {
  api: 'Checked on "Check a new lead"',
  recommendation: 'Scored when advice was asked',
  outcome: 'Scored when the result was recorded',
  seed: 'Added by the demo seed script',
};

const when = (iso) => (iso ? new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '–');
function ago(iso) {
  if (!iso) return '';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
}
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

export default function History({ session, go, onAuthError }) {
  const { data, error, loading, reload } = useLoad(() => api.history(session), [session.token]);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState(null);
  useEffect(() => { if (error?.status === 401) onAuthError(); }, [error, onAuthError]);

  const leads = useMemo(() => {
    const q = query.trim().toLowerCase();
    const f = FILTERS.find((x) => x.id === filter).test;
    return (data?.leads || []).filter((l) => f(l) && (!q || l.lead_id.toLowerCase().includes(q) || leadName(l.lead_id).toLowerCase().includes(q)));
  }, [data, query, filter]);
  useEffect(() => {
    if (leads.length && !leads.some((l) => l.lead_id === selected)) setSelected(leads[0].lead_id);
  }, [leads, selected]);

  const storage = data?.storage === 'postgres'
    ? <span className="pill"><Database size={13} /> Saved in the C3 database</span>
    : data ? <span className="pill muted"><FileText size={13} /> Saved in local files</span> : null;
  const header = (
    <PageHeader eyebrow="Lead history" title="Everything the AI said about" accent="each lead"
                subtitle="Every score, every piece of advice and every result is saved, never overwritten. Pick a lead to see its full story, newest first."
                right={<div className="row">{storage}<button className="btn ghost" onClick={reload}><RefreshCw size={15} /> Refresh</button></div>} />
  );

  if (loading && !data) return <div className="page">{header}<div className="grid g4">{[1, 2, 3, 4].map((i) => <Skeleton key={i} h={104} />)}</div></div>;
  if (error) return <div className="page">{header}<ErrorBox error={error} onRetry={reload} /></div>;

  const t = data.totals;
  if (!t.leads) {
    return (
      <div className="page">
        {header}
        <Card title="No history yet">
          <div className="empty">
            History appears when the AI works on a lead. Open a lead on the <b>Leads</b> page and press <b>Get advice</b>,
            answer <b>"Did this lead become a customer?"</b>, or check a lead on <b>Check a new lead</b>.
            <div className="section-gap"><button className="btn" onClick={() => go('leads')}><Users size={15} /> Open my leads</button></div>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="page">
      {header}
      <div className="grid g4">
        <Kpi icon={Users} label="Leads with history" value={t.leads} sub="leads the AI has worked on" />
        <Kpi icon={Target} label="Scores saved" value={t.scores} sub="every score, with its reasons" delay={70} />
        <Kpi icon={Sparkles} label="Advice saved" value={t.recommendations} sub="next step + message + sources" delay={140} />
        <Kpi icon={Trophy} label="Results recorded" value={t.outcomes} sub="bought or did not buy" delay={210} />
      </div>

      <div className="hist-grid section-gap">
        <Card title="Leads" delay={120} className="hist-list-card">
          <div className="search"><Search size={15} />
            <input className="input" placeholder="Search name or ID…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search leads with history" />
          </div>
          <div className="tabs hist-filters" role="tablist">
            {FILTERS.map((f) => (
              <button key={f.id} role="tab" aria-selected={filter === f.id} className={`tab ${filter === f.id ? 'on' : ''}`} onClick={() => setFilter(f.id)}>{f.label}</button>
            ))}
          </div>
          <div className="hist-list">
            {leads.map((l, i) => (
              <button key={l.lead_id} className={`hist-item ${selected === l.lead_id ? 'on' : ''}`} onClick={() => setSelected(l.lead_id)}
                      style={{ animationDelay: `${Math.min(i, 12) * 30}ms` }} aria-current={selected === l.lead_id ? 'true' : undefined}>
                <LeadName id={l.lead_id} small />
                <span className="hist-item-side">
                  {l.last_score != null && <span className="hist-score">{l.last_score}{l.last_segment && <Seg value={l.last_segment} />}</span>}
                  <span className="hist-meta">
                    {plural(l.scores, 'score')}{l.recommendations ? ` · ${l.recommendations} advice` : ''}
                    {l.last_outcome ? ` · ${l.last_outcome === 'won' ? 'bought' : 'did not buy'}` : ''}
                  </span>
                  <span className="hist-meta">{ago(l.last_at)}</span>
                </span>
              </button>
            ))}
            {!leads.length && <div className="empty">No lead matches your search.</div>}
          </div>
        </Card>
        {selected ? <LeadStory key={selected} id={selected} session={session} onAuthError={onAuthError} /> : <Card><div className="empty">Pick a lead.</div></Card>}
      </div>
    </div>
  );
}

function LeadStory({ id, session, onAuthError }) {
  const C = useChart();
  const { data: h, error, loading, reload } = useLoad(() => api.leadHistory(session, id), [id, session.token]);
  useEffect(() => { if (error?.status === 401) onAuthError(); }, [error, onAuthError]);
  const series = useMemo(() => (h?.score_series || []).map((p, i) => ({ ...p, n: i + 1, label: when(p.at) })), [h]);

  if (loading) return <Card><Skeleton h={420} /></Card>;
  if (error) return <Card><ErrorBox error={error} onRetry={reload} /></Card>;

  const last = h.score_series.at(-1);
  return (
    <Card className="hist-story" delay={60}>
      <div className="hist-head">
        <Avatar id={id} size={48} />
        <div>
          <h2>{leadName(id)}</h2>
          <span className="lead-id">ID {id}</span>
        </div>
        <span className="spacer" />
        {h.profile ? <Seg value={h.profile.segment} plain /> : <span className="pill muted">Checked by hand (not in the lead list)</span>}
      </div>

      <div className="kv hist-kv">
        <div><span className="k">Score in your lead list now</span><b>{h.profile ? `${h.profile.score} / 100` : '–'}</b></div>
        <div><span className="k">Last saved score</span><b>{last ? `${last.score} / 100` : '–'}</b></div>
        <div><span className="k">Times scored</span><b>{h.counts.scores}</b></div>
        <div><span className="k">Advice · results</span><b>{h.counts.recommendations} · {h.counts.outcomes}</b></div>
      </div>

      <div className="muted hist-sub">Score over time</div>
      {series.length > 1 ? (
        <div style={{ height: 190 }}>
          <ResponsiveContainer>
            <LineChart data={series} margin={{ left: -18, right: 12, top: 6 }}>
              <CartesianGrid stroke={C.grid} vertical={false} />
              <XAxis dataKey="n" {...C.axis} tickFormatter={(n) => `#${n}`} />
              <YAxis {...C.axis} domain={[0, 100]} ticks={[0, 40, 70, 100]} />
              <ReferenceLine y={70} stroke={C.muted} strokeDasharray="4 4" label={{ value: 'Hot', position: 'insideTopRight', fill: C.axis.tick.fill, fontSize: 11 }} />
              <ReferenceLine y={40} stroke={C.muted} strokeDasharray="4 4" label={{ value: 'Warm', position: 'insideTopRight', fill: C.axis.tick.fill, fontSize: 11 }} />
              <Tooltip content={<ChartTip fmt={(v) => `${v} / 100`} />} cursor={{ stroke: C.muted }}
                       labelFormatter={(n) => series[n - 1]?.label} />
              <Line type="monotone" dataKey="score" name="score" stroke={C.accent} strokeWidth={2.5}
                    dot={{ r: 4, fill: C.accent }} activeDot={{ r: 6 }} animationDuration={900} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p className="muted hist-note">{series.length ? `Scored once: ${series[0].score} / 100. The line appears after the next score.` : 'Not scored yet.'}</p>
      )}

      <div className="muted hist-sub">What happened (newest first)</div>
      <ol className="timeline">
        {h.events.map((e, i) => <Event key={`${e.type}-${e.id}`} e={e} i={i} />)}
      </ol>
    </Card>
  );
}

function Event({ e, i }) {
  const style = { animationDelay: `${Math.min(i, 10) * 60}ms` };
  if (e.type === 'outcome') {
    const won = e.outcome === 'won';
    return (
      <li className={`tl-item rise ${won ? 'won' : 'lost'}`} style={style}>
        <span className="tl-dot">{won ? <ThumbsUp size={14} /> : <ThumbsDown size={14} />}</span>
        <div className="tl-body">
          <div className="tl-top"><b>{won ? 'Became a customer' : 'Did not buy'}</b><span className="tl-time">{when(e.created_at)}</span></div>
          <p>Score at that time: <b>{e.score} / 100</b> ({SEGMENT[e.segment]?.label}). This result is used to check and retrain the model.</p>
        </div>
      </li>
    );
  }
  if (e.type === 'recommendation') {
    return (
      <li className="tl-item rise advice" style={style}>
        <span className="tl-dot"><Sparkles size={14} /></span>
        <div className="tl-body">
          <div className="tl-top"><b>AI advice</b><span className="tl-time">{when(e.created_at)}</span></div>
          {e.grounded ? (
            <>
              <div className="tl-do"><MessageSquareText size={15} /><span>{simpleAction(e)}</span></div>
              <div className="row tl-pills">
                <span className={`pill ${e.policy_check === 'consistent' ? '' : 'warn'}`}>
                  {e.policy_check === 'consistent' ? 'Matches your company rule' : 'Please check with your rule'}
                </span>
                {e.score != null && <span className="pill muted">Score {e.score} · {SEGMENT[e.segment]?.label}</span>}
              </div>
              {e.message_draft && <div className="rec-msg tl-msg">{e.message_draft}</div>}
              {e.sources?.length > 0 && (
                <div className="why tl-why">
                  {e.sources.map((s, k) => {
                    const w = explainSource(s);
                    const Icon = WHY_ICON[w.kind] || BookOpen;
                    return (
                      <div key={k} className="why-item">
                        <span className={`ic ${w.kind}`}><Icon size={15} /></span>
                        <div><b>{s.label} · {w.title}</b><span>{w.body}</span></div>
                      </div>
                    );
                  })}
                </div>
              )}
              <div className="tl-tech">
                {[e.llm_model && `Model ${e.llm_model}`, e.retrieval_method && `search ${e.retrieval_method}`,
                  e.latency_sec != null && `${e.latency_sec} s`].filter(Boolean).join(' · ')}
              </div>
            </>
          ) : (
            <p className="tl-blocked"><AlertTriangle size={14} /> Blocked: the AI could not show a source from your data, so no advice was given.</p>
          )}
        </div>
      </li>
    );
  }
  return (
    <li className="tl-item rise score" style={style}>
      <span className="tl-dot"><Target size={14} /></span>
      <div className="tl-body">
        <div className="tl-top">
          <b>Scored {e.score} / 100</b><Seg value={e.segment} /><span className="tl-time">{when(e.created_at)}</span>
        </div>
        {e.alert && <p className="tl-alert"><AlertTriangle size={14} /> Dropped from {SEGMENT[e.alert.from]?.label} to {SEGMENT[e.alert.to]?.label}. Follow up before it goes cold.</p>}
        {e.top_factors?.length > 0 && (
          <ul className="tl-factors">
            {e.top_factors.map((f) => (
              <li key={f.feature}><span className={f.impact >= 0 ? 'up' : 'down'}>{f.impact >= 0 ? 'raises' : 'lowers'}</span>{factorLabel(f)}</li>
            ))}
          </ul>
        )}
        <div className="tl-tech"><HistoryIcon size={12} /> {FROM[e.source] || e.source} · model {e.model_version}</div>
      </div>
    </li>
  );
}
