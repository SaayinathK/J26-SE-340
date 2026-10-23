# Account and Google sign-in setup

Authentication, registration, account/workspace profiles, invitations, memberships, and roles use the gateway and PostgreSQL. Campaigns, saved email sequences, knowledge text, and workspace activity are also persisted in PostgreSQL. Workspace polling refreshes every five seconds.

## Local startup

1. Start Docker Desktop, then run `docker compose up -d gateway-database` from the repository root.
2. Existing installations must apply `services/gateway/db/migrations/004_accounts_and_sessions.sql` and `services/gateway/db/migrations/005_workspace_records.sql` as the database owner. Fresh installations apply migrations `001` through `005` in order. The gateway must connect as the restricted `c4_app` role, not a PostgreSQL superuser.
3. Run `node scripts/setup.cjs` from the repository root to initialize missing local configuration, then configure `services/gateway/.env`. The setup script preserves existing credentials. `CLIENT_ORIGINS` must contain the exact browser origins, for example `http://localhost:5173,http://127.0.0.1:5173`. See [platform setup](../docs/setup.md) for configuration details.
4. In `frontend`, run `npm install` then `npm run dev`. This starts only the gateway, waits for `/api/auth/config` to respond, then starts Vite. An existing healthy gateway is reused. Stopping this command stops only services it started.
5. Open the chosen hostname consistently, such as `http://127.0.0.1:5173/#register`. Development requests to `/api` are proxied to the gateway's configured `PORT` (4000 by default). `npm run dev:frontend` remains available when you manage the gateway separately.

No seeded account is required: register to create a new workspace. Existing seeded accounts can continue signing in with their existing passwords. New passwords require 12 characters, uppercase/lowercase letters and a number, and must fit bcrypt's 72-byte limit.

For a different development port, add that exact origin to `CLIENT_ORIGINS` and Google Cloud Console. Restart the gateway after editing its environment. `GATEWAY_URL` can override the development proxy target; it is server configuration, not a browser credential.

## Create the Google client ID

1. Open [Google Cloud Console](https://console.cloud.google.com/) and select or create your project.
2. Open **Google Auth Platform** and configure the app's Branding, Audience, and contact information. If the app uses an external audience in Testing mode, add the accounts you will test with under Test users.
3. Under **Clients**, create an **OAuth client ID** with application type **Web application**.
4. Under **Authorized JavaScript origins**, add each exact browser origin you use, for example `http://localhost:5173` and `http://127.0.0.1:5173`. Do not include a path, hash, or trailing route. Production must use your HTTPS origin.
5. Copy the client ID ending in `.apps.googleusercontent.com` into `services/gateway/.env` as `GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com`.
6. Restart the gateway and refresh the frontend. A Google-rendered sign-in button will replace the unavailable message.

This is the Google Identity Services popup flow. It does not need a client secret or an OAuth callback URL. The browser obtains an ID token, and the gateway verifies the signature, issuer, audience, expiry, verified email, and a single-use nonce before creating a database-backed application session. Never paste a Google client secret into frontend environment variables.

Official references: [Google client setup](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid), [server-side ID token verification](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token), and [JavaScript API](https://developers.google.com/identity/gsi/web/reference/js-reference).

## Registration and account linking

### Google button returns 403 or OAuth reports `origin_mismatch`

The Google console message `The given origin is not allowed for the given client ID` means the browser origin is missing from the selected Web OAuth client's Authorized JavaScript origins. Open Google Auth Platform → Clients, select the client matching GOOGLE_CLIENT_ID, and add `http://localhost`, `http://localhost:5173`, and `http://127.0.0.1:5173`. Include the scheme and actual browser port. Do not add a path, fragment, API route, or Docker service name. Save, allow the settings to take effect, and reload the login page. The app uses a JavaScript callback, so this flow does not require adding an OAuth redirect endpoint.

The Nginx document already sends `Cross-Origin-Opener-Policy: same-origin-allow-popups`. Helmet headers attached to API JSON responses are separate from the login document's policy. Changing the database role or weakening CSRF/token verification cannot authorize a Google origin. See the [official Google setup guide](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid).

### Google SDK reports repeated initialization

Google Identity Services initializes once per page. Changing the theme only renders the button again. A rejected credential shows **Retry Google sign-in**, which reloads the page to obtain a fresh one-use challenge. Switching between Google sign-in, registration, and account linking also starts a fresh page if Google was already initialized. This keeps each challenge tied to its authentication purpose without reconfiguring the SDK repeatedly. See the [Google JavaScript API reference](https://developers.google.com/identity/gsi/web/reference/js-reference#google.accounts.id.initialize).

### Verified Google identity has no linked application account

`GOOGLE_ACCOUNT_NOT_LINKED` means the Google token and one-use challenge passed verification, but that Google subject is not associated with an active Ciftron user. The sign-in page offers Create account with Google for a new workspace, or I already have an account for the password-and-link path. The latter opens Settings after password authentication; choose the same-email Google account under Connected sign-in. A successful Google registration can then use normal Google sign-in on later visits.

Registration using an existing password account returns `GOOGLE_LINK_REQUIRED`; an already registered Google identity returns `GOOGLE_ACCOUNT_ALREADY_REGISTERED`. The app never attaches an unknown Google identity to an existing tenant solely because an email matches. `GET /api/auth/me` returning 401 before a session exists is expected.

- Public registration creates a new workspace and assigns its creator `agency_admin`. Public requests cannot choose a role or supply another tenant ID.
- To join an existing workspace, an administrator creates a seven-day, single-use invitation in **Team & access** and shares the generated link with its intended recipient. No invitation email is sent automatically. The recipient must register using the invitation's email. The database assigns the invitation's workspace and role atomically.
- Accounts currently belong to one workspace. An email that already has an account cannot use public registration to create or join another workspace.
- Google registration creates a new account using Google's stable `sub` identity, or accepts a matching invitation. Existing password accounts are never automatically linked just because an email matches. Sign in with the password first, then link the same-email Google account in **Settings → Connected sign-in**.
- Password recovery, account-email changes, and email-verification delivery are outside this change; no nonfunctional recovery links are shown.

## Access policy

| Capability | Administrator | Marketer | Viewer |
| --- | --- | --- | --- |
| Read campaigns and overview | Yes | Yes | Yes |
| Manage campaign drafts | Yes | Yes | No |
| Generate email sequences | Yes | Yes | No |
| Read workspace knowledge | Yes | Yes | No |
| Manage knowledge sources | Yes | No | No |
| Manage team, invitations, roles | Yes | No | No |
| Manage shared workspace profile | Yes | No | No |
| Monitoring and integration administration | Yes | No | No |
| Own profile, theme, and Google linking | Yes | Yes | Yes |

The server policy is in `services/gateway/src/policies/rbac.js`. Every authenticated request resolves the session and current role from PostgreSQL; the role embedded in a JWT is never the authorization authority. Role changes take effect on the next server request. The interface refreshes identity on tab focus and every 30 seconds. Team lists poll every 15 seconds.

Session JWTs live in HTTP-only, SameSite=Lax cookies and are backed by revocable `auth_sessions` rows. The frontend never saves them to local/session storage. Logout deletes the current database session. The existing bearer-token response remains available for API clients. Mutating browser requests use same-origin JSON, an explicit origin allowlist, and a double-submit CSRF token. Cookies use Secure and `__Host-` names in production.

No administrator can deactivate or change their own role through team management. Tenant-scoped queries and row-level security prevent another workspace's membership from being read or edited. Disabling a user revokes their sessions. Direct URL navigation is also checked by the UI; the API performs its own authorization checks.

## Deployment

Serve the frontend and `/api` behind the same HTTPS origin in production. The Vite proxy is development-only. Set `NODE_ENV=production`, a strong random `JWT_SECRET`, the real origin allowlist, and the Google client ID. Use an owner/migration role only to apply migrations; run the gateway with the restricted application role. Authenticated browsers using the old demo or pre-migration bearer tokens must sign in again.

To revoke expired sessions/challenges periodically, schedule bounded database cleanup; expired rows never authenticate even before removal. The Google challenge route also removes expired challenge rows.
