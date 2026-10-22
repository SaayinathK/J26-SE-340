// src/pages/Health.jsx — FR7 model monitoring in plain words: are the scores still right?
import { useEffect } from 'react';
import { CheckCircle2, RefreshCw, ShieldAlert, Target, Trophy } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../api.js';
import { SEGMENT } from '../lang.js';
import { Card, ChartTip, ErrorBox, Kpi, PageHeader, Skeleton, pct, useChart, useLoad } from '../../../components/ui.jsx';


export default function Health({ session, onAuthError }) {
  const C = useChart();
  const { data: m, error, loading, reload } = useLoad(() => api.monitoring(session), [session.token]);
  useEffect(() => { if (error?.status === 401) onAuthError(); }, [error, onAuthError]);

  const header = (
    <PageHeader eyebrow="Score check" title="Are the scores still" accent="right?"
                subtitle="When you tell us whether a lead bought or not, we compare it with the score we gave. If the scores stop matching reality, we say so."
                right={<button className="btn ghost" onClick={reload}><RefreshCw size={15} /> Refresh</button>} />
  );
  if (loading) return <div className="page">{header}<div className="grid g4">{[1, 2, 3, 4].map((i) => <Skeleton key={i} h={104} />)}</div></div>;
  if (error) return <div className="page">{header}<ErrorBox error={error} onRetry={reload} /></div>;

  if (!m.tenant_outcomes) {
    return (
      <div className="page">
        {header}
        <Card title="No results yet">
          <div className="empty">Open a lead on the <b>Leads</b> page and answer <b>"Did this lead become a customer?"</b>.
            The check starts after 10 answers that include both "yes" and "no".</div>
        </Card>
      </div>
    );
  }

  const segs = ['hot', 'warm', 'cold'].filter((s) => m.segments[s]).map((s) => ({
    segment: SEGMENT[s].label, expected: m.segments[s].avg_score / 100, actual: m.segments[s].won_rate,
  }));
  const quality = m.auc == null ? null : m.auc >= 0.85 ? 'Very good' : m.auc >= 0.8 ? 'Good' : m.auc >= 0.7 ? 'Fair' : 'Poor';

  return (
    <div className="page">
      {header}
      <div className="grid g4">
        <Kpi icon={Target} label="Results you told us" value={m.tenant_outcomes} sub="bought or did not buy" />
        <Kpi icon={Trophy} label="Of these, bought" value={m.won_rate} format={(v) => pct(v)} sub="share that became customers" delay={70} />
        <Kpi icon={CheckCircle2} label="Ranking quality" value={m.auc} format={(v) => v.toFixed(2)}
             sub={m.auc == null ? 'needs 10 answers with yes and no' : `${quality} (1.00 = perfect, aim ≥ 0.80)`} delay={140} />
        <Kpi icon={ShieldAlert} label="Score error" value={m.brier} format={(v) => v.toFixed(3)} sub="lower is better (0 = no error)" delay={210} />
      </div>

      <div className="grid g-wide section-gap">
        <Card title="Score given vs. what really happened" delay={160}
              note="Grey = the average score we gave. Teal = how many really bought. Close bars mean the scores are right.">
          <div style={{ height: 260 }}>
            <ResponsiveContainer>
              <BarChart data={segs} margin={{ left: -10, right: 10 }}>
                <CartesianGrid stroke={C.grid} vertical={false} />
                <XAxis dataKey="segment" {...C.axis} />
                <YAxis {...C.axis} tickFormatter={(v) => pct(v)} domain={[0, 1]} />
                <Tooltip content={<ChartTip fmt={(v) => pct(v)} />} cursor={{ fill: C.cursor }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="expected" name="score we gave" fill={C.muted} radius={[6, 6, 0, 0]} animationDuration={900} />
                <Bar dataKey="actual" name="really bought" fill={C.accent} radius={[6, 6, 0, 0]} animationDuration={900} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card title="Does the model need new training?" delay={220}>
          {m.auc == null ? (
            <>
              <div className="big-stat" style={{ color: 'var(--warm)' }}>Not enough answers yet</div>
              <p className="muted">We need at least 10 answers, with some "bought" and some "did not buy".</p>
            </>
          ) : m.retrain_recommended ? (
            <>
              <div className="big-stat" style={{ color: 'var(--danger)' }}>Yes, retrain soon</div>
              <ul>{m.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
            </>
          ) : (
            <>
              <div className="big-stat">No, all good</div>
              <p className="muted">The scores still rank leads well, and each group's real buying rate is close to its score.</p>
            </>
          )}
          <div className="card-note">Your answers are also used to train better models later (Component 2, continuous learning).</div>
        </Card>
      </div>
    </div>
  );
}
