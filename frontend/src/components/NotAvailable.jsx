import { Button, Icon } from './ui.jsx';
export default function NotAvailable({ name = 'This page', description, onRetry, onBack }) {
  return <section className="card service-unavailable" role="status"><span className="service-unavailable-icon"><Icon name="monitor" size={30} /></span><span className="eyebrow">NOT AVAILABLE</span><h2>{name} is not available</h2><p>{description || 'This page has not been connected yet. You can continue using the rest of your workspace.'}</p><div className="service-actions">{onRetry && <Button icon="refresh" onClick={onRetry}>Try again</Button>}{onBack && <Button onClick={onBack}>Back to dashboard</Button>}</div></section>;
}
