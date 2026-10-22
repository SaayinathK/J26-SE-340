# AdBloom AI frontend

React 18, Vite, Tailwind CSS 3, React Router 6, and Lucide React. Plain JavaScript and fetch.

## Run locally

Start the backend in one terminal:

```sh
cd services/content-agent
npm start
```

Start the frontend in another terminal, from the repository root:

```sh
cd services/content-agent/client
npm install
npm run dev
```

Open http://localhost:3000. Vite proxies API calls to http://localhost:5001. Restart the backend after adding the knowledge routes.

## First-run flow

1. Register an account, save business defaults in Business settings, then create a named campaign.
2. Select your campaign and a format. Initial Meta campaigns create three personas; select a winner manually for future one-persona generations. Generate directly from the saved campaign profile. No prompt is required; expand “Add instructions (optional)” for custom directions.
3. Optionally add knowledge entries (for example, brand voice, product, and audience) to enrich your content. Saving knowledge needs the backend's Ollama embedding model.
4. Copy sections, rate the result, and revisit it in History.

The backend must have its existing database schema, JWT secret, and Ollama models configured. Model generation can take longer than the displayed 15–30 second estimate.

## Build

```sh
npm run build
```

Output is in `dist/`. For deployment, configure SPA fallback and reverse-proxy `/api`, `/content`, `/context`, `/knowledge`, `/settings`, `/campaigns`, and `/learning` for JSON requests to the API. Alternatively set `VITE_API_BASE_URL` at build time to a reachable API with appropriate CORS. Vite's development proxy is not part of the production bundle. Requests accepting HTML must continue to serve the SPA for `/settings` and `/knowledge`.

Tokens use localStorage key `ciftron_token`. Protected API 401 responses clear the local session. Other API failures show retryable errors.

Dashboard generations count reflects the latest 20 history items, not a lifetime total. Approved prompt version counts come from the live learning summary. The Learning page tracks purchase performance separately from user approvals. Knowledge is stored by the authenticated tenant; additions generate embeddings before insertion.

## Verification

- Production build passed.
- 31 targeted backend tests passed (knowledge, content routes, and database scoping).
- HTTP checks passed for direct page visits and JSON API proxying.
- The real API flow passed against local PostgreSQL and Ollama: register, save/load settings, add three embedded entries, build context, generate a Meta ad, submit positive feedback, and read history. Disposable test records were removed afterward.
- Visual browser interaction was not verified because no automation browser was available.

## Meta campaigns

Meta Ad generation returns a campaign set rather than a single ad: three suggested audience personas with pain points, ten distinct hooks per persona, and three body-copy options per persona. Each option includes body copy, primary text, a headline, and a Meta CTA. Personas are labeled as inferred, not verified customer research. The campaign is saved and rated as one generation. Older single-ad history remains readable. Full campaigns require multiple local-model calls and can take several minutes.
