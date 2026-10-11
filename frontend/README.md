# Single Ciftron web application

React/Vite application for platform pages and all four agents. There are no agent-owned frontend packages or iframes.

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

Email Agent opens directly from the sidebar, with sequence tabs and contextual knowledge navigation. Pending agent pages show Not available. Cross-service browser checks live at `../tests/e2e/verify-service-flow.cjs`; frontend unit tests stay in `tests/`.

See [setup](../docs/setup.md).
