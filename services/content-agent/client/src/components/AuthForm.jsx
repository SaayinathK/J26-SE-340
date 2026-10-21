import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ArrowRight, Check, Loader2, Sparkles, Quote } from 'lucide-react';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { ErrorMessage } from './UI';
export default function AuthForm({ register = false }) {
  const { login, isAuthenticated } = useAuth(); const navigate = useNavigate(); const location = useLocation();
  const [form, setForm] = useState({ name: '', email: '', password: '' }); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  if (isAuthenticated && !busy) return <Navigate to={register ? '/settings' : '/dashboard'} replace />;
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const data = register ? await api.register(form.name.trim(), form.email.trim(), form.password) : await api.login(form.email.trim(), form.password);
      await login(data.token, data.client);
      navigate(register ? '/settings' : location.state?.from || '/dashboard', { replace: true });
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  return <div className="auth-page"><aside className="auth-story"><div className="logo"><span className="logo-mark"><Sparkles size={24}/></span>Ciftron <span className="logo-ai">AI</span></div><div className="auth-story-content"><span className="auth-tag">YOUR AI CONTENT PARTNER</span><h1>Your business.<br/>Your voice.<br/><em>More possibilities.</em></h1><p>Turn what makes your business different into content that connects.</p><div className="auth-benefits">{['Built on your business knowledge', 'Four formats. One creative workspace.', 'Feedback that helps your content improve'].map(text => <div key={text}><Check size={17}/>{text}</div>)}</div><div className="story-card"><Quote size={23}/><p>From a blank page to your next great campaign.</p><span>THE CIFTRON APPROACH</span></div></div><small>C1 Content Agent · AI Marketing Platform</small></aside><section className="auth-form-area"><div className="auth-form-inner"><span className="eyebrow">LET’S CREATE SOMETHING GOOD</span><h2>{register ? 'Create your workspace' : 'Welcome back'}</h2><p className="subtitle">{register ? 'A little about you. A lot of possibilities ahead.' : 'Your next great idea starts here.'}</p><ErrorMessage>{error}</ErrorMessage><form onSubmit={submit}>{register && <label>Full name<input required maxLength={255} autoComplete="name" value={form.name} onChange={e => setForm({...form, name:e.target.value})} placeholder="Your name"/></label>}<label>Email address<input required type="email" maxLength={255} autoComplete="email" value={form.email} onChange={e => setForm({...form, email:e.target.value})} placeholder="you@company.com"/></label><label>Password<input required type="password" minLength={register ? 8 : undefined} autoComplete={register ? 'new-password' : 'current-password'} value={form.password} onChange={e => setForm({...form, password:e.target.value})} placeholder={register ? 'At least 8 characters' : 'Enter your password'}/></label><button className="btn-primary auth-submit" disabled={busy}>{busy ? <Loader2 className="animate-spin" size={18}/> : null}{register ? 'Register' : 'Login'}<ArrowRight size={18}/></button></form><p className="auth-switch">{register ? 'Already have an account?' : "Don’t have an account?"} <Link to={register ? '/login' : '/register'}>{register ? 'Login' : 'Register'}</Link></p><p className="auth-caption">Your ideas. Your knowledge. Your workspace.</p></div></section></div>;
}
