import { useCallback, useRef, useState } from 'react';
import { Badge, Button, EmptyState, Field, Icon, Modal, PageHeading } from '../components/ui.jsx';
import { useServiceStatus } from '../hooks/useServiceStatus.js';
import { useServices } from '../hooks/useServices.jsx';
import { downloadFile, formatTime } from '../lib/records.js';

export function Knowledge({ data, mutate, notify, canManage }) {
  const [modal, setModal] = useState(null);
  const [search, setSearch] = useState('');
  const [importing, setImporting] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef(null);
  const close = useCallback(() => setModal(null), []);
  const documents = data.documents.filter(d => `${d.name} ${d.type}`.toLowerCase().includes(search.toLowerCase()));
  async function addDocument(name, text, type) {
    setPending(true); setError('');
    try { await mutate('/platform/knowledge', 'POST', { name, text, type }); notify('Knowledge source saved to your workspace.'); setModal(null); }
    catch (failure) { setError(failure.message); } finally { setPending(false); }
  }
  async function removeDocument(id) {
    setPending(true); setError('');
    try { await mutate('/platform/knowledge/' + id, 'DELETE', {}); notify('Knowledge source removed.'); close(); }
    catch (failure) { setError(failure.message); } finally { setPending(false); }
  }
  async function upload(event) {
    const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
    if (!/\.(txt|md|csv)$/i.test(file.name)) { notify('Choose a text, Markdown, or CSV file.'); return; }
    if (file.size > 200 * 1024) { notify('Choose a file no larger than 200 KB.'); return; }
    setImporting(true);
    try { const text = await file.text(); if (!text.trim()) { notify('This file is empty. Add a source with some content.'); return; } await addDocument(file.name, text, 'Uploaded text'); } catch { notify('The file could not be read. Please try again.'); } finally { setImporting(false); }
  }
  return <><PageHeading eyebrow="GREAT EMAILS START WITH GOOD CONTEXT" title="Your business, understood." description="Give your Email Agent the knowledge that makes your brand yours."><Button icon={importing ? 'loader' : 'upload'} disabled={importing || pending || !canManage} onClick={() => fileRef.current?.click()}>{importing ? 'Reading file…' : 'Upload text'}</Button><Button variant="primary" icon="plus" onClick={() => setModal({ type: 'add' })} disabled={pending || !canManage}>Add knowledge</Button><input className="sr-only" type="file" ref={fileRef} accept=".txt,.md,.csv" onChange={upload} aria-label="Upload knowledge text file" /></PageHeading>{error && !modal && <div className="auth-error" role="alert">{error}</div>}<div className="knowledge-stats"><div className="card mini-stat"><span className="metric-icon"><Icon name="book" /></span><div><strong>{data.documents.length}</strong><span>Knowledge sources</span></div></div><div className="card mini-stat"><span className="metric-icon"><Icon name="lock" /></span><div><strong>Workspace scoped</strong><span>Stored with tenant isolation</span></div></div><div className="card mini-stat"><span className="metric-icon"><Icon name="sparkles" /></span><div><strong>Ready for your next idea</strong><span>Used for AI business context</span></div></div></div><section className="card"><div className="card-heading"><div><h2>Knowledge library</h2><p>Brand details, product information, and audience insights.</p></div><div className="input-search"><Icon name="search" size={16} /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search knowledge..." aria-label="Search knowledge sources" /></div></div>{documents.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>Source</th><th>Type</th><th>Added</th><th>Availability</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{documents.map(d => <tr key={d.id}><td><button className="campaign-name" onClick={() => setModal({ type: 'view', document: d })}><span className="campaign-icon teal"><Icon name="file" size={18} /></span><span><strong>{d.name}</strong><small>{d.size}</small></span></button></td><td>{d.type}</td><td className="muted">{formatTime(d.added)}</td><td><Badge variant="success" dot>Available</Badge></td><td><button className="icon-button" aria-label={`Delete ${d.name}`} disabled={!canManage} onClick={() => setModal({ type: 'delete', document: d })}><Icon name="trash" size={16} /></button></td></tr>)}</tbody></table></div> : <EmptyState icon="book" title={search ? 'No matching sources' : 'Make your agent feel at home'} description={search ? 'Try a different name or source type.' : 'Add your brand story or upload a text file to give your emails more context.'} />}</section><div className="inline-note knowledge-note"><Icon name="shield" size={19} /><span>Sources are saved in the workspace database and supplied as text context to AI generation. Text uploads support .txt, .md, and .csv up to 200 KB. Vector search and CRM sync can be connected later.</span></div>
    {modal?.type === 'add' && <Modal title="Give your agent a little context" description="Add business facts for your email sequences." onClose={close}>{error && <p className="auth-error" role="alert">{error}</p>}<form className="form-stack" onSubmit={e => { e.preventDefault(); const form = new FormData(e.currentTarget); const name = form.get('name').trim(); const text = form.get('text').trim(); if (!name || !text) return; addDocument(name, text, form.get('type')); }}><Field label="Source name"><input name="name" placeholder="e.g. Our brand story" maxLength={100} required autoFocus /></Field><Field label="Source type"><select name="type"><option>Brand guide</option><option>Product knowledge</option><option>Audience</option><option>Business context</option></select></Field><Field label="What should your agent know?"><textarea name="text" rows={7} maxLength={20000} placeholder="Tell us about your brand, services, or customers..." required /></Field><div className="modal-actions"><Button type="button" onClick={close}>Cancel</Button><Button variant="primary" disabled={pending} icon={pending ? 'loader' : 'plus'}>Add source</Button></div></form></Modal>}
    {modal?.type === 'view' && <Modal title={modal.document.name} description={`${modal.document.type} · ${modal.document.size}`} onClose={close}><pre className="document-content">{modal.document.text}</pre><div className="modal-actions"><Button icon="download" onClick={() => downloadFile(`${modal.document.name.replace(/[^a-zA-Z0-9 _-]/g, '') || 'knowledge'}.txt`, modal.document.text, 'text/plain')}>Download source</Button></div></Modal>}
    {modal?.type === 'delete' && <Modal title="Remove this knowledge source?" description={modal.document.name} onClose={close}>{error && <p className="auth-error" role="alert">{error}</p>}<p className="muted">This removes the source from this workspace. Your saved sequences will stay available.</p><div className="modal-actions"><Button onClick={close}>Keep source</Button><Button variant="danger-button" icon="trash" disabled={pending} onClick={() => removeDocument(modal.document.id)}>Remove source</Button></div></Modal>}
  </>;
}

export function Monitoring({ data, workspace, notify }) {
  const { status, error, refresh } = useServiceStatus();
  const serviceDirectory = useServices();
  return <><PageHeading eyebrow="CLARITY AT EVERY LAYER" title="Platform monitoring" description="Current service checks and recorded workspace changes."><Button icon="refresh" onClick={() => { void refresh(); void serviceDirectory.refresh(); }}>Check services</Button><Button icon="download" onClick={() => { downloadFile('workspace-activity.json', JSON.stringify({ workspace: workspace.id, exported_at: new Date().toISOString(), activities: data.activities }, null, 2)); notify('Activity exported.'); }}>Export activity</Button></PageHeading>
    {error && <div className="auth-error" role="alert">{error}</div>}
    <div className="monitoring-grid">{[
      ['activity', 'Gateway', status ? 'Connected' : 'Checking', 'Authenticated requests are reaching the gateway.'],
      ['building', 'PostgreSQL', status?.database.status || 'Checking', status ? 'Last database check: ' + status.database.latency_ms + ' ms' : 'Waiting for a database health check.'],
      ...serviceDirectory.services.map(service => [service.icon, service.name, serviceDirectory.error ? 'Status unavailable' : service.available ? 'Available' : 'Not available', service.available ? 'The service page is available in your workspace.' : 'This service page is not available. Check again shortly.']),
      ['send', 'Email delivery', 'Not connected', 'Connect a delivery provider to enable sending and engagement metrics.'],
      ['lock', 'Tenant isolation', status ? 'Enforced' : 'Checking', 'Server permissions and PostgreSQL row policies scope workspace data.'],
      ['shield', 'Account permissions', 'Enforced', 'Every service verifies its own current account roles and sessions.'],
    ].map(([icon, title, state, description]) => <section className="card monitoring-card" key={title}><div><span className="metric-icon"><Icon name={icon} /></span><Badge variant={['Available', 'Connected', 'connected', 'ready', 'Enforced', 'Enforced on save'].includes(state) ? 'success' : 'neutral'}>{state}</Badge></div><h2>{title}</h2><p>{description}</p></section>)}</div>
    <p className="muted">Service checks refresh every 15 seconds. Last check: {formatTime(status?.checked_at)}</p>
    <section className="card"><div className="card-heading"><div><h2>Workspace activity</h2><p>Database records for {workspace.name}. Refreshes every 5 seconds.</p></div></div>{data.activities.length ? <div className="monitoring-activity">{data.activities.map(item => <div className="activity-item" key={item.id}><span className="activity-icon"><Icon name={item.icon} /></span><div><strong>{item.title}</strong><p>{item.description}</p></div><small>{formatTime(item.created_at)}</small></div>)}</div> : <EmptyState icon="activity" title="No activity yet" description="Campaign, knowledge, and sequence changes will appear here." />}</section></>;
}
