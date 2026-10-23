# Workspace access controls

The gateway returns the current account's permission list with its session. The frontend uses that list instead of inferring access from a displayed role name. Gateway and Email Agent enforce the same role policy on API requests; PostgreSQL row policies separately isolate tenants.

| Area | Administrator | Marketer | Viewer |
| --- | --- | --- | --- |
| Dashboard (overview and agent directory), campaigns | Read and export | Read and export | Read and export |
| Create, archive and restore campaigns | Yes | Yes | No |
| Knowledge | Manage | Read only | No access |
| Email Studio builder, library, reviews and performance | Use | Use | No access |
| Learning history and integration references | Read | Read | No access |
| Learning consent, training, activation and integration settings | Manage | Read only | No access |
| Team invitations, member roles and activation | Manage | No access | No access |
| Monitoring and platform status | Read | No access | No access |
| Own profile, Google linking and appearance | Manage | Manage | Manage |
| Workspace name and domain | Manage | Read only | Read only |

The sidebar contains Dashboard, Campaigns, Knowledge (when permitted), a collapsible AI agents menu, and Settings. Dashboard combines the previous Overview and Services pages; existing `#integrations` bookmarks open that dashboard. Settings groups Account & workspace, Team & access, and Monitoring. Team and Monitoring tabs appear only with their required permissions; direct URLs remain protected. Search still includes authorized destinations inside those groups.

Knowledge write controls, campaign write controls and administrator-only learning/integration actions are hidden when unauthorized. Read-only preferences remain visible with an explanation. The Viewer dashboard offers campaign browsing instead of Email Agent actions. The monitoring tab appears only with `monitoring:read`.

Unknown pages and unregistered mutation routes do not inherit access. Sidebar entries and search results use the same page map as direct hash navigation. Protected Team and Email components also check access before mounting their data hooks. Supported mutation paths have an explicit required permission; disabled DOM controls are not the authorization boundary.

Role changes are enforced by the server on the next request. The browser checks its session every 30 seconds and on focus. A 403 response triggers an immediate permission refresh; a role change remounts the workspace and discards open privileged forms. Overlapping refreshes use the latest response only, and pending responses from an earlier session cannot restore its permissions after sign-out or a new sign-in.

Marketers can review email sequences; there is no separate approver role. Guardrails still block marking a flagged sequence Reviewed. Synthetic results cannot be activated as learning guidance. Unimplemented agents and marketing delivery remain unavailable regardless of role. Administrators remain scoped to their own workspace.

Implementation: `services/gateway/src/policies/rbac.js`, `services/email-agent/src/policies/rbac.js`, `frontend/src/lib/access.js` and `frontend/src/components/AccountShell.jsx`.

Verification:

```powershell
npm test --prefix frontend
npm run build --prefix frontend
powershell -NoProfile -File services/gateway/scripts/verify-accounts.ps1
node tests/e2e/verify-service-flow.cjs --rbac-only
```

Browser tests use real temporary gateway/email databases and real role accounts, with outbound email disabled. They check all three roles, direct URL denial, read-only controls, backend rejection, role promotion/demotion, revoked open forms, delayed stale authorization responses and mobile layout. Screenshots are saved under `.local/e2e/rbac-*.png`.
