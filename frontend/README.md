# Single Ciftron web application

React/Vite application for platform pages and all four agents. There are no agent-owned frontend packages or iframes.

The root URL and `/#home` open the public Ciftron digital marketing SaaS homepage. It presents Strategy, Content, Lead Intelligence, and Email equally, with keyboard-accessible agent previews and an animated SVG network centered on business context. Its black, white, cool-gray, and teal palette matches the workspace. Pointer-driven depth, flowing connection paths, orbiting particles, scroll reveals, and entrance animations respect pause controls and reduced-motion settings. Sign-in and registration remain at `/#sign-in` and `/#register`; workspace routes still require authentication. The previews are illustrative. Image provenance and generation prompts are in [public/images/README.md](public/images/README.md).

- `src/pages`: routes/screens, including service availability fallbacks.
- `src/features/{email,content,lead-intel,strategy}`: feature components, hooks and local API facades.
- `src/components`, `src/hooks`, `src/styles`, `src/types`: shared UI and helpers.
- `src/lib/api-client.js`: the only browser API transport; same-origin `/api` calls go to gateway.

```sh
npm ci
npm run dev
npm run build
npm test
```

`GATEWAY_URL` configures only the Vite/production server proxy, never a browser agent endpoint. The production frontend runs on port 5173 via Compose. `scripts/serve.cjs` serves built assets and forwards `/api` only to gateway. Gateway owns cookies, CSRF and sign-in; feature APIs receive trusted workspace identity internally.

The dashboard combines workspace metrics and the agent directory. The sidebar groups agents under one expandable menu and team, monitoring and account pages under Settings, with permission checks on navigation and actions. Content, Lead Intelligence and Strategy have native workspaces with connection status and supported manual actions; teammate backend setup is documented in [agent workspace integration](../docs/agent-workspace-integration.md). Cross-service browser checks live at `../tests/e2e/verify-service-flow.cjs`; frontend unit tests stay in `tests/`.

The Email studio has seven internal pages at `/#email-agent?view=overview|builder|library|knowledge|performance|learning|integrations`. The editor remains mounted across these pages to preserve unsaved work, supports personalized desktop/narrow previews and text/JSON exports, and prompts before replacing or leaving an unsaved draft. Performance uses explicitly entered aggregate outcomes. Administrators can opt into evaluated engagement guidance in the learning center and save GoHighLevel/Meta account references for later API authorization.

See [setup](../docs/setup.md).
