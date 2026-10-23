# Team invitations

Administrators invite members from **Team & access**. Invitations assign the chosen workspace and role on the server. The intended recipient creates an account using the invited email; they cannot select another workspace or role. Someone already signed in can keep their current workspace or explicitly switch accounts to join.

Invitations expire after seven days and work once. Only token hashes are stored in the database. Pending invitations show expiry and email delivery status. **Send new invitation** creates a new token and invalidates the previous link; **Revoke** invalidates the link immediately. Accepted invitations leave the pending list and the person appears in workspace members. Invitations from deactivated or demoted administrators cannot be accepted.

Accounts currently belong to one workspace. Existing members should be managed through the member list, including reactivation. Invite a different email when the address already belongs to another workspace.

## Email configuration

Set these in `services/gateway/.env`, never in frontend configuration:

```dotenv
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_REQUIRE_TLS=true
SMTP_USER=your-account@gmail.com
SMTP_PASS=your-app-password
SMTP_FROM=your-account@gmail.com
SMTP_FROM_NAME=Tenora
PUBLIC_APP_URL=https://your-public-frontend.example
```

For Gmail, use an [app password](https://support.google.com/accounts/answer/185833) with two-step verification. Keep it out of chat, source control and screenshots. `SMTP_FROM` must contain the plain email address; use `SMTP_FROM_NAME` for its display name. Port 587 uses STARTTLS. Port 465 requires `SMTP_SECURE=true`.

`PUBLIC_APP_URL` is the frontend origin, without a path or hash. It must be reachable by the recipient. A model-serving Colab tunnel is not a frontend address. When empty, links use the browser's allowed origin from `CLIENT_ORIGINS`; localhost/127.0.0.1 links only work on the computer serving the app. Include the deployed frontend origin in `CLIENT_ORIGINS` too.

Verify SMTP without sending a message:

```powershell
node services/gateway/scripts/verify-invitation-mail.cjs
```

After changing gateway environment variables, recreate the gateway:

```powershell
docker compose up -d --force-recreate --no-deps --no-build gateway
```

Sending an invitation delivers both plain-text and HTML email and returns a shareable link. A successful status means the SMTP server accepted the message; it does not prove inbox placement. When SMTP is unavailable or fails, the modal explains the result and still offers the valid link. Clicking **Send new invitation** retries delivery with a replacement link.

## Verification

```powershell
node --test services/gateway/tests/unit/*.test.cjs
powershell -NoProfile -File services/gateway/scripts/verify-accounts.ps1
node tests/e2e/verify-service-flow.cjs --invitation-only
```

Integration/browser checks use temporary databases and a local SMTP catcher, with external mail disabled. They cover the actual SMTP message, intended email, correct workspace/role, copied link, signed-in account switching, single use, expiry, revocation, replacement, authorization and failed-mail fallback. Browser screenshots are saved under `.local/e2e/invitation-sent.png` and `.local/e2e/invitation-join.png`.
