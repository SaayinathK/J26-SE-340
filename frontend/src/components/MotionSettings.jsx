import { Icon } from './ui.jsx';

export default function MotionSettings({ motion, setMotion }) {
  const enabled = motion !== 'reduced';
  return <section className="card motion-settings" aria-labelledby="motion-settings-title">
    <span className="motion-settings-icon"><Icon name="sparkles" size={22} /></span>
    <div className="motion-settings-copy">
      <h2 id="motion-settings-title">A little more life.</h2>
      <p>Gentle entrances, animated charts, and playful details. Turn them off for a calmer workspace.</p>
      <small>Your device’s reduced motion preference is always respected.</small>
    </div>
    <div className="motion-switch-control">
      <span id="motion-switch-label">Interface animations</span>
      <button type="button" role="switch" aria-checked={enabled} aria-labelledby="motion-switch-label" className="motion-switch" onClick={() => setMotion(enabled ? 'reduced' : 'full')}><span /></button>
      <small>{enabled ? 'On' : 'Off'}</small>
    </div>
  </section>;
}
