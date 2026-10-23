import { useEffect, useRef, useState } from 'react';
import { api, authConfig } from '../lib/api-client.js';
import { Icon } from './ui.jsx';

let scriptPromise;
let initialized = false;
function loadGoogle() {
  if (window.google?.accounts?.id) return Promise.resolve();
  if (!scriptPromise) scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client?hl=en'; script.async = true; script.defer = true;
    const timeout = setTimeout(() => { scriptPromise = null; script.remove(); reject(new Error('Google sign-in took too long to load. Try email sign-in.')); }, 15000);
    script.onload = () => { clearTimeout(timeout); resolve(); };
    script.onerror = () => { clearTimeout(timeout); scriptPromise = null; script.remove(); reject(new Error('Google sign-in could not load. Try email sign-in.')); };
    document.head.appendChild(script);
  });
  return scriptPromise;
}

export default function GoogleSignIn({ intent, onCredential, onError, theme, disabled = false }) {
  const container = useRef(null);
  const callback = useRef(onCredential);
  const errorCallback = useRef(onError);
  callback.current = onCredential; errorCallback.current = onError;
  const [status, setStatus] = useState('loading');
  const [signInOrigin,setSignInOrigin] = useState('');
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;
  useEffect(() => {
    let active = true;
    let submitted = false;
    let expiry;
    setStatus('loading');
    (async () => {
      const config = await authConfig();
      if (!config.google_enabled) { if (active) setStatus('unconfigured'); return; }
      if(config.google_signin_origin && config.google_signin_origin !== window.location.origin){
        if(active){setSignInOrigin(config.google_signin_origin);setStatus('alternate-origin');}return;
      }
      await loadGoogle();
      if (!active) return;
      // GIS supports one initialization per document. Changing auth purpose or
      // retrying a consumed nonce starts a fresh document and security challenge.
      if (initialized) { window.location.reload(); return; }
      const { nonce } = await api(`/auth/google/challenge?intent=${intent}`);
      if (!active || !container.current) return;
      initialized = true;
      window.google.accounts.id.initialize({ client_id: config.google_client_id, nonce, auto_select: false, use_fedcm_for_button:true,
        callback: async response => {
          if (!active || submitted || disabledRef.current) return;
          submitted = true;
          try { await callback.current(response.credential); }
          catch (error) { if (active) { errorCallback.current(error.message); setStatus('retry'); } }
        },
      });
      setStatus('ready');
      expiry = setTimeout(() => { if (active) setStatus('retry'); }, 4 * 60 * 1000);
    })().catch(error => { if (active) { setStatus('failed'); errorCallback.current(error.message); } });
    return () => { active = false; clearTimeout(expiry); };
  }, [intent]);
  useEffect(() => {
    if (status !== 'ready' || !container.current || !window.google?.accounts?.id) return;
    container.current.replaceChildren();
    window.google.accounts.id.renderButton(container.current, { type: 'standard', theme: theme === 'dark' ? 'filled_black' : 'outline', size: 'large', shape: 'pill', locale: 'en', text: intent === 'register' ? 'signup_with' : intent === 'link' ? 'continue_with' : 'signin_with', width: Math.min(355, container.current.clientWidth || 300) });
  }, [status, theme, intent]);
  return <div className="google-signin-wrapper" aria-busy={status === 'loading'}>
    {status === 'loading' && <div className="google-status"><Icon name="loader" size={16} />Preparing Google sign-in…</div>}
    {status === 'unconfigured' && <p className="google-status"><Icon name="globe" size={16} />Google sign-in is not available yet. Use email and password.</p>}
    {status === 'alternate-origin' && <><a className="button secondary full-width" href={`${signInOrigin}/${intent === 'link' ? '#sign-in' : window.location.search + window.location.hash}`}><Icon name="globe" size={18}/>Continue with Google</a><small className="muted">Google sign-in opens on {new URL(signInOrigin).host}. Use the same registered email to keep your workspace.</small></>}
    {['failed', 'retry'].includes(status) && <button type="button" className="button secondary full-width" disabled={disabled} onClick={() => window.location.reload()}>Retry Google sign-in</button>}
    <div ref={container} hidden={status !== 'ready'} className={`google-button-container ${disabled ? 'is-disabled' : ''}`} inert={disabled ? true : undefined} />
  </div>;
}
