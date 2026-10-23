import { Button, EmptyState } from './ui.jsx';
export default function AccessDenied({onBack}){
  return <section className="card"><EmptyState icon="lock" title="This area needs a different role" description="Your current workspace role does not have access. Contact your administrator if you need additional permissions.">{onBack && <Button onClick={onBack}>Back to overview</Button>}</EmptyState></section>;
}
