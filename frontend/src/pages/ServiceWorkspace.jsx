import NotAvailable from '../components/NotAvailable.jsx';
import { useServices } from '../hooks/useServices.jsx';
import ContentWorkspace from '../features/content/components/Workspace.jsx';
import LeadWorkspace from '../features/lead-intel/components/Workspace.jsx';
import StrategyWorkspace from '../features/strategy/components/Workspace.jsx';
import EmailWorkspace from '../features/email/EmailWorkspace.jsx';
import {useAuth} from '../hooks/useAuth.jsx';
import {canAccessPage} from '../lib/access.js';
import AccessDenied from '../components/AccessDenied.jsx';

export default function ServiceWorkspace({ serviceId, navigate, notify, platformData }) {
  const auth=useAuth();
  const { services, loading, error, refresh } = useServices();
  if(!canAccessPage(serviceId,auth.can))return <AccessDenied onBack={()=>navigate('overview')}/>;
  const service = services.find(item => item.id === serviceId);
  if (loading && serviceId==='email-agent') return <p role="status">Checking service availability...</p>;
  if (serviceId === 'email-agent' && service?.available && !error) return <EmailWorkspace notify={notify} />;
  const Pending = { 'content-agent': ContentWorkspace, 'lead-intel': LeadWorkspace, 'strategy-fl': StrategyWorkspace }[serviceId];
  if (Pending) return <Pending service={error?null:service} checking={loading} onRetry={refresh} navigate={navigate} notify={notify} platformData={platformData} />;
  return <NotAvailable name={service?.name || 'This page'}
    description={error ? 'Availability could not be checked. Please try again.' : service?.reason === 'not_implemented' ? 'This service has not been connected yet. Its page will appear here when it is available.' : 'This service is not available right now. Please try again shortly.'}
    onRetry={refresh} onBack={() => navigate('overview')} />;
}
