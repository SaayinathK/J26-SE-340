import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge, Button, EmptyState, Icon, Modal } from '../../components/ui.jsx';
import { useAuth } from '../../hooks/useAuth.jsx';
import { api } from '../../lib/api-client.js';
import './agents.css';

export function useAgentView(views) {
  const fromHash=()=>{const value=new URLSearchParams(location.hash.split('?')[1] || '').get('view');return views.includes(value)?value:views[0];};
  const [view,setView]=useState(fromHash);
  useEffect(()=>{const change=()=>setView(fromHash());window.addEventListener('hashchange',change);return()=>window.removeEventListener('hashchange',change);},[]);
  function go(next){if(!views.includes(next))return;setView(next);location.hash=location.hash.split('?')[0]+'?view='+next;}
  return [view,go];
}
export function useAgentResource(path,enabled=true){
 const auth=useAuth(),key=auth.workspace.id+':'+auth.user.role,serial=useRef(0),controller=useRef(null);
 const [state,setState]=useState({data:null,loading:enabled,error:''});
 const reload=useCallback(async()=>{
  controller.current?.abort();const current=++serial.current;const next=new AbortController();controller.current=next;
  if(!enabled){setState({data:null,loading:false,error:''});return;}
  setState(previous=>({...previous,loading:true,error:''}));
  try{const data=await api(path,{signal:next.signal});if(current===serial.current)setState({data,loading:false,error:''});}
  catch(error){if(current===serial.current && error.name!=='AbortError')setState({data:null,loading:false,error:error.message});}
 },[path,enabled,key]);
 useEffect(()=>{setState({data:null,loading:enabled,error:''});void reload();return()=>{++serial.current;controller.current?.abort();};},[reload]);
 return {...state,reload};
}
export function AgentLayout({name,eyebrow,description,tabs,view,onView,connected,checking,onRefresh,children,action}){
 return <section className="agent-workspace" aria-label={name+' workspace'}>
  <header className="agent-page-heading"><div><span className="eyebrow">{eyebrow}</span><h1>{name}</h1><p>{description}</p></div><div className="agent-page-actions"><Badge variant={connected?'success':'neutral'} dot>{checking?'Checking connection':connected?'Engine connected':'Connection pending'}</Badge><Button icon="refresh" onClick={onRefresh} disabled={checking}>Refresh connection</Button>{action}</div></header>
  <nav className="agent-page-tabs" aria-label={name+' pages'}>{tabs.map(([key,icon,label])=><button key={key} aria-current={view===key?'page':undefined} onClick={()=>onView(key)}><Icon name={icon} size={16}/>{label}</button>)}</nav>
  {!connected && <div className="agent-connection-note" role="status"><span><Icon name="plug" size={18}/></span><div><strong>{checking?'Checking your agent connection…':'Your workspace is ready. The agent engine is not connected yet.'}</strong><p>Prepare your brief below. Saved outputs, scores and learning results will appear when the service is connected.</p></div></div>}
  {children}
 </section>;
}
export function AgentMetrics({items}){return <div className="agent-metrics">{items.map(([icon,label,value,note])=><article key={label}><div><span>{label}</span><Icon name={icon} size={18}/></div><strong>{value ?? '—'}</strong><small>{note}</small></article>)}</div>;}
export function AgentPanel({title,description,action,children,className=''}){return <section className={'agent-panel '+className}><div className="agent-panel-heading"><div><h2>{title}</h2>{description && <p>{description}</p>}</div>{action}</div><div className="agent-panel-body">{children}</div></section>;}
export function AgentLoadState({resource,emptyTitle,emptyDescription,children,hasData}){
 if(resource.loading)return <EmptyState icon="loader" title="Loading your workspace" description="Reading the connected agent’s records."/>;
 if(resource.error)return <div className="agent-load-error" role="alert"><Icon name="plug"/><div><h3>We couldn’t load these records.</h3><p>{resource.error}</p><Button onClick={resource.reload} icon="refresh">Try loading again</Button></div></div>;
 if(!hasData)return <EmptyState icon="file" title={emptyTitle} description={emptyDescription}/>;
 return children;
}
export function AgentDrawer({title,description,onClose,children}){return <div className="agent-drawer"><Modal title={title} description={description} onClose={onClose} wide>{children}</Modal></div>;}
export const object=value=>{if(typeof value==='object' && value!==null)return value;try{return JSON.parse(value || '{}');}catch{return {};}};
export const label=value=>String(value || '').replaceAll('_',' ').replace(/^./,letter=>letter.toUpperCase());
export const date=value=>value && !Number.isNaN(new Date(value).getTime())?new Date(value).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}):'Not recorded';
export function StructuredOutput({value}){
 if(value==null)return null;
 if(Array.isArray(value))return <div className="agent-output-list">{value.map((item,index)=><div key={index}><span className="agent-output-index">{index+1}</span><StructuredOutput value={item}/></div>)}</div>;
 if(typeof value==='object')return <div className="agent-output-fields">{Object.entries(value).filter(([key])=>!['success','content_id','context_ids','attempts','tokens_used'].includes(key)).map(([key,item])=><section key={key}><h3>{label(key)}</h3><StructuredOutput value={item}/></section>)}</div>;
 return <p className="agent-output-text">{String(value)}</p>;
}
