# Google sign-in

Google sign-in is configured in `services/gateway/.env` using `GOOGLE_CLIENT_ID`. Agent environment files and SMTP credentials do not configure website sign-in. Use a Google OAuth **Web application** client; this ID-token flow does not need a client secret in the frontend.

In Google Cloud Console → Google Auth Platform → Clients, select the same web client and add the exact frontend origins under **Authorized JavaScript origins**:

```text
http://localhost
http://localhost:5173
http://127.0.0.1:5173
```

Add the actual HTTPS frontend origin for deployment. Origins contain the scheme, hostname and optional port, with no path, hash or trailing slash. These Google-side settings are separate from gateway `CLIENT_ORIGINS`; both must allow the frontend address. If the consent screen is in testing, add intended users to its test audience as needed. See [Google's official setup guide](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid).

After changing gateway environment variables, recreate it and reload the page. Changing Google Console origins alone does not require changing `.env` or rebuilding the application.

If Google accepts only one frontend address, set `GOOGLE_SIGNIN_ORIGIN` in gateway settings to that verified origin, for example `http://localhost:5173`. It must also appear in `CLIENT_ORIGINS`. On another app origin, **Continue with Google** opens the corresponding sign-in/register page at the verified origin, retaining invitation links. Password sign-in remains available on either address. Cookies are scoped to each origin, so using Google from Settings on another origin requires signing into the verified origin first. This setting does not change invitation email URLs or `PUBLIC_APP_URL`.

## Registered email versus connected Google identity

Creating a password account with a Gmail address does not automatically connect Google sign-in. After Google verifies an existing account's email, the app now offers **Connect your Google account** directly on the sign-in page. Confirm the existing password once to connect the verified Google identity and enter the same workspace. Subsequent Google sign-ins do not need the password. No duplicate account or workspace is created.

Confirmation requires both Google verification and the correct account password. The pending proof is held in an HTTP-only, five-minute cookie signed for a distinct audience. Its server-side challenge is single-use and bound to the account and verified email. A wrong password, forged/expired proof, another account's proof or an already-connected different Google identity cannot complete linking. Google tokens are still verified for signature, audience, verified email and nonce. Existing Settings → Connected sign-in remains available.

## Browser behavior and diagnostics

The frontend serves `Cross-Origin-Opener-Policy: same-origin-allow-popups` and `Referrer-Policy: strict-origin-when-cross-origin`. Google button initialization enables FedCM where supported. CSP continues to allow Google Identity Services without disabling app security headers.

- **The given origin is not allowed for the given client ID:** correct the selected client's Authorized JavaScript origins in Google Cloud. The app cannot override Google's allowlist.
- **Connect your Google account:** enter the existing account password once. An ordinary Gmail password registration alone is not a Google identity link.
- **401 from `/api/auth/me` before signing in:** no active app session exists yet. It does not establish a failure of Google verification.
- **401 from `/api/auth/google`:** inspect the app's message. Verification, nonce expiry and an unregistered Google account are separate cases.
- Use one frontend address consistently. `localhost` and `127.0.0.1` have separate browser cookies.

## Verification

```powershell
powershell -NoProfile -File services/gateway/scripts/verify-accounts.ps1
npm test --prefix frontend
npm run build --prefix frontend
node tests/e2e/verify-service-flow.cjs --google-only
```

Backend security checks and the browser flow use temporary databases. Browser provider credentials are simulated by a test-only preload guarded by the temporary database name and a random signing secret; it is not included in the production image. Live Google Console configuration and the real user's account consent remain external to these automated tests.
