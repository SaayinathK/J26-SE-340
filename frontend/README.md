# frontend — Ciftron platform web app (one app for all agents)

React 18 + Vite. Calls **only the C4 gateway** (`/api/...`), never an agent directly.

| Folder | What |
| --- | --- |
| `src/app/App.jsx` | platform shell: sign-in, sidebar, top bar, light/dark theme, page switching |
| `src/components/ui.jsx` | shared UI pieces (cards, KPI tiles, badges, toasts, loading) |
| `src/lib/api-client.js` | session, login and `call()` to the gateway |
| `src/styles/styles.css` | the platform theme (ciftron look, light + dark) |
| `src/features/lead-intel/` | C3 Lead Intelligence: `api.js`, `lang.js` (plain-English words), `pages/` |
| `src/features/<agent>/` | other agents add their screens here in the same way |

Lead Intelligence pages: Overview, Leads, Lead history (new), Check a new lead, Score check.

```powershell
cd frontend
npm install
npm run dev          # http://localhost:3000  (/api is sent to the gateway on http://127.0.0.1:4000)
npm run build        # production build in dist/ (Docker serves it with nginx on port 3000)
```
