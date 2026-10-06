import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, EmptyState, Field, Icon, Modal, PageHeading } from '../components/ui.jsx';
import { api } from '../lib/api-client.js';
import { useAuth } from '../hooks/useAuth.jsx';
const roles = { agency_admin: 'Administrator', marketer: 'Marketer', viewer: 'Viewer' };

export default function TeamAccess({ notify }) {
  const { user } = useAuth();
  const [data, setData] = useState({ members: [], invitations: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modal, setModal] = useState(false);
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const close = useCallback(() => { setModal(false); setLink(''); }, []);
  const refresh = useCallback(async () => {
    try { setData(await api('/team')); setError(''); } catch (failure) { setError(failure.message); } finally { setLoading(false); }
  }, []);
  useEffect(() => { refresh(); const timer = setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, 15000); return () => clearInterval(timer); }, [refresh]);
  async function update(id, body) {
    setBusy(true);
    try { await api(`/team/${id}`, { method: 'PATCH', body }); await refresh(); notify('Member access updated. Changes are enforced on their next request.'); }
    catch (failure) { setError(failure.message); } finally { setBusy(false); }
  }
  async function invite(event) {
    event.preventDefault(); const values = new FormData(event.currentTarget); setBusy(true); setError('');
    try { const result = await api('/team/invitations', { method: 'POST', body: { email: values.get('email'), role: values.get('role') } }); setLink(result.invitation_url); await refresh(); }
    catch (failure) { setError(failure.message); } finally { setBusy(false); }
  }
  return <><PageHeading eyebrow="THE RIGHT PEOPLE. THE RIGHT ACCESS." title="Great work is a team effort." description="Live workspace membership, roles, and secure invitations."><Button icon="refresh" onClick={refresh} disabled={busy}>Refresh</Button><Button variant="primary" icon="plus" onClick={() => setModal(true)}>Invite member</Button></PageHeading>
    {error && <div role="alert" className="auth-error"><Icon name="alert" />{error}</div>}
    <section className="card"><div className="card-heading"><div><h2>Workspace members <span className="count-badge">{data.members.length}</span></h2><p>Changes are saved to the database. This list refreshes every 15 seconds.</p></div><Badge variant="teal" dot>Live account data</Badge></div>{loading ? <div className="auth-loading-inline"><Icon name="loader" />Loading workspace members…</div> : <div className="table-scroll"><table className="data-table"><thead><tr><th>Team member</th><th>Role</th><th>Status</th><th>Access</th></tr></thead><tbody>{data.members.map(member => <tr key={member.id}><td><div className="member-cell"><span className="avatar member-avatar">{(member.name || member.email).slice(0, 2).toUpperCase()}</span><span><strong>{member.name || member.email.split('@')[0]}{member.id === user.user_id && <small className="you-label">You</small>}</strong><small>{member.email}</small></span></div></td><td><select className="small-select" aria-label={`Role for ${member.name || member.email}`} value={member.role} disabled={busy || member.id === user.user_id || !member.is_active} onChange={event => update(member.id, { role: event.target.value })}>{Object.entries(roles).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></td><td><Badge variant={member.is_active ? 'success' : 'neutral'} dot>{member.is_active ? 'Active' : 'Deactivated'}</Badge></td><td>{member.id === user.user_id ? <span className="muted">Current account</span> : <Button disabled={busy} onClick={() => update(member.id, { is_active: !member.is_active })}>{member.is_active ? 'Deactivate' : 'Reactivate'}</Button>}</td></tr>)}</tbody></table></div>}</section>
    <section className="card pending-invitations"><div className="card-heading"><div><h2>Pending invitations</h2><p>Single-use invitations expire after seven days.</p></div><Badge>{data.invitations.length}</Badge></div>{data.invitations.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>Email</th><th>Role</th><th>Expires</th></tr></thead><tbody>{data.invitations.map(invitation => <tr key={invitation.id}><td>{invitation.email}</td><td>{roles[invitation.role]}</td><td>{new Date(invitation.expires_at).toLocaleDateString()}</td></tr>)}</tbody></table></div> : <EmptyState icon="users" title="Everyone’s accounted for" description="New team invitations will appear here until they are accepted or expire." />}</section>
    {modal && <Modal title={link ? 'Your invitation is ready' : 'Invite a new perspective'} description={link ? 'Share this link with the intended recipient. No email has been sent.' : 'Choose the role this person needs in your workspace.'} onClose={close}>{link ? <div className="form-stack"><Field label="Single-use invitation link"><input readOnly value={link} onFocus={event => event.target.select()} /></Field><Button variant="primary" icon="copy" onClick={async () => { try { await navigator.clipboard.writeText(link); notify('Invitation link copied.'); } catch { notify('Select the link and copy it manually.'); } }}>Copy invitation</Button></div> : <form className="form-stack" onSubmit={invite}><Field label="Email address"><input type="email" name="email" required maxLength={254} autoFocus /></Field><Field label="Workspace role"><select name="role"><option value="marketer">Marketer</option><option value="viewer">Viewer</option><option value="agency_admin">Administrator</option></select></Field><div className="inline-note"><Icon name="shield" size={17} /><span>The invitation assigns this role on the server. Recipients cannot choose another workspace or role.</span></div><Button variant="primary" icon={busy ? 'loader' : 'plus'} disabled={busy}>Create invitation</Button></form>}</Modal>}
  </>;
}
