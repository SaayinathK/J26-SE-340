import './email.css';
import { useState } from 'react';
import { useAuth } from '../../hooks/useAuth.jsx';
import { useWorkspace } from './hooks/useEmailWorkspace.js';
import { Button, Icon } from '../../components/ui.jsx';
import EmailAgent from './components/EmailAgent.jsx';
import Knowledge from './components/Knowledge.jsx';

export default function EmailWorkspace({ notify }) {
  const auth = useAuth();
  const live = useWorkspace(auth.workspace.id, auth.user.role);
  const [page, setPage] = useState('email-agent');
  const props = { data: live.data, mutate: live.mutate, workspace: auth.workspace, notify, navigate: setPage };
  if (live.loading) return <p role="status">Loading your email workspace...</p>;
  return <>{live.error && <div role="alert" className="auth-error">{live.error}<Button onClick={() => live.refresh(true)}>Try again</Button></div>}{page === 'knowledge' ? <><Button icon="left" onClick={() => setPage('email-agent')}>Back to sequences</Button><Knowledge {...props} canManage={auth.can('knowledge:write')} /></> : <EmailAgent {...props} />}</>;
}
