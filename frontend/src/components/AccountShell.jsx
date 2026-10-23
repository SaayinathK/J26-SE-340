import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge, Button, EmptyState, Icon, Logo, Modal } from './ui.jsx';
import { navigation, settingsPages } from '../data/navigation.js';
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
import ServiceWorkspace from '../pages/ServiceWorkspace.jsx';
import NotAvailable from './NotAvailable.jsx';
import AccessDenied from './AccessDenied.jsx';
import { canAccessPage, pagePermissions, assertPermission, workspaceMutationPermission } from '../lib/access.js';

export {pagePermissions};
const roleNames = { agency_admin: 'Administrator', marketer: 'Marketer', viewer: 'Viewer' };


export default function AccountShell(props) {
  const auth = useAuth();
  return <ServicesProvider key={`${auth.workspace.id}-${auth.user.role}`}><WorkspaceShell {...props} /></ServicesProvider>;
}

function WorkspaceShell({ page, navigate: onNavigate, theme, setTheme, NewCampaign, CampaignDetail }) {
  const auth = useAuth();
  const { user, can } = auth;
  const serviceDirectory = useServices();
  const workspace = { ...auth.workspace, domain: auth.workspace.domain || '', initials: auth.workspace.name.split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase() };
  const initials = user.name.split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();
  const live = useWorkspace(auth.workspace.id, user.role);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [agentsOpen, setAgentsOpen] = useState(() => navigation.some(item => item.group === 'agents' && item.path === page));
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState(null);
  const [toast, setToast] = useState(null);
  const [logoutPending, setLogoutPending] = useState(false);
  const [motion, setMotion] = useMotionPreference();
  const main = useRef(null);
  const searchRef = useRef(null);
  function navigate(path) { setMobileOpen(false); setSearch(''); onNavigate(path); }
  const data = live.data;
  const canWrite = can('campaigns:write');
  const canGenerate = can('email:generate');
  const allowed = navigation.filter(item => item.path !== 'integrations' && canAccessPage(item.path,can));
  const agents = allowed.filter(item => item.group === 'agents');
  const inSettings = settingsPages.includes(page);
  useEffect(() => { if (navigation.some(item => item.group === 'agents' && item.path === page)) setAgentsOpen(true); }, [page]);
  const pageKnown = navigation.some(item=>item.path===page);
  const pageAllowed = canAccessPage(page,can);
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
  async function mutate(path,method,...args){assertPermission(can,workspaceMutationPermission(path,method));return live.mutate(path,method,...args);}
  const props = { data, workspace, mutate, refresh: live.refresh, notify, navigate, canWrite, canGenerate, canMonitor:can('monitoring:read'), canManage: can('knowledge:write'), user,
    newCampaign: () => canWrite ? setModal({ type: 'new' }) : notify('Your role has read-only campaign access.'),
    openCampaign: campaign => {assertPermission(can,'campaigns:read');setModal({ type: 'campaign', campaign });},
  };
  const results = search.trim() ? [...allowed.filter(item => item.label.toLowerCase().includes(search.toLowerCase())).map(item => ({ ...item, kind: 'Page' })), ...data.campaigns.filter(item => item.name.toLowerCase().includes(search.toLowerCase())).map(item => ({ label: item.name, icon: 'mail', kind: 'Campaign', campaign: item }))].slice(0, 7) : [];
  return <div className="app-shell"><a className="skip-link" href="#main-content" onClick={event => { event.preventDefault(); main.current?.focus(); }}>Skip to content</a>{mobileOpen && <div className="sidebar-overlay" onClick={() => setMobileOpen(false)} />}
    <aside className={`sidebar ${mobileOpen ? 'is-open' : ''}`} aria-label="Main navigation"><a href="#overview" className="brand-link" aria-label="Ciftron dashboard" onClick={() => navigate('overview')}><Logo /></a><div className="workspace-switcher authenticated-workspace"><span className="workspace-avatar">{workspace.initials}</span><span className="workspace-info"><strong>{workspace.name}</strong><span>{workspace.plan} workspace</span></span><Icon name="lock" size={15} /></div>
    <nav className="sidebar-navigation" aria-label="Workspace navigation">
      <div className="nav-group"><div className="nav-label">WORKSPACE</div>
        {allowed.filter(item => item.group === 'workspace' && !item.hidden).map(item => <a key={item.path} href={`#${item.path}`} onClick={() => navigate(item.path)} className={`nav-item ${page === item.path ? 'active' : ''}`} aria-current={page === item.path ? 'page' : undefined}><Icon name={item.icon} size={19} /><span>{item.label}</span>{page === item.path && <span className="active-dot" />}</a>)}
        {!!agents.length && <div className="sidebar-agent-group"><button className={`nav-item nav-disclosure ${agents.some(item => item.path === page) ? 'section-active' : ''}`} aria-expanded={agentsOpen} aria-controls="sidebar-agent-links" onClick={() => setAgentsOpen(value => !value)}><Icon name="sparkles" size={19} /><span>AI agents</span><Icon name="down" size={15} /></button>
          <div id="sidebar-agent-links" className="sidebar-agent-links" hidden={!agentsOpen}>{agents.map(item => <a key={item.path} href={`#${item.path}`} onClick={() => navigate(item.path)} className={`nav-item nav-child ${page === item.path ? 'active' : ''}`} aria-current={page === item.path ? 'page' : undefined}><Icon name={item.icon} size={16} /><span>{item.label}</span><i className={`nav-service-dot ${serviceDirectory.services.find(service => service.id === item.path)?.available && !serviceDirectory.error ? 'available' : 'unavailable'}`} aria-hidden="true" /></a>)}</div>
        </div>}
      </div>
    </nav>
    <div className="sidebar-bottom"><div className="sidebar-utilities"><a href="#settings" onClick={() => navigate('settings')} className={`nav-item ${inSettings ? 'active' : ''}`} aria-current={inSettings ? 'page' : undefined}><Icon name="settings" size={19} /><span>Settings</span></a><button className="nav-item sidebar-help" onClick={() => setModal({ type: 'help' })}><Icon name="help" size={19} /><span>Help & support</span><Icon name="trend" size={14} /></button></div>
      <div className="sidebar-user"><span className="avatar user-avatar">{initials}</span><a href="#settings" onClick={() => navigate('settings')} className="sidebar-profile" aria-label="Your account"><strong>{user.name}</strong><small>{roleNames[user.role]}</small></a><button className="sidebar-user-settings" aria-label="Sign out" title="Sign out" onClick={signOut} disabled={logoutPending}><Icon name={logoutPending ? 'loader' : 'logout'} size={17} /></button></div>
    </div></aside>
    <div className="main-shell"><header className="topbar"><div className="breadcrumb"><button className="icon-button mobile-menu" aria-label="Open navigation" onClick={() => setMobileOpen(true)}><Icon name="menu" /></button><span className="breadcrumb-workspace">Workspace</span><span className="breadcrumb-slash">/</span><span>{navigation.find(item => item.path === page)?.label || 'Not available'}</span></div><div className="topbar-actions"><div className="global-search"><Icon name="search" size={16} /><input ref={searchRef} placeholder="Search anything..." aria-label="Search pages and campaigns" value={search} onChange={event => setSearch(event.target.value)} /><kbd>Ctrl K</kbd>{search && <div className="search-results">{results.length ? results.map((result, index) => <button key={index} onClick={() => { if (result.campaign) { setModal({ type: 'campaign', campaign: result.campaign }); setSearch(''); } else navigate(result.path); }}><Icon name={result.icon} /><span>{result.label}<small>{result.kind}</small></span><Icon name="right" size={14} /></button>) : <p>No pages or campaigns found.</p>}</div>}</div><span className="topbar-divider" /><button className="icon-button theme-toggle" aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`} onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}><Icon name={theme === 'light' ? 'moon' : 'sun'} /></button><button className="icon-button" aria-label="Open notifications" onClick={() => setModal({ type: 'notifications' })}><Icon name="bell" /></button><button className="avatar top-avatar" aria-label="Open account settings" onClick={() => navigate('settings')}>{initials}</button></div></header>
    <main ref={main} id="main-content" className="page-content" tabIndex={-1} key={`${page}-${workspace.id}`}>
      {auth.error && <div className="auth-error" role="status"><Icon name="alert" />{auth.error}<Button onClick={auth.refresh}>Retry</Button></div>}
      {live.error && <div className="auth-error" role="alert"><Icon name="alert" />{live.error}<Button onClick={live.refresh}>Retry</Button></div>}
      {live.loading ? <section className="card"><EmptyState icon="loader" title="Loading workspace" description="Reading your saved records." /></section> : !pageKnown ? <NotAvailable onBack={()=>navigate('overview')}/> : !pageAllowed ? <AccessDenied onBack={()=>navigate('overview')}/> : <>
      {page === 'overview' && <Overview {...props} />}{['email-agent', 'lead-intel', 'strategy-fl', 'content-agent'].includes(page) && <ServiceWorkspace key={page} serviceId={page} navigate={navigate} theme={theme} notify={notify} platformData={data} />}{page === 'campaigns' && <Campaigns {...props} />}{page === 'knowledge' && <Knowledge {...props} />}{inSettings && <><nav className="workspace-settings-tabs" aria-label="Settings sections">{[{path:'settings',label:'Account & workspace',icon:'settings'},{path:'team',label:'Team & access',icon:'users'},{path:'monitoring',label:'Monitoring',icon:'activity'}].filter(item => canAccessPage(item.path, can)).map(item => <a key={item.path} href={`#${item.path}`} onClick={() => navigate(item.path)} aria-current={page === item.path ? 'page' : undefined}><Icon name={item.icon} size={16} />{item.label}</a>)}</nav>{page === 'team' && <TeamAccess notify={notify} />}{page === 'monitoring' && <Monitoring {...props} />}{page === 'settings' && <><AccountSettings theme={theme} setTheme={setTheme} notify={notify} /><MotionSettings motion={motion} setMotion={setMotion} /></>}</>}
      {!navigation.some(item => item.path === page) && <NotAvailable onBack={() => navigate('overview')} />}</>}<footer className="page-footer"><span>© 2026 Ciftron. Made for what’s next.</span><span><i />{roleNames[user.role]}<span className="footer-separator">·</span>{live.error ? 'Connection interrupted' : live.loading ? 'Connecting' : 'Database connected'} · refreshes every 5 seconds</span></footer></main></div>
    {toast && <div role="status" className="toast"><Icon name="success" size={19} /><span>{toast}</span><button className="icon-button" aria-label="Dismiss notification" onClick={() => setToast(null)}><Icon name="close" size={15} /></button></div>}
    {modal?.type === 'new' && canWrite && <NewCampaign onClose={close} {...props} />}{modal?.type === 'campaign' && <CampaignDetail campaign={data.campaigns.find(item => item.id === modal.campaign.id) || modal.campaign} onClose={close} {...props} />}
    {modal?.type === 'help' && <Modal title="Your workspace, at a glance" description="Find the right place for your next step." onClose={close}><div className="help-content"><p>Dashboard brings your workspace overview and AI agents together. Open AI agents in the sidebar for a shortcut to each workspace. Use Campaigns to organize your outreach and Knowledge base to manage the business context available to your agents.</p><p>Settings contains your account and workspace preferences. Administrators can also manage Team &amp; access and view Monitoring there. Pages and actions follow your current workspace permissions.</p></div></Modal>}
    {modal?.type === 'notifications' && <Modal title="Your notifications" description="Recent recorded workspace activity." onClose={close}>{data.activities.length ? <div className="notification-list">{data.activities.map(activity => <div className="activity-item" key={activity.id}><span className="activity-icon"><Icon name={activity.icon} size={18} /></span><div><strong>{activity.title}</strong><p>{activity.description}</p><small>{formatTime(activity.created_at)}</small></div></div>)}</div> : <p className="muted">You’re all caught up.</p>}</Modal>}
  </div>;
}
