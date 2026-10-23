import './email.css';
import AccessDenied from '../../components/AccessDenied.jsx';
import {assertPermission,emailMutationPermission} from '../../lib/access.js';
import { useState } from 'react';
import { useAuth } from '../../hooks/useAuth.jsx';
import { useWorkspace } from './hooks/useEmailWorkspace.js';
import { Button, Icon } from '../../components/ui.jsx';
import EmailAgent from './components/EmailAgent.jsx';
import Knowledge from './components/Knowledge.jsx';

export default function EmailWorkspace(props) {
  const auth=useAuth();
  return auth.can('email:generate')?<EmailWorkspaceContent {...props}/>:<AccessDenied/>;
}
function EmailWorkspaceContent({ notify }) {
  const auth = useAuth();
  const live = useWorkspace(auth.workspace.id, auth.user.role);
  const [page, setPage] = useState('email-agent');
  async function mutate(path,method,...args){assertPermission(auth.can,emailMutationPermission(path,method));return live.mutate(path,method,...args);}
  const props = { data: live.data, mutate, workspace: auth.workspace, notify, navigate: setPage };
  if (live.loading) return <p role="status">Loading your email workspace...</p>;
  return <>{live.error && <div role="alert" className="auth-error">{live.error}<Button onClick={() => live.refresh(true)}>Try again</Button></div>}{page === 'knowledge' ? <><Button icon="left" onClick={() => setPage('email-agent')}>Back to sequences</Button><Knowledge {...props} canManage={auth.can('knowledge:write')} /></> : <EmailAgent {...props} />}</>;
}
