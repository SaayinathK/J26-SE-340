import { useState } from 'react';
import { Button, Field, Icon, Logo } from '../components/ui.jsx';
import GoogleSignIn from '../components/GoogleSignIn.jsx';
import { useAuth } from '../hooks/useAuth.jsx';

export default function AuthPage({ mode, navigate, theme, setTheme }) {
  const auth = useAuth();
  const registering = mode === 'register';
  const invitation = new URLSearchParams(location.hash.split('?')[1] || '').get('invite') || '';
  const linkingAfterLogin = !registering && new URLSearchParams(location.hash.split('?')[1] || '').get('link_google') === '1';
  const [values, setValues] = useState({ name: '', email: '', password: '', confirm: '', workspace: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [googleIssue, setGoogleIssue] = useState(linkingAfterLogin ? 'GOOGLE_LINK_REQUIRED' : '');
  const change = key => event => { setValues(current => ({ ...current, [key]: event.target.value })); setError(''); };
  const requirements = [
    ['At least 12 characters', values.password.length >= 12],
    ['Uppercase and lowercase letters', /[A-Z]/.test(values.password) && /[a-z]/.test(values.password)],
    ['At least one number', /\d/.test(values.password)],
  ];
  function googleDetails() {
    if (registering && !invitation && values.workspace.trim().length < 2) throw new Error('Enter your workspace name before continuing with Google.');
    return { ...(registering ? { name: values.name.trim() || undefined, workspace_name: values.workspace.trim(), invitation_token: invitation || undefined } : {}) };
  }
  async function googleLogin(credential) {
    const details = googleDetails(); setError(''); setGoogleIssue(''); setPending(true);
    try { await auth.googleLogin({ credential, intent: registering ? 'register' : 'login', ...details }); navigate('overview'); }
    catch (failure) { setGoogleIssue(['GOOGLE_ACCOUNT_NOT_LINKED', 'GOOGLE_LINK_REQUIRED', 'GOOGLE_ACCOUNT_ALREADY_REGISTERED'].includes(failure.code) ? failure.code : ''); throw failure; }
    finally { setPending(false); }
  }
  async function submit(event) {
    event.preventDefault(); setError('');
    if (registering && values.password !== values.confirm) { setError('Your passwords do not match.'); return; }
    if (registering && new TextEncoder().encode(values.password).length > 72) { setError('Use a password of 72 bytes or fewer.'); return; }
    setPending(true);
    try {
      if (registering) await auth.register({ name: values.name.trim(), email: values.email.trim(), password: values.password, workspace_name: values.workspace.trim(), invitation_token: invitation || undefined });
      else await auth.login({ email: values.email.trim(), password: values.password });
      navigate(linkingAfterLogin ? 'settings' : 'overview');
    } catch (failure) { setError(failure.message); }
    finally { setPending(false); }
  }
  return <div className={`signin-layout ${registering ? 'registration-layout' : ''}`}>
    <section className="signin-story"><div><Logo /></div><div className="signin-story-copy"><div className="banner-eyebrow"><span className="tiny-spark">✳</span> A LITTLE INTELLIGENCE. A LOT OF POSSIBILITY.</div><h1>{registering ? <>Your next big idea.<br /><span>A workspace to grow.</span></> : <>More than messages.<br /><span>Meaningful connections.</span></>}</h1><p>Your business knowledge. Your brand’s voice. One thoughtful workspace for everything that comes next.</p><div className="signin-feature"><Icon name="sparkles" size={20} /><span>Business-aware email sequences</span></div><div className="signin-feature"><Icon name="shield" size={20} /><span>Secure sign-in and role-based access</span></div><div className="signin-feature"><Icon name="users" size={20} /><span>The right people. The right permissions.</span></div><div className="auth-role-preview"><span><Icon name="shield" size={14} />Administrator</span><span><Icon name="sparkles" size={14} />Marketer</span><span><Icon name="eye" size={14} />Viewer</span></div></div><small>© 2026 Ciftron · SaaS Platform & Email Agent</small><div className="signin-decoration" aria-hidden="true">✳</div></section>
    <section className="signin-panel"><button className="icon-button signin-theme" aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`} onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}><Icon name={theme === 'light' ? 'moon' : 'sun'} /></button><div className="signin-form"><div className="eyebrow">{invitation && registering ? 'YOUR TEAM IS WAITING FOR YOU' : 'YOUR NEXT CHAPTER STARTS HERE'}</div><h2>{registering ? invitation ? 'Join your workspace.' : 'Create your account.' : 'Welcome back.'}</h2><p>{registering ? invitation ? 'Use the email address that received your invitation.' : 'Bring your business and your next idea together.' : 'Sign in to your workspace and pick up where you left off.'}</p>
    {registering && <div className="registration-note"><Icon name={invitation ? 'users' : 'building'} size={17} /><span>{invitation ? 'Your workspace and role are assigned by your invitation.' : 'You will be the administrator of your new workspace. Invite marketers and viewers after signing in.'}</span></div>}
    {(error || auth.error) && <div className="auth-error" role="alert"><Icon name="alert" size={18} /><span>{error || auth.error}</span></div>}
    {googleIssue && <div className="google-account-help" role="note">
      {googleIssue === 'GOOGLE_ACCOUNT_NOT_LINKED' && <><strong>Choose how to continue</strong><p>New here? Create your workspace with Google. If you already have a Ciftron account, sign in with your password first and link Google in Settings.</p><div className="google-account-actions"><Button type="button" icon="plus" onClick={() => navigate(`register${invitation ? `?invite=${encodeURIComponent(invitation)}` : ''}`)}>Create account with Google</Button><Button type="button" onClick={() => navigate(`sign-in?link_google=1${invitation ? `&invite=${encodeURIComponent(invitation)}` : ''}`)}>I already have an account</Button></div></>}
      {googleIssue === 'GOOGLE_LINK_REQUIRED' && <><strong>Link Google to your existing account</strong><p>Sign in with your current email and password. We will open Settings, where you can connect the Google account with the same email.</p>{registering && <Button type="button" icon="arrow" onClick={() => navigate('sign-in?link_google=1')}>Sign in to link Google</Button>}</>}
      {googleIssue === 'GOOGLE_ACCOUNT_ALREADY_REGISTERED' && <><p>Your Google account is already connected. Continue from the sign-in page.</p><Button type="button" icon="arrow" onClick={() => navigate('sign-in')}>Go to sign in</Button></>}
    </div>}
    <form className="form-stack" onSubmit={submit}>
      {registering && <Field label="Full name"><input name="name" autoComplete="name" placeholder="Your full name" value={values.name} onChange={change('name')} minLength={2} maxLength={80} required disabled={pending} /></Field>}
      {registering && !invitation && <Field label="Workspace name"><input name="organization" autoComplete="organization" placeholder="e.g. Ciftron Agency" value={values.workspace} onChange={change('workspace')} minLength={2} maxLength={80} required disabled={pending} /></Field>}
      <Field label="Work email"><input name="email" type="email" autoComplete="username" placeholder="you@company.com" value={values.email} onChange={change('email')} maxLength={254} required disabled={pending} /></Field>
      <Field label="Password"><div className="password-input"><input name="password" type={showPassword ? 'text' : 'password'} autoComplete={registering ? 'new-password' : 'current-password'} placeholder={registering ? 'Create a strong password' : 'Enter your password'} value={values.password} onChange={change('password')} minLength={registering ? 12 : 1} required disabled={pending} aria-describedby={registering ? 'password-requirements' : undefined} /><button type="button" className="icon-button" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword(value => !value)}><Icon name="eye" size={17} /></button></div></Field>
      {registering && <><ul id="password-requirements" className="password-requirements">{requirements.map(([label, passed]) => <li key={label} className={passed ? 'passed' : ''}><Icon name={passed ? 'success' : 'check'} size={13} />{label}</li>)}</ul><Field label="Confirm password"><input name="confirm_password" type={showPassword ? 'text' : 'password'} autoComplete="new-password" placeholder="Enter your password again" value={values.confirm} onChange={change('confirm')} required disabled={pending} /></Field></>}
      <Button variant="primary" type="submit" icon={pending ? 'loader' : 'arrow'} disabled={pending}>{pending ? registering ? 'Creating your account…' : 'Signing you in…' : registering ? invitation ? 'Join workspace' : 'Create account' : 'Sign in'}</Button>
    </form><div className="signin-divider"><span />OR<span /></div><GoogleSignIn intent={registering ? 'register' : 'login'} onCredential={googleLogin} onError={setError} theme={theme} disabled={pending} />
    <p className="auth-mode-link">{registering ? 'Already have an account?' : 'New to Ciftron?'} <a href={`#${registering ? 'sign-in' : 'register'}${invitation ? `?invite=${encodeURIComponent(invitation)}` : ''}`} onClick={event => { event.preventDefault(); navigate(`${registering ? 'sign-in' : 'register'}${invitation ? `?invite=${encodeURIComponent(invitation)}` : ''}`); }}>{registering ? 'Sign in' : 'Create an account'}<Icon name="arrow" size={13} /></a></p>
    <div className="signin-footnote"><Icon name="lock" size={14} /><span>Your session is secured with an HTTP-only cookie. Workspace access is enforced by the server.</span></div></div></section>
  </div>;
}
