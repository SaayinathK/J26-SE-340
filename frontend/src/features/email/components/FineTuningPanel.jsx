import { useEffect, useState } from 'react';
import { Badge, Button, EmptyState, Field, Icon, Modal } from '../../../components/ui.jsx';
import { dateLabel } from '../lib/studio.js';

const percent = value => `${Math.round((value || 0) * 100)}%`;
export default function FineTuningPanel({ intelligence, mutate, notify, canManage }) {
  const data = intelligence.fineTuning;
  const [enabled, setEnabled] = useState(false);
  const [autoQueue, setAutoQueue] = useState(false);
  const [autoActivate, setAutoActivate] = useState(false);
  const [pending, setPending] = useState('');
  const [error, setError] = useState('');
  const [connection, setConnection] = useState(null);
  const [confirm, setConfirm] = useState(null);
  useEffect(() => {
    setEnabled(data?.settings.enabled || false);
    setAutoQueue(data?.settings.auto_queue || false);
    setAutoActivate(data?.settings.auto_activate || false);
  }, [data?.settings.version]);
  // A one-time worker credential stays in memory and disappears when this view closes.
  async function action(key, path, method, body, message) {
    setPending(key); setError('');
    try {
      if (!canManage) throw new Error('Only an administrator can manage language-model training.');
      const result = await mutate(`/finetuning${path}`, method, body);
      if (key === 'connect') setConnection(result);
      notify(message); setConfirm(null);
    } catch (failure) { setError(failure.message); void intelligence.refresh(); }
    finally { setPending(''); }
  }
  if (!data) return <section className="studio-panel"><EmptyState icon="loader" title="Loading language-model training" description={intelligence.error || 'Reading reviewed examples and Colab jobs.'} /></section>;
  const { settings, readiness, jobs, workers } = data;
  const busy = !!pending;
  const openJob = jobs.some(job => ['queued', 'running'].includes(job.status));
  const activeWorkers = workers.filter(worker => !worker.revoked_at && new Date(worker.expires_at) > new Date());
  const connected = activeWorkers.some(worker => worker.last_seen_at && Date.now() - new Date(worker.last_seen_at).getTime() < 150000);
  const changed = enabled !== settings.enabled || autoQueue !== settings.auto_queue || autoActivate !== settings.auto_activate;
  return <div className="studio-finetuning">
    <div className="studio-section-heading"><div><span className="eyebrow">TEACH YOUR WRITING MODEL</span><h2>Mistral fine-tuning</h2><p>Train a workspace adapter from reviewed writing. Compare it before using it.</p></div><Badge variant={connected ? 'success' : 'neutral'} dot>{connected ? 'Colab connected' : 'Colab not connected'}</Badge></div>
    {error && <p className="auth-error" role="alert">{error}</p>}
    <div className="studio-inline-note"><Icon name="shield" size={18} /><span>This updates language-model adapter weights in batches. Only current, highly rated, grounded examples are eligible. Samples and text containing detectable email addresses or phone numbers are excluded. Human review is still required.</span></div>
    <div className="studio-learning-grid">
      <section className="studio-panel"><div className="studio-panel-heading"><div><h3>Language-model training consent</h3><p>Separate from aggregate engagement learning.</p></div><Icon name="shield" /></div><div className="studio-panel-body">
        <label className="studio-setting"><span><strong>Allow reviewed text to train Mistral</strong><small>Process this workspace’s eligible briefs, knowledge and email copy in your connected Colab runtime. Adapters and checkpoints are saved in your Google Drive.</small></span><input aria-label="Allow reviewed text to train Mistral" type="checkbox" checked={enabled} disabled={!canManage || busy} onChange={event => { setEnabled(event.target.checked); if (!event.target.checked) { setAutoQueue(false); setAutoActivate(false); } }} /></label>
        <label className="studio-setting"><span><strong>Queue training automatically</strong><small>While Colab is connected: at least 10 new examples and 24 hours between datasets. Minimum readiness still applies.</small></span><input aria-label="Queue training automatically" type="checkbox" checked={autoQueue} disabled={!canManage || !enabled || busy} onChange={event => setAutoQueue(event.target.checked)} /></label>
        <label className="studio-setting"><span><strong>Use passing candidates automatically</strong><small>Only after server evaluation passes and the configured inference server has the candidate. Leave off to choose each model yourself.</small></span><input aria-label="Use passing candidates automatically" type="checkbox" checked={autoActivate} disabled={!canManage || !enabled || busy} onChange={event => setAutoActivate(event.target.checked)} /></label>
        {canManage ? <Button variant="primary" disabled={busy || !changed} onClick={() => action('settings', '/settings', 'PUT', { enabled, auto_queue: autoQueue, auto_activate: autoActivate, version: settings.version }, enabled ? 'Language-model training preferences saved.' : 'Training stopped, worker access revoked and default model restored.')}>Save training consent</Button> : <p className="studio-muted-note">An administrator manages fine-tuning consent and model selection.</p>}
        <p className="studio-muted-note">Turning consent off cancels pending jobs and restores the default model. It revokes app access; remove existing artifacts from your own Colab/Drive separately.</p>
      </div></section>
      <section className="studio-panel"><div className="studio-panel-heading"><div><h3>Ready to learn?</h3><p>Distinct campaign briefs, reviewed at 4/5 or better.</p></div><Icon name="book" /></div><div className="studio-panel-body">
        <div className="studio-readiness">{[['Training examples', readiness.training, readiness.minimum_training], ['Held-out examples', readiness.validation, readiness.minimum_validation]].map(([label, value, target]) => <div key={label}><span>{label}<strong>{value} <small>/ {target}</small></strong></span><progress value={Math.min(value, target)} max={target} aria-label={label} /></div>)}</div>
        <p className="studio-muted-note">{readiness.excluded} excluded examples. Stable campaign groups keep the same brief out of both training and evaluation. Six additional offer and grounding checks run on every candidate.</p>
        <div className="studio-panel-actions">{canManage && <Button variant="primary" icon={pending === 'queue' ? 'loader' : 'refresh'} disabled={busy || !settings.enabled || !readiness.ready || openJob} onClick={() => action('queue', '/jobs', 'POST', {}, 'Job queued. A connected Colab worker will pick it up.')}>Queue QLoRA training</Button>}<Button icon="refresh" disabled={busy} onClick={() => intelligence.refresh()}>Refresh training status</Button></div>
        <div className="studio-model-label"><small>Model used for this workspace</small><code>{data.selected_model}</code></div>
        {canManage && settings.active_job_id && <Button disabled={busy} onClick={() => setConfirm({ title: 'Restore the default model?', detail: 'New drafts will use the configured default. Saved drafts and trained adapters are kept.', path: '/active-model', method: 'PUT', body: { job_id: null, version: settings.version }, message: 'Configured default model restored.' })}>Restore default model</Button>}
      </div></section>
    </div>
    <section className="studio-panel"><div className="studio-panel-heading"><div><h3>Connect your Colab session</h3><p>A public HTTPS app/API address is required. Localhost is reachable only from your computer.</p></div><Icon name="plug" /></div><div className="studio-panel-body">
      <ol className="studio-colab-steps"><li>Download the setup kit and open its notebook in a GPU Colab runtime.</li><li>Enter your public app/API address and the temporary worker token in the notebook’s hidden prompt.</li><li>Run the worker cell. Keep the session running and your app’s inference connection pointed to that same Colab runtime.</li></ol>
      <div className="studio-panel-actions"><a className="button" href="/downloads/colab-ft-worker.zip" download><Icon name="download" size={16} />Download Colab setup kit</a>{canManage && <Button icon="plug" disabled={busy || !settings.enabled || activeWorkers.length >= 3} onClick={() => action('connect', '/workers', 'POST', {}, 'Temporary Colab credential created. Copy it before closing the dialog.')}>Create Colab worker token</Button>}</div>
      <p className="studio-muted-note">Tokens expire after 8 hours. AI generation pauses during training on the shared GPU; manual drafting remains available. Colab sessions can disconnect and are not a permanent training service.</p>
      {!!activeWorkers.length && <div className="studio-worker-list">{activeWorkers.map(worker => <div key={worker.id}><span><strong>Colab · {worker.id.slice(0, 8)}</strong><small>Last contact: {worker.last_seen_at ? dateLabel(worker.last_seen_at) : 'Never'} · Expires {dateLabel(worker.expires_at)}</small></span>{canManage && <Button disabled={busy} onClick={() => setConfirm({ title: 'Revoke this Colab connection?', detail: 'The worker will lose app access and its running job will be cancelled.', path: `/workers/${worker.id}`, method: 'DELETE', message: 'Colab access revoked.' })}>Revoke connection</Button>}</div>)}</div>}
    </div></section>
    <section className="studio-panel"><div className="studio-panel-heading"><div><h3>QLoRA jobs and evaluation</h3><p>Grounding and safety must pass every case. Overall quality must reach 80% and match or beat the baseline.</p></div><Badge>{jobs.length} jobs</Badge></div>
      {jobs.length ? <div className="table-scroll"><table className="data-table studio-table"><thead><tr><th>Job</th><th>Progress</th><th>Examples</th><th>Evaluation</th>{canManage && <th>Action</th>}</tr></thead><tbody>{jobs.map(job => <tr key={job.id}><td><strong>{job.id.slice(0, 8)}</strong><small>{dateLabel(job.created_at)}</small>{settings.active_job_id === job.id && <Badge variant="success">In use</Badge>}</td><td><Badge variant={job.status === 'validated' ? 'success' : ['rejected', 'failed'].includes(job.status) ? 'warning' : 'neutral'}>{job.status}</Badge><small>{job.stage}</small>{job.error && <small role="status">{job.error}</small>}{job.status === 'running' && job.lease_expires_at && new Date(job.lease_expires_at) < new Date() && <small>Worker disconnected. Reconnect Colab to retry.</small>}</td><td>{job.example_count}</td><td>{job.evaluation ? <><strong>{percent(job.evaluation.candidate.pass_rate)} · baseline {percent(job.evaluation.baseline.pass_rate)}</strong><small>Grounding {percent(job.evaluation.candidate.grounding_rate)} · Safety {percent(job.evaluation.candidate.safety_rate)}</small></> : <small>Awaiting raw model outputs</small>}</td>{canManage && <td>{['queued', 'running'].includes(job.status) && <Button disabled={busy} onClick={() => setConfirm({ title: 'Cancel this training job?', detail: 'The worker will stop when it checks its lease. The active model is kept.', path: `/jobs/${job.id}`, method: 'DELETE', message: 'Training job cancelled.' })}>Cancel job</Button>}{['failed', 'cancelled'].includes(job.status) && <Button disabled={busy || !settings.enabled || openJob} onClick={() => action('retry', `/jobs/${job.id}/retry`, 'POST', {}, 'Job queued for retry.')}>Retry job</Button>}{job.status === 'validated' && settings.active_job_id !== job.id && <Button disabled={busy || !settings.enabled} onClick={() => setConfirm({ title: 'Use this language model?', detail: 'New drafts in this workspace will use this evaluated adapter. Its Colab inference server must remain reachable.', path: '/active-model', method: 'PUT', body: { job_id: job.id, version: settings.version }, message: 'Evaluated language model selected for this workspace.' })}>Use language model</Button>}</td>}</tr>)}</tbody></table></div> : <EmptyState icon="refresh" title="Your first writing-model update starts here." description="Build a set of real, reviewed examples, connect Colab, then queue training. Sample campaigns cannot satisfy readiness." />}
    </section>
    <p className="studio-muted-note">Grounding is pattern-based: numeric, code, scarcity and deadline claims are checked against tenant knowledge. Qualitative claims require human review before approval. These evaluation scores do not establish campaign improvement.</p>
    {canManage && connection && <Modal title="Your temporary Colab token" description="Copy once into the notebook’s hidden token prompt. It expires in 8 hours; never paste it into notebook outputs or commit it." onClose={() => setConnection(null)}><Field label="Colab worker token"><input type="password" autoComplete="off" readOnly value={connection.token} onFocus={event => event.target.select()} /></Field><div className="modal-actions"><Button onClick={() => setConnection(null)}>Close</Button><Button variant="primary" icon="copy" onClick={async () => { try { await navigator.clipboard.writeText(connection.token); notify('Worker token copied.'); } catch { notify('Select and copy the token from the field.'); } }}>Copy worker token</Button></div></Modal>}
    {canManage && confirm && <Modal title={confirm.title} description={confirm.detail} onClose={() => { if (!busy) setConfirm(null); }}>{error && <p className="auth-error" role="alert">{error}</p>}<div className="modal-actions"><Button disabled={busy} onClick={() => setConfirm(null)}>Keep current settings</Button><Button variant="primary" disabled={busy} onClick={() => action('confirm', confirm.path, confirm.method, confirm.body, confirm.message)}>Confirm</Button></div></Modal>}
  </div>;
}
