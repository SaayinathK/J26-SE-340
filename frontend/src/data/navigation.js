export const navigation = [
  { label: 'Dashboard', icon: 'overview', group: 'workspace', path: 'overview' },
  { label: 'Dashboard', icon: 'overview', group: 'workspace', path: 'integrations', hidden: true },
  { label: 'Campaigns', icon: 'send', group: 'workspace', path: 'campaigns' },
  { label: 'Knowledge base', icon: 'book', group: 'workspace', path: 'knowledge' },
  { label: 'Lead Intelligence', icon: 'users', group: 'agents', path: 'lead-intel' },
  { label: 'Strategy Agent', icon: 'overview', group: 'agents', path: 'strategy-fl' },
  { label: 'Content Agent', icon: 'file', group: 'agents', path: 'content-agent' },
  { label: 'Email Agent', icon: 'mail', group: 'agents', path: 'email-agent' },
  { label: 'Team & access', icon: 'users', group: 'manage', path: 'team', hidden: true },
  { label: 'Monitoring', icon: 'activity', group: 'manage', path: 'monitoring', hidden: true },
  { label: 'Settings', icon: 'settings', group: 'manage', path: 'settings' },
];
// Preserve existing bookmarks while showing one combined dashboard destination.
export const canonicalPage = page => page === 'integrations' ? 'overview' : page;
export const settingsPages = ['settings', 'team', 'monitoring'];
