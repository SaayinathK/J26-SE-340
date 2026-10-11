import { useState } from 'react';
import { Badge, Button, Field, Icon, PageHeading } from '../components/ui.jsx';
import GoogleSignIn from '../components/GoogleSignIn.jsx';
import { useAuth } from '../hooks/useAuth.jsx';
import { api } from '../lib/api-client.js';

export default function AccountSettings({ theme, setTheme, notify }) {
  const auth = useAuth();
  const [name, setName] = useState(auth.user.name);
  const [workspaceName, setWorkspaceName] = useState(auth.workspace.name);
  const [domain, setDomain] = useState(auth.workspace.domain);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function save(event, workspace = false) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      await api(workspace ? '/tenant/profile' : '/auth/profile', { method: 'PATCH', body: workspace ? { name: workspaceName.trim(), domain: domain.trim() } : { name: name.trim() } });
      await auth.refresh(); notify(workspace ? 'Workspace profile saved to the database.' : 'Your account profile has been updated.');
    } catch (failure) { setError(failure.message); } finally { setBusy(false); }
  }
  async function linkGoogle(credential) {
    await api('/auth/google', { method: 'POST', body: { credential, intent: 'link' } });
    await auth.refresh(); notify('Google is now linked to your account.');
  }
  return <><PageHeading eyebrow="A WORKSPACE THAT FEELS LIKE YOURS" title="Make yourself at home." description="Your real account, security, and workspace preferences." />{error && <div className="auth-error" role="alert"><Icon name="alert" />{error}</div>}<div className="settings-grid">
    <div className="settings-section-label"><h2>Your account</h2><p>Your profile is loaded from the account service.</p></div><section className="card settings-card"><form className="form-stack" onSubmit={save}><Field label="Full name"><input value={name} onChange={event => setName(event.target.value)} minLength={2} maxLength={80} required /></Field><Field label="Email address"><input type="email" value={auth.user.email} readOnly /></Field><div className="settings-detail"><span>Workspace role</span><Badge variant="teal">{{ agency_admin: 'Administrator', marketer: 'Marketer', viewer: 'Viewer' }[auth.user.role]}</Badge></div><div className="settings-save"><Button variant="primary" icon={busy ? 'loader' : 'check'} disabled={busy}>Save profile</Button></div></form></section>
    <div className="settings-section-label"><h2>Workspace profile</h2><p>{auth.can('workspace:manage') ? 'Administrators manage these shared details.' : 'Your administrator manages the workspace profile.'}</p></div><section className="card settings-card"><form className="form-stack" onSubmit={event => save(event, true)}><Field label="Workspace name"><input value={workspaceName} onChange={event => setWorkspaceName(event.target.value)} required minLength={2} maxLength={80} readOnly={!auth.can('workspace:manage')} /></Field><Field label="Business domain" hint="A profile value only. Domain verification and email sending remain separate."><input value={domain} onChange={event => setDomain(event.target.value)} placeholder="company.com" maxLength={253} readOnly={!auth.can('workspace:manage')} /></Field>{auth.can('workspace:manage') && <div className="settings-save"><Button variant="primary" icon={busy ? 'loader' : 'check'} disabled={busy}>Save workspace</Button></div>}</form></section>
    <div className="settings-section-label"><h2>Connected sign-in</h2><p>Link Google only while signed in to your existing account.</p></div><section className="card settings-card"><div className="connected-signin"><Icon name="shield" size={24} /><div><h3>Google account</h3><p>Use the Google account with the same email as your Ciftron account.</p></div><Badge variant={auth.user.google_linked ? 'success' : 'neutral'}>{auth.user.google_linked ? 'Connected' : 'Not linked'}</Badge></div>{!auth.user.google_linked && <GoogleSignIn intent="link" onCredential={linkGoogle} onError={setError} theme={theme} />}<div className="inline-note security-note"><Icon name="lock" size={16} /><span>Roles are checked against the database on every request. Signing out revokes this session.</span></div></section>
    <div className="settings-section-label"><h2>Appearance</h2><p>Same personality. A different perspective.</p></div><section className="card settings-card"><h3>Choose your theme</h3><p className="muted form-hint">Your preference is remembered on this browser.</p><div className="theme-choices">{['light', 'dark'].map(value => <button key={value} aria-pressed={theme === value} onClick={() => setTheme(value)} className={`theme-choice ${theme === value ? 'selected' : ''}`}><div className={`theme-preview ${value}`}><i /><div><span /><b /><b /><em /></div></div><span><Icon name={value === 'light' ? 'sun' : 'moon'} size={16} />{value === 'light' ? 'Light' : 'Dark'} theme{theme === value && <Icon name="success" size={17} />}</span></button>)}</div></section>
  </div></>;
}
