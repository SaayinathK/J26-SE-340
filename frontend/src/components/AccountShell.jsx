import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge, Button, EmptyState, Icon, Logo, Modal } from './ui.jsx';
import { navigation } from '../data/navigation.js';
import { formatTime } from '../lib/records.js';
import { useWorkspace } from '../hooks/useWorkspace.js';
import { useAuth } from '../hooks/useAuth.jsx';
import { useMotionPreference, usePageReveal } from '../hooks/useMotion.js';
import Overview from '../pages/Overview.jsx';
import Campaigns from '../pages/Campaigns.jsx';
import { Knowledge, Monitoring } from '../pages/Workspace.jsx';
import TeamAccess from '../pages/TeamAccess.jsx';
import AccountSettings from '../pages/AccountSettings.jsx';
import MotionSettings from './MotionSettings.jsx';
import { ServicesProvider, useServices } from '../hooks/useServices.jsx';
import Services from '../pages/Services.jsx';
import ServiceWorkspace from '../pages/ServiceWorkspace.jsx';
import NotAvailable from './NotAvailable.jsx';

export const pagePermissions = { overview: 'campaigns:read', campaigns: 'campaigns:read', 'email-agent': 'email:generate', 'lead-intel': 'campaigns:read', 'strategy-fl': 'campaigns:read', 'content-agent': 'campaigns:read', knowledge: 'knowledge:read', team: 'team:manage', integrations: 'campaigns:read', monitoring: 'monitoring:read' };
const roleNames = { agency_admin: 'Administrator', marketer: 'Marketer', viewer: 'Viewer' };


export default function AccountShell(props) {
  const auth = useAuth();
  return <ServicesProvider key={`${auth.workspace.id}-${auth.user.role}`}><WorkspaceShell {...props} /></ServicesProvider>;
}

function WorkspaceShell({ page, navigate, theme, setTheme, NewCampaign, CampaignDetail }) {
  const auth = useAuth();
  const { user, can } = auth;
  const serviceDirectory = useServices();
  const workspace = { ...auth.workspace, domain: auth.workspace.domain || '', initials: auth.workspace.name.split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase() };
  const initials = user.name.split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();
  const live = useWorkspace(auth.workspace.id, user.role);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState(null);
  const [toast, setToast] = useState(null);
  const [logoutPending, setLogoutPending] = useState(false);
  const [motion, setMotion] = useMotionPreference();
  const main = useRef(null);
  const searchRef = useRef(null);
  const data = live.data;
  const canWrite = can('campaigns:write');
  const canGenerate = can('email:generate');
  const allowed = navigation.filter(item => !pagePermissions[item.path] || can(pagePermissions[item.path]));
  const pageAllowed = !pagePermissions[page] || can(pagePermissions[page]);
  const notify = useCallback(message => setToast(message), []);
  const close = useCallback(() => setModal(null), []);
  usePageReveal(main, page, workspace.id, motion);
  useEffect(() => { window.scrollTo({ top: 0, left: 0, behavior: 'instant' }); main.current?.focus({ preventScroll: true }); setMobileOpen(false); setSearch(''); setModal(null); }, [page, workspace.id]);
  useEffect(() => { if (!toast) return; const timeout = setTimeout(() => setToast(null), 4500); return () => clearTimeout(timeout); }, [toast]);
  useEffect(() => {
    const key = event => { if ((event.ctrlKey || event.metaKey) && event.key === 'k') { event.preventDefault(); searchRef.current?.focus(); } if (event.key === 'Escape') { setMobileOpen(false); setSearch(''); } };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, []);
  async function signOut() { setLogoutPending(true); try { await auth.logout(); navigate('sign-in'); } catch (failure) { notify(failure.message); } finally { setLogoutPending(false); } }
  const props = { data, workspace, mutate: live.mutate, refresh: live.refresh, notify, navigate, canWrite, canGenerate, canManage: can('knowledge:write'), user,
    newCampaign: () => canWrite ? setModal({ type: 'new' }) : notify('Your role has read-only campaign access.'),
    openCampaign: campaign => setModal({ type: 'campaign', campaign }),
  };
  const results = search.trim() ? [...allowed.filter(item => item.label.toLowerCase().includes(search.toLowerCase())).map(item => ({ ...item, kind: 'Page' })), ...data.campaigns.filter(item => item.name.toLowerCase().includes(search.toLowerCase())).map(item => ({ label: item.name, icon: 'mail', kind: 'Campaign', campaign: item }))].slice(0, 7) : [];
  return <div className="app-shell"><a className="skip-link" href="#main-content" onClick={event => { event.preventDefault(); main.current?.focus(); }}>Skip to content</a>{mobileOpen && <div className="sidebar-overlay" onClick={() => setMobileOpen(false)} />}
    <aside className={`sidebar ${mobileOpen ? 'is-open' : ''}`} aria-label="Main navigation"><a href="#overview" className="brand-link" aria-label="Ciftron overview" onClick={() => navigate('overview')}><Logo /></a><div className="workspace-switcher authenticated-workspace"><span className="workspace-avatar">{workspace.initials}</span><span className="workspace-info"><strong>{workspace.name}</strong><span>{workspace.plan} workspace</span></span><Icon name="lock" size={15} /></div>
    <nav>{['workspace', 'agents', 'manage'].map(group => <div className="nav-group" key={group}><div className="nav-label">{group === 'workspace' ? 'WORKSPACE' : group === 'agents' ? 'AGENTS' : 'MANAGEMENT'}</div>{allowed.filter(item => item.group === group).map(item => <a key={item.path} href={`#${item.path}`} onClick={() => navigate(item.path)} className={`nav-item ${page === item.path ? 'active' : ''}`} aria-current={page === item.path ? 'page' : undefined}><Icon name={item.icon} size={19} /><span>{item.label}</span>{item.badge && <span className="nav-ai">{item.badge}</span>}{group === 'agents' && <i className={`nav-service-dot ${serviceDirectory.services.find(service => service.id === item.path)?.available && !serviceDirectory.error ? 'available' : 'unavailable'}`} aria-hidden="true" title={serviceDirectory.loading ? 'Checking availability' : serviceDirectory.services.find(service => service.id === item.path)?.available && !serviceDirectory.error ? 'Available' : 'Not available'} />}{page === item.path && group !== 'agents' && <span className="active-dot" />}</a>)}</div>)}</nav>
    <div className="sidebar-bottom">{canGenerate && <div className="plan-card"><span className="plan-card-icon"><Icon name="zap" size={19} /></span><strong>A little intelligence.<br />A lot of possibility.</strong><p>Bring your next email idea to life.</p><button onClick={() => navigate('email-agent')}>Meet your Email Agent <Icon name="arrow" size={14} /></button></div>}<button className="sidebar-help" onClick={() => setModal({ type: 'help' })}><Icon name="help" size={18} />Help & getting started<Icon name="trend" size={15} /></button><div className="sidebar-user"><span className="avatar user-avatar">{initials}</span><span><strong>{user.name}</strong><small>{roleNames[user.role]}</small></span><button className="sidebar-user-settings" aria-label="Sign out" title="Sign out" onClick={signOut} disabled={logoutPending}><Icon name={logoutPending ? 'loader' : 'logout'} size={17} /></button></div></div></aside>
    <div className="main-shell"><header className="topbar"><div className="breadcrumb"><button className="icon-button mobile-menu" aria-label="Open navigation" onClick={() => setMobileOpen(true)}><Icon name="menu" /></button><span className="breadcrumb-workspace">Workspace</span><span className="breadcrumb-slash">/</span><span>{navigation.find(item => item.path === page)?.label || 'Not available'}</span></div><div className="topbar-actions"><div className="global-search"><Icon name="search" size={16} /><input ref={searchRef} placeholder="Search anything..." aria-label="Search pages and campaigns" value={search} onChange={event => setSearch(event.target.value)} /><kbd>Ctrl K</kbd>{search && <div className="search-results">{results.length ? results.map((result, index) => <button key={index} onClick={() => { if (result.campaign) { setModal({ type: 'campaign', campaign: result.campaign }); setSearch(''); } else navigate(result.path); }}><Icon name={result.icon} /><span>{result.label}<small>{result.kind}</small></span><Icon name="right" size={14} /></button>) : <p>No pages or campaigns found.</p>}</div>}</div><span className="topbar-divider" /><button className="icon-button theme-toggle" aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`} onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}><Icon name={theme === 'light' ? 'moon' : 'sun'} /></button><button className="icon-button" aria-label="Open notifications" onClick={() => setModal({ type: 'notifications' })}><Icon name="bell" /></button><button className="avatar top-avatar" aria-label="Open account settings" onClick={() => navigate('settings')}>{initials}</button></div></header>
    <main ref={main} id="main-content" className="page-content" tabIndex={-1} key={`${page}-${workspace.id}`}>
      {auth.error && <div className="auth-error" role="status"><Icon name="alert" />{auth.error}<Button onClick={auth.refresh}>Retry</Button></div>}
      {live.error && <div className="auth-error" role="alert"><Icon name="alert" />{live.error}<Button onClick={live.refresh}>Retry</Button></div>}
      {live.loading ? <section className="card"><EmptyState icon="loader" title="Loading workspace" description="Reading your saved records." /></section> : !pageAllowed ? <section className="card"><EmptyState icon="lock" title="This area needs a different role" description="Your current workspace role does not have access. Contact your administrator if you need additional permissions."><Button onClick={() => navigate('overview')}>Back to overview</Button></EmptyState></section> : <>
      {page === 'overview' && <Overview {...props} />}{['email-agent', 'lead-intel', 'strategy-fl', 'content-agent'].includes(page) && <ServiceWorkspace key={page} serviceId={page} navigate={navigate} theme={theme} notify={notify} />}{page === 'campaigns' && <Campaigns {...props} />}{page === 'knowledge' && <Knowledge {...props} />}{page === 'integrations' && <Services navigate={navigate} />}{page === 'team' && <TeamAccess notify={notify} />}{page === 'monitoring' && <Monitoring {...props} />}{page === 'settings' && <><AccountSettings theme={theme} setTheme={setTheme} notify={notify} /><MotionSettings motion={motion} setMotion={setMotion} /></>}
      {!navigation.some(item => item.path === page) && <NotAvailable onBack={() => navigate('integrations')} />}</>}<footer className="page-footer"><span>© 2026 Ciftron. Made for what’s next.</span><span><i />{roleNames[user.role]}<span className="footer-separator">·</span>{live.error ? 'Connection interrupted' : live.loading ? 'Connecting' : 'Database connected'} · refreshes every 5 seconds</span></footer></main></div>
    {toast && <div role="status" className="toast"><Icon name="success" size={19} /><span>{toast}</span><button className="icon-button" aria-label="Dismiss notification" onClick={() => setToast(null)}><Icon name="close" size={15} /></button></div>}
    {modal?.type === 'new' && canWrite && <NewCampaign onClose={close} {...props} />}{modal?.type === 'campaign' && <CampaignDetail campaign={data.campaigns.find(item => item.id === modal.campaign.id) || modal.campaign} onClose={close} {...props} />}
    {modal?.type === 'help' && <Modal title="Your workspace, connected" description="Your account, membership, and permissions are live." onClose={close}><div className="help-content"><p>Sign-in, Google account linking, workspace profiles, and team roles use the account database. Administrators invite people and assign their roles. Campaigns, email sequences, knowledge sources, and activity are stored in PostgreSQL. Workspace data refreshes every five seconds and after changes. AI generation uses Ollama; delivery requires a sending provider.</p><p>Access changes take effect on the next server request. This interface checks for updated account permissions every 30 seconds and when you return to the tab.</p></div></Modal>}
    {modal?.type === 'notifications' && <Modal title="Your notifications" description="Recent recorded workspace activity." onClose={close}>{data.activities.length ? <div className="notification-list">{data.activities.map(activity => <div className="activity-item" key={activity.id}><span className="activity-icon"><Icon name={activity.icon} size={18} /></span><div><strong>{activity.title}</strong><p>{activity.description}</p><small>{formatTime(activity.created_at)}</small></div></div>)}</div> : <p className="muted">You’re all caught up.</p>}</Modal>}
  </div>;
}
