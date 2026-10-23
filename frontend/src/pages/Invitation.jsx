import { useEffect, useState } from 'react';
import { Button, Icon, Logo } from '../components/ui.jsx';
import { api } from '../lib/api-client.js';
import { useAuth } from '../hooks/useAuth.jsx';
import AuthPage from './AuthPage.jsx';
const roles = {agency_admin:'Administrator',marketer:'Marketer',viewer:'Viewer'};

export default function Invitation({token,mode,navigate,theme,setTheme}) {
  const auth=useAuth();
  const [state,setState]=useState({loading:true,error:'',details:null});
  const [busy,setBusy]=useState(false);
  const [retry,setRetry]=useState(0);
  useEffect(()=>{
    const controller=new AbortController();
    setState({loading:true,error:'',details:null});
    api('/auth/invitations/'+encodeURIComponent(token),{signal:controller.signal})
      .then(details=>setState({loading:false,error:'',details}))
      .catch(error=>{if(!controller.signal.aborted)setState({loading:false,error:error.message,details:null});});
    return()=>controller.abort();
  },[token,retry]);
  const invitation=state.details;
  const existingElsewhere=invitation?.account_status==='registered_elsewhere';
  const inactive=invitation?.account_status==='inactive_member';
  if(invitation && !auth.user && !existingElsewhere && !inactive) return <AuthPage mode={invitation.account_status==='already_member'?'sign-in':mode} invitationDetails={invitation} navigate={navigate} theme={theme} setTheme={setTheme}/>;
  async function switchAccount(){setBusy(true);try{await auth.logout();navigate('register?invite='+encodeURIComponent(token));}catch(error){setState(current=>({...current,error:error.message}));}finally{setBusy(false);}}
  const isMember=auth.user && invitation && auth.user.email.toLowerCase()===invitation.email.toLowerCase() && auth.workspace.id===invitation.workspace_id;
  return <main className="invitation-page"><a href="#home" className="invitation-brand"><Logo/></a><section className="invitation-card"><span className="studio-empty-symbol"><Icon name={state.loading?'loader':state.error?'alert':'users'} size={28}/></span>
    <h1>{state.loading?'Checking your invitation':state.error?'This invitation needs attention':isMember?'You are in the right workspace':'You are invited'}</h1>
    {state.loading && <p role="status">Loading workspace and access details.</p>}
    {state.error && <><p role="alert">{state.error}</p><Button onClick={()=>setRetry(value=>value+1)}>Check again</Button><a className="button secondary" href="#sign-in">Go to sign in</a></>}
    {invitation && !state.error && <><h2>{invitation.workspace_name}</h2><p>Invitation for <strong>{invitation.email}</strong></p><div className="registration-note"><Icon name="shield" size={17}/><span>{roles[invitation.role]} access · Expires {new Date(invitation.expires_at).toLocaleDateString()}</span></div>
      {isMember?<><p>Your account already has access. Continue to your workspace.</p><Button variant="primary" onClick={()=>navigate('overview')}>Open workspace</Button></>:inactive?<p>This account is deactivated. Ask the workspace administrator to reactivate it.</p>:existingElsewhere?<><p>This email is already registered in another workspace. Ask the administrator to invite a different email address.</p><a className="button secondary" href="#sign-in">Go to sign in</a></>:auth.user?<><p>You are signed in as <strong>{auth.user.email}</strong>. Switch accounts to accept this invitation with the intended email address.</p><Button variant="primary" disabled={busy} icon={busy?'loader':'logout'} onClick={switchAccount}>Switch account to join</Button><Button disabled={busy} onClick={()=>navigate('overview')}>Keep current workspace</Button></>:null}
    </>}
  </section></main>;
}
