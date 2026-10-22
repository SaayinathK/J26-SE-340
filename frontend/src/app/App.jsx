// frontend/src/app/App.jsx — platform shell (dark sidebar, top bar, light/dark theme), sign-in and page switching
import { useEffect, useRef, useState } from 'react';
import { Activity, ArrowRight, Gauge, History as HistoryIcon, LayoutDashboard, Lock, LogOut, Moon, Search, ShieldCheck, Sparkles, Sun, Target, Users, Zap } from 'lucide-react';
import { loadSession, login, saveSession } from '../lib/api-client.js';
import { ThemeCtx, useToast } from '../components/ui.jsx';
import { displayName } from '../features/lead-intel/lang.js';
import Overview from '../features/lead-intel/pages/Overview.jsx';
import Leads from '../features/lead-intel/pages/Leads.jsx';
import History from '../features/lead-intel/pages/History.jsx';
import Scorer from '../features/lead-intel/pages/Scorer.jsx';
import Health from '../features/lead-intel/pages/Health.jsx';

const BRAND = 'ciftron';
const PAGES = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard, el: Overview },
  { id: 'leads', label: 'Leads', icon: Users, el: Leads, tag: 'AI' },
  { id: 'history', label: 'Lead history', icon: HistoryIcon, el: History },
  { id: 'score', label: 'Check a new lead', icon: Target, el: Scorer },
  { id: 'health', label: 'Score check', icon: Activity, el: Health },
];
const pageFromHash = () => PAGES.find((p) => '#' + p.id === window.location.hash)?.id || 'overview';
const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage blocked */ } },
};
const workspaceName = (email) => {
  const d = (email || '').split('@')[1] || 'workspace';
  return d.split('.')[0].replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
};

function Logo() {
  return (
    <div className="logo">
      <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true">
        <path d="M20 7.5A9 9 0 1 0 20 20.5" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
        <circle cx="21" cy="14" r="3" fill="#19c9b6" />
      </svg>
      <span>{BRAND}<i>.</i></span>
    </div>
  );
}

export default function App() {
  const [session, setSession] = useState(() => {
    const s = loadSession();
    return s && (!s.exp || s.exp * 1000 > Date.now()) ? s : null;
  });
  const [page, setPage] = useState(pageFromHash);
  const [theme, setTheme] = useState(() => store.get('c3_theme') || 'light');
  const [search, setSearch] = useState('');
  const searchRef = useRef(null);
  const toast = useToast();

  useEffect(() => { document.documentElement.dataset.theme = theme; store.set('c3_theme', theme); }, [theme]);
  useEffect(() => {
    const on = () => setPage(pageFromHash());
    const key = (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); searchRef.current?.focus(); } };
    window.addEventListener('hashchange', on);
    window.addEventListener('keydown', key);
    return () => { window.removeEventListener('hashchange', on); window.removeEventListener('keydown', key); };
  }, []);

  const signOut = (msg) => {
    saveSession(null);
    setSession(null);
    if (msg) toast(msg, 'err');
  };

  if (!session) {
    return (
      <ThemeCtx.Provider value={theme}>
        <Login onSignedIn={(s) => { saveSession(s); setSession(s); toast(`Welcome back, ${displayName(s.email)}`); }} />
      </ThemeCtx.Provider>
    );
  }

  const current = PAGES.find((p) => p.id === page);
  const Page = current.el;
  const go = (id) => { window.location.hash = id; setPage(id); };
  const runSearch = (e) => {
    e.preventDefault();
    if (!search.trim()) return;
    sessionStorage.setItem('c3_search', search.trim());
    setSearch('');
    if (page === 'leads') window.dispatchEvent(new Event('c3-search')); else go('leads');
  };

  return (
    <ThemeCtx.Provider value={theme}>
      <div className="shell">
        <aside className="sidebar">
          <Logo />
          <div className="workspace">
            <span className="ws-mark">{workspaceName(session.email)[0]}</span>
            <div>
              <div className="ws-name">{workspaceName(session.email)}</div>
              <div className="ws-sub">your workspace</div>
            </div>
            <Lock size={14} className="ws-lock" aria-label="Isolated workspace" />
          </div>
          <div className="side-label">Lead intelligence</div>
          {PAGES.map(({ id, label, icon: Icon, tag }) => (
            <button key={id} className={`nav-btn ${page === id ? 'active' : ''}`} onClick={() => go(id)}
                    aria-current={page === id ? 'page' : undefined}>
              <Icon size={17} /> {label}{tag && <span className="tag">{tag}</span>}
            </button>
          ))}
          <div className="promo">
            <Zap size={18} />
            <b>Know who to call today.<br />Win more customers.</b>
            <p>Your hottest leads, ranked by the AI.</p>
            <button onClick={() => go('leads')}>Open my leads <ArrowRight size={13} /></button>
          </div>
          <div className="side-user">
            <span className="avatar">{displayName(session.email).slice(0, 2).toUpperCase()}</span>
            <div className="who">
              <b title={session.email}>{displayName(session.email)}</b>
              <span>{session.role.replace('_', ' ')}</span>
            </div>
            <button onClick={() => signOut()} aria-label="Sign out" title="Sign out"><LogOut size={16} /></button>
          </div>
        </aside>

        <div className="content">
          <header className="topnav">
            <nav className="crumbs" aria-label="Breadcrumb"><span>Workspace</span><span>/</span><b>{current.label}</b></nav>
            <form className="top-search" onSubmit={runSearch} role="search">
              <Search size={15} />
              <input ref={searchRef} placeholder="Search leads…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search leads" />
              <kbd>Ctrl K</kbd>
            </form>
            <button className="top-icon" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                    aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}>
              {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
            </button>
            <span className="top-avatar" title={session.email}>{displayName(session.email).slice(0, 2).toUpperCase()}</span>
          </header>
          <main className="main">
            <Page key={page} session={session} go={go} onAuthError={() => signOut('Your session ended. Please sign in again.')} />
          </main>
        </div>
      </div>
    </ThemeCtx.Provider>
  );
}

const DEMO = ['admin@tenant-a.com', 'marketer@tenant-a.com', 'viewer@tenant-a.com', 'admin@tenant-b.com'];

function Login({ onSignedIn }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      onSignedIn(await login(email.trim(), password));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <div className="login-hero">
        <Logo />
        <div className="eyebrow">Lead intelligence</div>
        <h1>Right lead. Right moment.<span>Real customers.</span></h1>
        <p>See which leads are ready to buy, what to do next, and a message you can send. Only your own company's data is used.</p>
        <div className="feature-list">
          <div className="feature"><Gauge size={20} /><div><b>Know who to call first.</b> Every lead gets a score from 0 to 100, with simple reasons.</div></div>
          <div className="feature"><Sparkles size={20} /><div><b>Clear next steps.</b> The assistant tells you what to do and writes the message, based on your rules and past customers.</div></div>
          <div className="feature"><ShieldCheck size={20} /><div><b>Your data stays yours.</b> You only ever see your own company's leads.</div></div>
        </div>
      </div>
      <div className="login-panel">
        <div className="card login-card rise">
          <div className="eyebrow">Welcome back</div>
          <h2 style={{ margin: '8px 0 0', fontWeight: 700, letterSpacing: '-0.02em' }}>Sign in to your workspace</h2>
          <form onSubmit={submit}>
            <div className="field">
              <label htmlFor="email">Email</label>
              <input id="email" className="input" type="email" autoComplete="username" required
                     value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="password">Password</label>
              <input id="password" className="input" type="password" autoComplete="current-password" required
                     value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            {error && <div className="error-box">{error}</div>}
            <button className="btn" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
          </form>
          <div className="card-note">Demo accounts (password <code>Test@12345</code>), click one to fill in:</div>
          <div className="demo-users">
            {DEMO.map((d) => (
              <button key={d} type="button" className="pill muted" style={{ cursor: 'pointer' }}
                      onClick={() => { setEmail(d); setPassword('Test@12345'); }}>{d}</button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
