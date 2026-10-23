import './email.css';
import { useEffect, useState } from 'react';
import { useAuth } from '../../hooks/useAuth.jsx';
import { useWorkspace } from './hooks/useEmailWorkspace.js';
import { useEmailIntelligence } from './hooks/useEmailIntelligence.js';
import { useServiceStatus } from './hooks/useServiceStatus.js';
import { Button, EmptyState, Icon } from '../../components/ui.jsx';
import EmailAgent from './components/EmailAgent.jsx';
import AccessDenied from '../../components/AccessDenied.jsx';
import {assertPermission,emailMutationPermission} from '../../lib/access.js';

const views = ['overview', 'builder', 'library', 'knowledge', 'performance', 'learning', 'integrations'];
const currentView = () => { const value = new URLSearchParams(location.hash.split('?')[1] || '').get('view'); return views.includes(value) ? value : 'overview'; };

export default function EmailWorkspace({ notify }) {
  const auth=useAuth();
  if(!auth.can('email:generate'))return <AccessDenied/>;
  return <EmailWorkspaceContent notify={notify}/>;
}
function EmailWorkspaceContent({notify}){
  const auth = useAuth();
  const live = useWorkspace(auth.workspace.id, auth.user.role);
  const intelligence = useEmailIntelligence(auth.workspace.id);
  const service = useServiceStatus();
  const [view, setView] = useState(currentView);
  useEffect(() => {
    const update = () => setView(currentView());
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  function navigate(next) { setView(next); location.hash = `email-agent?view=${next}`; }
  async function mutate(path,method,...args) { assertPermission(auth.can,emailMutationPermission(path,method));const result = await live.mutate(path,method,...args);await intelligence.refresh();return result; }
  if (live.loading) return <section className="email-workspace"><div className="email-loading"><Icon name="loader" size={26} /><strong>Opening your email studio</strong><span>Loading your workspace and saved sequences.</span></div></section>;
  if (live.error) return <section className="email-workspace"><div className="card"><EmptyState icon="plug" title="Your email workspace needs a connection" description={live.error}><Button onClick={() => live.refresh(true)} icon="refresh">Try again</Button></EmptyState></div></section>;
  return <section className="email-workspace" aria-label="Email Agent workspace"><EmailAgent data={live.data} mutate={mutate} refresh={() => { live.refresh(true); intelligence.refresh(); service.refresh(); }} workspace={auth.workspace} notify={notify} navigate={navigate} view={view} intelligence={intelligence} service={service} canManage={auth.can('workspace:manage')} canManageKnowledge={auth.can('knowledge:write')} /></section>;
}
