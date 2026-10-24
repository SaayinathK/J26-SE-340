// frontend/src/features/lead-intel/components/Overview.jsx — main dashboard: greeting, hero, KPIs, weekly trend, AI workspace, hottest leads, groups, funnel, sources
import { useEffect, useMemo } from 'react';
import { ArrowRight, BookOpen, Flame, Lock, Percent, Sparkles, Target, TrendingDown, Users } from 'lucide-react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../api.js';
import { SEGMENT, activity, displayName, source } from '../lang.js';
import { Card, ChartTip, ErrorBox, Kpi, LeadName, ScoreBar, Seg, SEG_COLOURS, Skeleton, num, pct, useChart } from '../../../components/ui.jsx';
import { useLoad } from '../../../hooks/useLoad.js';

const STAGE = { 'Captured': 'New lead', 'Engaged': 'Showed interest', 'Engaged (visited site)': 'Showed interest',
  'Contacted': 'We contacted', 'Won': 'Became customer' };
const stage = (s) => STAGE[s] || s.replace(' (visited site)', '');
const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; };

function Hero({ go }) {
  return (
    <section className="hero rise">
      <div>
        <div className="eyebrow">Your leads, a little more intelligent</div>
        <h2>Right lead. Right moment.<span>Real customers.</span></h2>
        <p>Every lead in your CRM gets a chance score. The assistant tells you who to contact first, what to do, and writes the message for you.</p>
        <button className="btn" onClick={() => go('leads')}><Sparkles size={15} /> Find leads to contact <ArrowRight size={15} /></button>
      </div>
      <div className="hero-art" aria-hidden="true">
        <div className="orbit" style={{ width: 340, height: 340 }} />
        <div className="orbit" style={{ width: 230, height: 230 }} />
        <div className="float" style={{ left: '28%', top: 34 }}>
          <div className="lead-card-art">
            <div className="row" style={{ gap: 8 }}>
              <span className="avatar-lead" style={{ width: 26, height: 26, background: '#10b5a4', fontSize: 10 }}>AB</span>
              <b style={{ fontSize: 12 }}>New lead</b>
            </div>
            <div style={{ fontSize: 26, fontWeight: 800, color: '#0a8f82', marginTop: 8 }}>92<span style={{ fontSize: 11, color: '#7a8583' }}> /100</span></div>
            <div className="line" style={{ width: '90%' }} /><div className="line" style={{ width: '70%' }} /><div className="line" style={{ width: '80%' }} />
          </div>
        </div>
        <div className="float" style={{ right: 6, top: 30, animationDelay: '1s' }}><div className="spark-tile"><Sparkles size={22} /></div></div>
        <div className="float" style={{ left: 0, top: 6, animationDelay: '.5s' }}><span className="chip"><i />Scored from your CRM</span></div>
        <div className="float" style={{ right: 0, bottom: 4, animationDelay: '1.5s' }}><span className="chip"><Lock size={11} />Your data only</span></div>
      </div>
    </section>
  );
}

export default function Overview({ session, go, onAuthError }) {
  const C = useChart();
  const { data, error, loading, reload } = useLoad(
    () => Promise.all([api.dashboard(session), api.analytics(session)]), [session.token]);
  useEffect(() => { if (error?.status === 401) onAuthError(); }, [error, onAuthError]);
  // chart data is built once per load, so the charts do not restart their animation on every re-render
  const charts = useMemo(() => {
    if (!data) return null;
    const [d, a] = data;
    return {
      funnel: Object.entries(a.funnel).map(([s, leads]) => ({ stage: stage(s), leads })),
      trend: d.weekly_trend.map((w) => ({ ...w, week: new Date(w.week_start).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) })),
      pie: d.segments.map((s) => ({ ...s, name: `${SEGMENT[s.segment].label} · ${SEGMENT[s.segment].plain}` })),
    };
  }, [data]);

  const header = (
    <div className="topbar rise">
      <div>
        <h1 className="title">{greeting()}, {displayName(session.email)}</h1>
        <p className="subtitle">Here is how your leads are doing today.</p>
      </div>
      <button className="btn" onClick={() => go('score')}><Target size={15} /> Check a new lead</button>
    </div>
  );
  if (loading) return <div className="page">{header}<Skeleton h={230} /><div className="grid g4 section-gap">{[1, 2, 3, 4].map((i) => <Skeleton key={i} h={110} />)}</div></div>;
  if (error) return <div className="page">{header}<ErrorBox error={error} onRetry={reload} /></div>;

  const [dash, ana] = data;
  const { funnel, trend, pie } = charts;
  const segs = Object.fromEntries(dash.segments.map((s) => [s.segment, s]));
  const step = ana.biggest_drop_off;
  const [from, to] = step.split(' -> ').map(stage);
  const objections = Object.entries(ana.common_objections || {});
  const maxObj = Math.max(1, ...objections.map(([, n]) => n));
  const openLead = (id) => { sessionStorage.setItem('c3_open_lead', id); go('leads'); };

  return (
    <div className="page">
      {header}
      <Hero go={go} />

      <div className="section-label"><span>Your leads, at a glance</span><span>● From your CRM records</span></div>
      <div className="grid g4">
        <Kpi icon={Users} label="All leads" value={dash.tenant_leads} sub="People in your CRM" />
        <Kpi icon={Flame} label="Ready to buy (hot)" value={segs.hot?.leads} sub={`${pct(segs.hot?.conversion_rate)} of these bought before`} delay={70} />
        <Kpi icon={Percent} label="Became customers" value={ana.conversion_rate} format={(v) => pct(v)} sub="Out of all leads, in the past" delay={140} />
        <Kpi icon={TrendingDown} label="Where we lose most" value={ana.drop_off_rates[step]} format={(v) => pct(v)} sub={`Between "${from}" and "${to}"`} delay={210} />
      </div>

      <div className="grid g-wide section-gap">
        <Card title="Lead activity" delay={120}
              right={<span className="pill muted">Weekly</span>}
              note={dash.dates_are_synthetic ? 'Demo dates: the original data has no dates, so this chart shows how the feature works.' : null}>
          <p className="muted" style={{ margin: '-8px 0 10px', fontSize: 12.5 }}>Share of leads that became customers, per week.</p>
          <div style={{ height: 230 }}>
            <ResponsiveContainer>
              <AreaChart data={trend} margin={{ left: -10, right: 10 }}>
                <defs>
                  <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={C.accent} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={C.accent} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={C.grid} vertical={false} strokeDasharray="4 4" />
                <XAxis dataKey="week" {...C.axis} />
                <YAxis {...C.axis} tickFormatter={(v) => pct(v)} domain={[0, 'auto']} />
                <Tooltip content={<ChartTip fmt={(v) => `${pct(v, 1)} became customers`} />} />
                <Area type="monotone" dataKey="conversion_rate" name="" stroke={C.accent} strokeWidth={2.5} fill="url(#g)" animationDuration={1200} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card title="Your AI assistant" delay={180} right={<span className="pill">Component 03</span>}>
          <div className="agent-row">
            <span className="agent-mark"><Sparkles size={18} /></span>
            <div>
              <b>Lead Intelligence</b>
              <div className="muted" style={{ fontSize: 12 }}>Scores every lead and suggests the next step.</div>
            </div>
          </div>
          <div className="stat-line"><span>Leads scored</span><b>{num(dash.tenant_leads)}</b></div>
          <div className="stat-line"><span>Ready to buy now</span><b>{num(segs.hot?.leads)}</b></div>
          <div className="stat-line"><span>Knowledge used</span><b><BookOpen size={12} /> your rules + past leads</b></div>
          <div className="stat-line"><span>Workspace data</span><b style={{ color: 'var(--accent-text)' }}><Lock size={12} /> Only your company</b></div>
          <button className="btn ghost" style={{ width: '100%', marginTop: 12 }} onClick={() => go('leads')}>
            <Sparkles size={15} /> Open my leads <span className="spacer" /><ArrowRight size={15} />
          </button>
        </Card>
      </div>

      <div className="grid g-wide section-gap">
        <Card title="Contact these leads first" delay={220}
              right={<button className="btn small ghost" onClick={() => go('leads')}>See all leads <ArrowRight size={14} /></button>}>
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th>Lead</th><th>Chance score</th><th>Group</th><th>Last action</th></tr></thead>
              <tbody>
                {dash.top_10_hottest.slice(0, 6).map((l, i) => (
                  <tr key={l.lead_id} onClick={() => openLead(l.lead_id)} style={{ animationDelay: `${250 + i * 40}ms` }}>
                    <td><LeadName id={l.lead_id} small /></td><td><ScoreBar score={l.score} /></td>
                    <td><Seg value={l.segment} /></td><td className="muted">{activity(l.last_activity)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <Card title="Your leads by group" delay={260} note="Hot = ready to buy, Warm = interested, Cold = not ready yet.">
          <div style={{ height: 190 }}>
            <ResponsiveContainer>
              <PieChart>
                <Pie data={pie} dataKey="leads" nameKey="name" innerRadius={58} outerRadius={86} paddingAngle={3} stroke="none" animationDuration={900}>
                  {pie.map((s) => <Cell key={s.segment} fill={SEG_COLOURS[s.segment]} />)}
                </Pie>
                <Tooltip content={<ChartTip fmt={(v) => `${num(v)} leads`} />} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="legend">
            {dash.segments.map((s) => (
              <span key={s.segment}><i style={{ background: SEG_COLOURS[s.segment] }} />
                {SEGMENT[s.segment].label}: {num(s.leads)} · {pct(s.conversion_rate)} bought</span>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid g3 section-gap">
        <Card title="Steps from new lead to customer" delay={300} note={`We lose the most people between "${from}" and "${to}".`}>
          <div style={{ height: 210 }}>
            <ResponsiveContainer>
              <BarChart data={funnel} layout="vertical" margin={{ left: 10, right: 16 }}>
                <CartesianGrid stroke={C.grid} horizontal={false} />
                <XAxis type="number" {...C.axis} />
                <YAxis type="category" dataKey="stage" width={100} {...C.axis} />
                <Tooltip content={<ChartTip fmt={(v) => `${num(v)} people`} />} cursor={{ fill: C.cursor }} />
                <Bar dataKey="leads" name="" radius={[0, 7, 7, 0]} barSize={22} animationDuration={1000}>
                  {funnel.map((f, i) => <Cell key={f.stage} fill={C.accent} fillOpacity={1 - i * 0.18} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card title="Where the best leads come from" delay={340} note="% = how many of them became customers (sources with 30+ leads).">
          {ana.top_sources.map((s, i) => (
            <div key={s.source} className="factor">
              <span>{source(s.source)}</span>
              <div className="bar"><i className="grow" style={{ left: 0, width: pct(s.conversion_rate), background: C.accent, animationDelay: `${i * 120}ms` }} /></div>
              <b style={{ color: 'var(--accent-text)' }}>{pct(s.conversion_rate)}</b>
            </div>
          ))}
        </Card>
        <Card title="Why people did not buy" delay={380} note="Most common reasons noted by the sales team.">
          {objections.length === 0 && <div className="empty">No reasons recorded yet.</div>}
          {objections.map(([o, n], i) => (
            <div key={o} className="factor">
              <span style={{ textTransform: 'capitalize' }}>{o}</span>
              <div className="bar"><i className="grow" style={{ left: 0, width: `${(n / maxObj) * 100}%`, background: SEG_COLOURS.warm, animationDelay: `${i * 120}ms` }} /></div>
              <b>{num(n)}</b>
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
}
