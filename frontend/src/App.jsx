import { useEffect, useState } from 'react';
import { Button, Icon } from './components/ui.jsx';
import { useAuth } from './hooks/useAuth.jsx';
import AccountShell from './components/AccountShell.jsx';
import SignIn from './pages/SignIn.jsx';
import Register from './pages/Register.jsx';
import Home from './pages/Home.jsx';
import { navigation } from './data/navigation.js';
import { Badge, Field, Modal } from './components/ui.jsx';
import { campaignCSV, downloadFile } from './lib/records.js';
const getPath = () => location.pathname !== '/' && location.pathname !== '/index.html' ? 'not-available' : location.hash.slice(1).split('?')[0] || 'home';
export default function App() {
  const auth = useAuth();
  const [route, setRoute] = useState(()=>location.hash);
  const page=getPath();
  const [theme, setTheme] = useState(() => { try { return localStorage.getItem('ciftron-theme') || 'light'; } catch { return 'light'; } });
  useEffect(() => { const handler = () => setRoute(location.hash); window.addEventListener('hashchange', handler); return () => window.removeEventListener('hashchange', handler); }, []);
  useEffect(() => { document.documentElement.dataset.theme = theme; try { localStorage.setItem('ciftron-theme', theme); } catch {} }, [theme]);
  useEffect(() => { document.title = page === 'home' ? 'Ciftron · AI digital marketing platform' : (page === 'sign-in' ? 'Sign in' : page === 'register' ? 'Create account' : navigation.find(item => item.path === page)?.label || 'Page not available') + ' · Ciftron'; window.scrollTo({ top: 0, behavior: 'instant' }); }, [page]);
  function navigate(path) { if (location.pathname !== '/') history.replaceState(null, '', '/' + location.search + '#' + path); else location.hash = path; setRoute('#'+path); }
  useEffect(() => {
    if (!auth.loading && !auth.user && !['home', 'sign-in', 'register'].includes(page)) navigate('sign-in');
  }, [auth.loading, auth.user, page]);
  if (page === 'home') return <Home user={auth.user} />;
  if (auth.loading) return <div className="auth-loading-screen" role="status"><Icon name="loader" size={28} /><strong>Opening your workspace…</strong><span>Checking your secure session.</span></div>;
  if (!auth.user) return page === 'register' ? <Register key={location.hash} navigate={navigate} theme={theme} setTheme={setTheme} /> : <SignIn key={location.hash} navigate={navigate} theme={theme} setTheme={setTheme} />;
  return <AccountShell page={['sign-in', 'register'].includes(page) ? 'overview' : page} navigate={navigate} theme={theme} setTheme={setTheme} NewCampaign={NewCampaign} CampaignDetail={CampaignDetail} />;
}

function NewCampaign({ onClose, mutate, notify }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  async function submit(event) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    setPending(true); setError('');
    try { await mutate('/platform/campaigns', 'POST', { name: form.get('name').trim(), audience: form.get('audience').trim() }); notify('Campaign saved to your workspace.'); onClose(); }
    catch (failure) { setError(failure.message); } finally { setPending(false); }
  }
  return <Modal title="Create a campaign" description="Organize your outreach with a saved campaign draft." onClose={onClose}><form onSubmit={submit} className="form-stack">{error && <p className="auth-error" role="alert">{error}</p>}<Field label="Campaign name"><input name="name" required maxLength={100} autoFocus /></Field><Field label="Audience segment"><input name="audience" required maxLength={150} /></Field><div className="inline-note"><Icon name="file" size={17} /><span>Drafts are saved to the workspace database. Connect an email delivery service before sending.</span></div><div className="modal-actions"><Button onClick={onClose} type="button" disabled={pending}>Cancel</Button><Button variant="primary" icon={pending ? 'loader' : 'plus'} type="submit" disabled={pending}>Create campaign</Button></div></form></Modal>;
}
function CampaignDetail({ campaign, onClose, mutate, notify, navigate, canWrite, canGenerate }) {
  const [pending, setPending] = useState(false);
  async function changeStatus() {
    setPending(true);
    try { await mutate('/platform/campaigns/' + campaign.id, 'PATCH', { status: campaign.status === 'Archived' ? 'Draft' : 'Archived', version: campaign.version }); notify('Campaign updated.'); }
    catch (failure) { notify(failure.message); } finally { setPending(false); }
  }
  return <Modal title={campaign.name} description={campaign.audience} onClose={onClose}><div className="detail-top"><Badge>{campaign.status}</Badge><span className="muted">Saved workspace campaign</span></div><div className="inline-note"><Icon name="plug" /><span>Email delivery is not connected. Sent counts, open rates, and click rates will appear after a delivery provider supplies those events.</span></div><div className="modal-actions"><Button icon="download" onClick={() => downloadFile('campaign.csv', campaignCSV([campaign]), 'text/csv')}>Export</Button>{canWrite && <Button icon={pending ? 'loader' : 'file'} disabled={pending} onClick={changeStatus}>{campaign.status === 'Archived' ? 'Restore draft' : 'Archive'}</Button>}<Button variant="primary" icon="sparkles" disabled={!canGenerate} onClick={() => { onClose(); navigate('email-agent'); }}>Build a sequence</Button></div></Modal>;
}
