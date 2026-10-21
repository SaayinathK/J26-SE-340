import { useState } from 'react';
import { Copy, Check, ThumbsUp, ThumbsDown, Loader2 } from 'lucide-react';
import { api } from '../services/api';
import { ErrorMessage, SuccessMessage, parseObject } from './UI';
const labels = { hook:'Hook', primary_text:'Primary text', headline:'Headline', subheadline:'Subheadline', benefits:'Benefits', social_proof:'Social proof', cta:'Call to action', urgency:'Urgency', hook_30s:'Opening hook · 30 seconds', problem:'Problem', agitate:'Agitate', solution:'Solution', proof:'Proof', offer:'Offer', subject:'Subject', preview_text:'Preview text', body:'Body' };
const fields = { meta_ad:['hook','primary_text','headline','cta'], funnel_page:['hook','problem','solution','benefits','social_proof','offer','cta'], vsl:['hook_30s','problem','agitate','solution','proof','offer','cta'], email:['subject','preview_text','body','cta'] };
const limits = { hook:125, primary_text:280, headline:40 };
function Section({ name, value, limit, title }) {
  const [copied, setCopied] = useState(false); const [error, setError] = useState('');
  const text = Array.isArray(value) ? value.join('\n') : typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value ?? 'Not provided');
  async function copy() { try { await navigator.clipboard.writeText(text); setCopied(true); setError(''); setTimeout(() => setCopied(false), 1800); } catch { setError('Clipboard unavailable. Select and copy the text manually.'); } }
  return <section className="output-section"><div className="output-label"><h3>{title || labels[name] || name.replaceAll('_',' ')}</h3><div>{limit && <span className={[...text].length > limit ? 'over-limit' : ''}>{[...text].length}/{limit}</span>}<button className="copy-btn" aria-label={`Copy ${title || labels[name] || name}`} onClick={copy}>{copied ? <Check size={15}/> : <Copy size={15}/>}<span>{copied ? 'Copied' : 'Copy'}</span></button></div></div>{name === 'cta' ? <span className="cta-badge">{text}</span> : Array.isArray(value) ? <ul className="output-list">{value.map((item,i) => <li key={i}>{String(item)}</li>)}</ul> : <p className="output-text">{text}</p>}<ErrorMessage>{error}</ErrorMessage></section>;
}
function MetaCampaign({ personas }) {
  const [selected, setSelected] = useState(0);
  const persona = personas[selected] || personas[0];
  if (!persona) return null;
  return <div className="meta-campaign">
    <div className="campaign-summary"><strong>{personas.length} personas · {personas.reduce((count,p) => count + (p.hooks?.length || 0),0)} hooks · {personas.reduce((count,p) => count + (p.body_copies?.length || 0),0)} copy options</strong><p>Suggested audience segments and pain points inferred from your business profile. Review them against what you know about your customers.</p></div>
    <div className="persona-selector" aria-label="Choose audience persona">{personas.map((item,i) => <button key={i} type="button" aria-pressed={selected===i} className={selected===i ? 'selected' : ''} onClick={()=>setSelected(i)}><span>PERSONA {i+1}</span><strong>{item.name}</strong></button>)}</div>
    <div key={selected} className="persona-content"><div className="persona-intro"><span className="badge">Suggested persona</span><h3>{persona.name}</h3><p>{persona.description}</p></div>
      <Section name="pain_points" title="Audience pain points" value={persona.pain_points}/>
      <div className="campaign-section-heading"><h3>10 hooks. Different ways to connect.</h3><p>Choose a hook that speaks to this persona’s pain or goal, then pair it with a body-copy option below.</p></div>
      <div className="campaign-hooks">{persona.hooks?.map((hook,i)=><Section key={i} name="hook" title={`Hook ${String(i+1).padStart(2,'0')}`} value={hook} limit={125}/>)}</div>
      <div className="campaign-section-heading"><h3>Body copy & ready-to-use ad text</h3><p>Three angles for this persona. Each includes primary text, a headline, and a call to action.</p></div>
      {persona.body_copies?.map((copy,i)=><details className="campaign-body" key={i} open><summary>Body copy option {i+1}</summary><Section name="body" title={`Body copy ${i+1}`} value={copy.body} limit={600}/><Section name="primary_text" value={copy.primary_text} limit={280}/><Section name="headline" value={copy.headline} limit={40}/><Section name="cta" value={copy.cta}/></details>)}
    </div>
  </div>;
}
export function Feedback({ id, rating, onRated }) {
  const [busy, setBusy] = useState(''); const [error, setError] = useState(''); const [saved, setSaved] = useState(rating || '');
  async function rate(value) { if (busy || saved) return; setBusy(value); setError(''); try { await api.feedback(id, value); setSaved(value); onRated?.(value); } catch (err) { setError(err.message); } finally { setBusy(''); } }
  if (!id) return null;
  return <div className="feedback"><ErrorMessage>{error}</ErrorMessage>{saved ? <SuccessMessage>{saved === 'positive' ? 'Positive feedback saved. Thanks for helping your AI learn.' : 'Feedback saved. Your input helps improve future content.'}</SuccessMessage> : <><div><strong>How did this generation do?</strong><p>Your feedback helps shape better content.</p></div><div className="feedback-buttons"><button className="btn-secondary" disabled={!!busy} onClick={() => rate('positive')}>{busy === 'positive' ? <Loader2 className="animate-spin" size={16}/> : <ThumbsUp size={16}/>}This is great</button><button className="btn-secondary" disabled={!!busy} onClick={() => rate('negative')}>{busy === 'negative' ? <Loader2 className="animate-spin" size={16}/> : <ThumbsDown size={16}/>}Needs work</button></div></>}</div>;
}
export default function ContentCard({ type, output, id, rating, onRated, showFeedback = true }) {
  const data = parseObject(output); const [tab, setTab] = useState('instagram');
  const legacyFunnel = type === 'funnel_page' && !data.hook && (data.headline || data.subheadline);
  const displayFields = legacyFunnel ? ['headline','subheadline','benefits','social_proof','cta','urgency'] : fields[type] || Object.keys(data);
  const funnelTitles = { hook: '1. Hook · audience pain point', problem: '2. Problem', solution: '3. Solution', benefits: '4. Benefits', social_proof: '5. Social proof', offer: '6. Offer', cta: '7. Call to action' };
  return <div className="content-card">{type === 'meta_ad' && Array.isArray(data.personas) ? <MetaCampaign personas={data.personas}/> : type === 'social_post' ? <><div className="social-tabs" role="tablist" aria-label="Social platform">{['instagram','facebook','linkedin'].map(name => <button key={name} id={`tab-${id}-${name}`} role="tab" aria-selected={tab === name} aria-controls={`panel-${id}`} onClick={() => setTab(name)} className={tab === name ? 'selected' : ''}>{name === 'linkedin' ? 'LinkedIn' : name[0].toUpperCase()+name.slice(1)}</button>)}</div><div id={`panel-${id}`} role="tabpanel" aria-labelledby={`tab-${id}-${tab}`}><Section name={tab} value={data[tab]}/></div><Section name="hashtags" value={Array.isArray(data.hashtags) ? data.hashtags.join(' ') : data.hashtags}/></> : displayFields.map(name => <Section key={name} name={name} title={type === 'funnel_page' && !legacyFunnel ? funnelTitles[name] : undefined} value={data[name]} limit={type === 'meta_ad' ? limits[name] : undefined}/>)}{showFeedback && <Feedback id={id} rating={rating} onRated={onRated}/>}</div>;
}
