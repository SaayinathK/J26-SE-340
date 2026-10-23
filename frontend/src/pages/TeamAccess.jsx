import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, EmptyState, Field, Icon, Modal, PageHeading } from '../components/ui.jsx';
import { api } from '../lib/api-client.js';
import { useAuth } from '../hooks/useAuth.jsx';
import AccessDenied from '../components/AccessDenied.jsx';
import {assertPermission} from '../lib/access.js';
const roles = { agency_admin: 'Administrator', marketer: 'Marketer', viewer: 'Viewer' };

export default function TeamAccess(props){
  const auth=useAuth();
  return auth.can('team:manage')?<TeamAccessContent {...props}/>:<AccessDenied/>;
}
function TeamAccessContent({ notify }) {
  const { user,can } = useAuth();
  const [data, setData] = useState({ members: [], invitations: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modal, setModal] = useState(false);
  const [link, setLink] = useState('');
  const [invitation,setInvitation] = useState(null);
  const [copied,setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const close = useCallback(() => { setModal(false); setLink(''); setInvitation(null); setCopied(false); }, []);
  const refresh = useCallback(async () => {
    try { setData(await api('/team')); setError(''); } catch (failure) { setError(failure.message); } finally { setLoading(false); }
  }, []);
  useEffect(() => { refresh(); const timer = setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, 15000); return () => clearInterval(timer); }, [refresh]);
  async function update(id, body) {
    setBusy(true);
    try { assertPermission(can,'team:manage');await api(`/team/${id}`, { method: 'PATCH', body }); await refresh(); notify('Member access updated. Changes are enforced on their next request.'); }
    catch (failure) { setError(failure.message); } finally { setBusy(false); }
  }
  async function createInvitation(values) {
    setBusy(true); setError(''); setCopied(false);
    try { assertPermission(can,'team:manage');const result = await api('/team/invitations', { method:'POST',body:values,signal:AbortSignal.timeout(40000) }); setLink(result.invitation_url); setInvitation(result); setModal(true); await refresh(); }
    catch (failure) { setError(failure.message); } finally { setBusy(false); }
  }
  function invite(event) {event.preventDefault();const values=new FormData(event.currentTarget);void createInvitation({email:values.get('email'),role:values.get('role')});}
  async function revoke(invitation) {
    setBusy(true);setError('');
    try {assertPermission(can,'team:manage');await api('/team/invitations/'+invitation.id,{method:'DELETE',body:{}});await refresh();notify('Invitation revoked. Its link no longer works.');}
    catch(failure){setError(failure.message);}finally{setBusy(false);}
  }
  async function copyInvitation() {
    try {
      try {await navigator.clipboard.writeText(link);} catch {
        const input=document.getElementById('invitation-link');input.focus();input.select();
        if(!document.execCommand('copy')) throw new Error('Select the invitation link and press Ctrl+C or Command+C to copy it.');
      }
      setCopied(true);notify('Invitation link copied.');
    } catch(failure){setError(failure.message);}
  }
  return <><PageHeading eyebrow="THE RIGHT PEOPLE. THE RIGHT ACCESS." title="Great work is a team effort." description="Live workspace membership, roles, and secure invitations."><Button icon="refresh" onClick={refresh} disabled={busy}>Refresh</Button><Button variant="primary" icon="plus" disabled={busy} onClick={() => {setError('');setModal(true);}}>Invite member</Button></PageHeading>
    {error && <div role="alert" className="auth-error"><Icon name="alert" />{error}</div>}
    <section className="card"><div className="card-heading"><div><h2>Workspace members <span className="count-badge">{data.members.length}</span></h2><p>Changes are saved to the database. This list refreshes every 15 seconds.</p></div><Badge variant="teal" dot>Live account data</Badge></div>{loading ? <div className="auth-loading-inline"><Icon name="loader" />Loading workspace members…</div> : <div className="table-scroll"><table className="data-table"><thead><tr><th>Team member</th><th>Role</th><th>Status</th><th>Access</th></tr></thead><tbody>{data.members.map(member => <tr key={member.id}><td><div className="member-cell"><span className="avatar member-avatar">{(member.name || member.email).slice(0, 2).toUpperCase()}</span><span><strong>{member.name || member.email.split('@')[0]}{member.id === user.user_id && <small className="you-label">You</small>}</strong><small>{member.email}</small></span></div></td><td><select className="small-select" aria-label={`Role for ${member.name || member.email}`} value={member.role} disabled={busy || member.id === user.user_id || !member.is_active} onChange={event => update(member.id, { role: event.target.value })}>{Object.entries(roles).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></td><td><Badge variant={member.is_active ? 'success' : 'neutral'} dot>{member.is_active ? 'Active' : 'Deactivated'}</Badge></td><td>{member.id === user.user_id ? <span className="muted">Current account</span> : <Button disabled={busy} onClick={() => update(member.id, { is_active: !member.is_active })}>{member.is_active ? 'Deactivate' : 'Reactivate'}</Button>}</td></tr>)}</tbody></table></div>}</section>
    <section className="card pending-invitations"><div className="card-heading"><div><h2>Pending invitations</h2><p>Single-use invitations expire after seven days.</p></div><Badge>{data.invitations.length}</Badge></div>{data.invitations.length ? <div className="table-scroll"><table className="data-table"><thead><tr><th>Email</th><th>Role</th><th>Status</th><th>Email</th><th>Expires</th><th>Actions</th></tr></thead><tbody>{data.invitations.map(invitation => <tr key={invitation.id}><td>{invitation.email}</td><td>{roles[invitation.role]}</td><td><Badge variant={invitation.status === 'Expired' ? 'warning' : 'neutral'}>{invitation.status || 'Pending'}</Badge></td><td>{invitation.delivery_status === 'sent' ? 'Sent' : invitation.delivery_status === 'failed' ? 'Failed' : 'Not sent'}</td><td>{new Date(invitation.expires_at).toLocaleDateString()}</td><td><Button disabled={busy} onClick={() => createInvitation({email:invitation.email,role:invitation.role})}>Send new invitation</Button><Button disabled={busy} onClick={() => revoke(invitation)}>Revoke</Button></td></tr>)}</tbody></table></div> : <EmptyState icon="users" title="Everyone’s accounted for" description="New team invitations will appear here until they are accepted or expire." />}</section>
    {modal && <Modal title={link ? invitation?.delivery?.status === 'sent' ? 'Invitation email sent' : 'Your invitation link is ready' : 'Invite a new perspective'} description={link ? invitation?.delivery?.status === 'sent' ? 'We emailed the recipient. You can also share this single-use link.' : invitation?.delivery?.message || 'Share this single-use link with the intended recipient.' : 'Choose the role this person needs in your workspace.'} onClose={() => {if(!busy)close();}}>{error && <p className="auth-error" role="alert">{error}</p>}{link ? <div className="form-stack"><div className="inline-note"><Icon name="users" size={18}/><span><strong>{invitation?.email}</strong><br/>{invitation?.workspace_name} / {roles[invitation?.role]}<br/>Expires {invitation && new Date(invitation.expires_at).toLocaleString()}</span></div><Field label="Single-use invitation link"><input id="invitation-link" readOnly value={link} onFocus={event => event.target.select()} /></Field><Button variant="primary" icon={copied ? 'check' : 'copy'} onClick={copyInvitation}>{copied ? 'Copied' : 'Copy invitation'}</Button><a className="button secondary" href={link} target="_blank" rel="noopener noreferrer">Open invitation<Icon name="external" size={16}/></a><small className="muted">Only the invited email can join. The link can be used once. Replacing or revoking it invalidates the previous link.</small></div> : <form className="form-stack" onSubmit={invite}><Field label="Email address"><input type="email" name="email" required maxLength={254} autoFocus /></Field><Field label="Workspace role"><select name="role"><option value="marketer">Marketer</option><option value="viewer">Viewer</option><option value="agency_admin">Administrator</option></select></Field>{!data.email_delivery_configured && <div className="inline-note"><Icon name="mail" size={17}/><span>Email delivery is not connected yet. You can still create and share an invitation link.</span></div>}<div className="inline-note"><Icon name="shield" size={17} /><span>The invitation assigns this role on the server. Recipients cannot choose another workspace or role.</span></div><Button variant="primary" icon={busy ? 'loader' : 'plus'} disabled={busy}>{busy ? 'Sending invitation...' : data.email_delivery_configured ? 'Send invitation' : 'Create invitation link'}</Button></form>}</Modal>}
  </>;
}
